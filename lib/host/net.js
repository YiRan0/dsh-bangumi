/**
 * @dsh-external/dsh-bangumi — 可配置代理的 HTTP fetch 层（纯 Node 原生模块，零第三方依赖）。
 *
 * 宿主 preload 的 EnvHttpProxyAgent 是「环境资产」——换机器没有 preload 就失效。
 * 本模块让插件自带代理（设置页手动选 http/https/socks5），出口不依赖宿主全局 dispatcher：
 *   - http(s) 代理：GET 类方法对 http 目标走 absolute-form；其余走 CONNECT 隧道
 *   - socks5 代理：RFC 1928 握手（no-auth / user-pass），隧道内 TLS 由调用方协商
 * 未配置代理时行为与原生 fetch 一致（走宿主全局 dispatcher，兼容 preload 环境）。
 */
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
export const NO_PROXY = { type: 'none', host: '', port: 0, username: '', password: '' };
export function isProxyEnabled(p) {
    return !!p && p.type !== 'none' && !!p.host && p.port > 0;
}
/* ---------------- socks5 (RFC 1928) ---------------- */
function socks5Connect(p, host, port, signal) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: p.host, port: p.port });
        const onAbort = () => { socket.destroy(); reject(new Error('aborted')); };
        if (signal.aborted) {
            socket.destroy();
            reject(new Error('aborted'));
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        let step = 'greet';
        let buf = Buffer.alloc(0);
        let failed = false;
        const fail = (e) => { if (failed)
            return; failed = true; signal.removeEventListener('abort', onAbort); socket.destroy(); reject(e); };
        const authUser = Buffer.from(p.username || '', 'utf8');
        const authPass = Buffer.from(p.password || '', 'utf8');
        const methods = p.username ? [0x02, 0x00] : [0x00];
        const onData = (chunk) => {
            buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
            try {
                if (step === 'greet') {
                    if (buf.length < 2)
                        return;
                    const ver = buf[0];
                    const method = buf[1];
                    buf = buf.subarray(2);
                    if (ver !== 0x05)
                        throw new Error('socks5 bad version ' + ver);
                    if (method === 0xff)
                        throw new Error('socks5: no acceptable auth method');
                    if (method === 0x02) {
                        if (authUser.length > 255 || authPass.length > 255)
                            throw new Error('socks5 credentials too long');
                        const pw = Buffer.from([authPass.length]);
                        socket.write(Buffer.concat([Buffer.from([0x01, authUser.length]), authUser, pw, authPass]));
                        step = 'auth';
                        return;
                    }
                    if (method === 0x00) {
                        step = 'cmd';
                        sendCmd();
                        return;
                    }
                    throw new Error('socks5 unsupported auth method ' + method);
                }
                if (step === 'auth') {
                    if (buf.length < 2)
                        return;
                    const ver = buf[0];
                    const status = buf[1];
                    buf = buf.subarray(2);
                    if (ver !== 0x01 || status !== 0x00)
                        throw new Error('socks5 auth failed (status ' + status + ')');
                    step = 'cmd';
                    sendCmd();
                    return;
                }
                if (step === 'cmd') {
                    if (buf.length < 4)
                        return;
                    const rep = buf[1];
                    if (rep !== 0x00) {
                        const reasons = { 1: 'general failure', 2: 'not allowed', 3: 'network unreachable', 4: 'host unreachable', 5: 'connection refused', 6: 'ttl expired', 7: 'command not supported', 8: 'address type not supported' };
                        throw new Error('socks5 connect failed: ' + (reasons[rep] ?? 'code ' + rep));
                    }
                    const atyp = buf[3];
                    let addrStart = 4;
                    if (atyp === 0x01)
                        addrStart = 8;
                    else if (atyp === 0x03) {
                        if (buf.length < 5)
                            return;
                        addrStart = 5 + buf[4];
                    }
                    else if (atyp === 0x04)
                        addrStart = 20;
                    else
                        throw new Error('socks5 bad atyp ' + atyp);
                    if (buf.length < addrStart + 2)
                        return;
                    socket.removeAllListeners('data');
                    socket.removeAllListeners('error');
                    signal.removeEventListener('abort', onAbort);
                    socket.on('error', () => { });
                    resolve(socket);
                }
            }
            catch (e) {
                fail(e instanceof Error ? e : new Error(String(e)));
            }
        };
        socket.on('data', onData);
        socket.on('error', (e) => fail(e));
        socket.on('connect', () => {
            socket.write(Buffer.from([0x05, methods.length, ...methods]));
        });
        function sendCmd() {
            const hb = Buffer.from(host, 'utf8');
            if (hb.length > 255)
                throw new Error('socks5 host too long');
            const portBuf = Buffer.alloc(2);
            portBuf.writeUInt16BE(port, 0);
            socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, portBuf]));
        }
    });
}
/* ---------------- http(s) 代理：CONNECT 隧道 ---------------- */
function httpProxyConnect(p, host, port, signal) {
    return new Promise((resolve, reject) => {
        const isTls = p.type === 'https';
        const mod = isTls ? https : http;
        const auth = p.username ? 'Basic ' + Buffer.from(p.username + ':' + p.password, 'utf8').toString('base64') : undefined;
        const req = mod.request({
            host: p.host,
            port: p.port,
            method: 'CONNECT',
            path: host + ':' + port,
            headers: { Host: host + ':' + port, ...(auth ? { 'Proxy-Authorization': auth } : {}) },
            ...(isTls ? { rejectUnauthorized: false } : {}),
        });
        const onAbort = () => { req.destroy(); reject(new Error('aborted')); };
        if (signal.aborted) {
            req.destroy();
            reject(new Error('aborted'));
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        req.once('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
        req.on('connect', (res, socket) => {
            signal.removeEventListener('abort', onAbort);
            if (res.statusCode !== 200) {
                socket.destroy();
                reject(new Error('proxy CONNECT failed: HTTP ' + res.statusCode + ' ' + (res.statusMessage ?? '')));
                return;
            }
            resolve(socket);
        });
        req.end();
    });
}
function collectBody(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
    });
}
function wrapIncoming(res) {
    const headers = {};
    for (let i = 0; i < res.rawHeaders.length; i += 2)
        headers[res.rawHeaders[i].toLowerCase()] = res.rawHeaders[i + 1];
    const status = res.statusCode ?? 0;
    let bufPromise = null;
    const buffer = () => (bufPromise ??= collectBody(res));
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: res.statusMessage ?? '',
        headers,
        text: async () => (await buffer()).toString('utf8'),
        json: async () => JSON.parse((await buffer()).toString('utf8')),
        buffer,
        arrayBuffer: async () => (await buffer()).buffer.slice(0),
    };
}
function wrapNative(res) {
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers,
        text: () => res.text(),
        json: () => res.json(),
        buffer: async () => Buffer.from(await res.arrayBuffer()),
        arrayBuffer: () => res.arrayBuffer(),
    };
}
/* ---------------- 全局出口 ---------------- */
let current = NO_PROXY;
/** 设置当前出口代理（设置页保存 / 初始化时调用；none 恢复直连） */
export function configureNet(p) {
    current = {
        type: p.type === 'http' || p.type === 'https' || p.type === 'socks5' ? p.type : 'none',
        host: p.host ?? '',
        port: Number(p.port) > 0 ? Number(p.port) : 0,
        username: p.username ?? '',
        password: p.password ?? '',
    };
}
export function getNetConfig() { return current; }
/** 解析 "http://user:pass@host:port" 或 "socks5://host:port" 形式的字符串 */
export function parseProxyUrl(raw) {
    try {
        const u = new URL(raw);
        let type = (u.protocol || '').toLowerCase().replace(/:$/, '');
        if (type === 'socks')
            type = 'socks5';
        if (type !== 'http' && type !== 'https' && type !== 'socks5')
            return null;
        if (!u.hostname)
            return null;
        return {
            type,
            host: u.hostname,
            port: u.port ? Number(u.port) : type === 'socks5' ? 1080 : 8080,
            username: decodeURIComponent(u.username || ''),
            password: decodeURIComponent(u.password || ''),
        };
    }
    catch {
        return null;
    }
}
/** 需要 CONNECT 隧道的方法（GET/HEAD/OPTIONS 之外的写方法也走隧道，防代理改写语义） */
function needsTunnel(method) {
    const m = (method || 'GET').toUpperCase();
    return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}
/**
 * 代理感知 fetch。
 * - direct=true 或未配置代理 → 原生全局 fetch（宿主 preload 场景自动被 EnvHttpProxyAgent 接管）
 * - http 代理 + GET/HEAD/OPTIONS + http 目标 → absolute-form（无需隧道）
 * - 其余 → 建隧道（CONNECT 或 socks5）后走原生 http(s) 客户端
 */
export async function netFetch(url, init = {}, proxyOverride) {
    const proxy = proxyOverride ?? current;
    const target = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = { ...(init.headers ?? {}) };
    const body = init.body ?? null;
    const timeoutMs = init.timeoutMs ?? 15000;
    const direct = init.direct === true || !isProxyEnabled(proxy) || (target.protocol !== 'http:' && target.protocol !== 'https:');
    if (direct) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('timeout after ' + timeoutMs + 'ms')), timeoutMs);
        try {
            const res = await fetch(target.toString(), {
                method, headers, body: body ?? undefined,
                signal: ctrl.signal, redirect: 'follow',
            });
            return wrapNative(res);
        }
        finally {
            clearTimeout(timer);
        }
    }
    const targetTls = target.protocol === 'https:';
    const targetPort = target.port ? Number(target.port) : targetTls ? 443 : 80;
    if (!needsTunnel(method) && !targetTls && proxy.type === 'http') {
        // http 目标 + http 代理 + 幂等方法：absolute-form
        return httpAbsoluteForm(proxy, target.toString(), method, headers, body, timeoutMs);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(new Error('timeout after ' + timeoutMs + 'ms')); }, timeoutMs);
    let settled = false; // 拿到响应头即视为完成：socket 必须存活供调用方惰性读 body
    try {
        let socket;
        try {
            socket = proxy.type === 'socks5'
                ? await socks5Connect(proxy, target.hostname, targetPort, ctrl.signal)
                : await httpProxyConnect(proxy, target.hostname, targetPort, ctrl.signal);
        }
        catch (e) {
            throw new Error('proxy(' + proxy.type + ' ' + proxy.host + ':' + proxy.port + ') connect ' + target.hostname + ':' + targetPort + ' failed: ' + (e instanceof Error ? e.message : String(e)));
        }
        const out = await tunneledRequest(socket, targetTls, target, method, headers, body, ctrl.signal);
        settled = true;
        return out;
    }
    finally {
        clearTimeout(timer);
        // 只能在响应未交付时 abort；响应已 resolve 后 abort 会销毁仍在被 collectBody 读取的 socket，把完整响应变成 Error('aborted')
        if (!settled)
            ctrl.abort();
    }
}
function httpAbsoluteForm(proxy, absoluteUrl, method, headers, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const auth = proxy.username ? 'Basic ' + Buffer.from(proxy.username + ':' + proxy.password, 'utf8').toString('base64') : undefined;
        const req = http.request({
            host: proxy.host,
            port: proxy.port,
            method,
            path: absoluteUrl,
            headers: { ...headers, ...(auth ? { 'Proxy-Authorization': auth } : {}) },
        });
        const timer = setTimeout(() => { req.destroy(new Error('timeout after ' + timeoutMs + 'ms')); }, timeoutMs);
        req.once('error', (e) => { clearTimeout(timer); reject(e); });
        req.on('response', (res) => { clearTimeout(timer); resolve(wrapIncoming(res)); });
        if (body)
            req.write(body);
        req.end();
    });
}
function tunneledRequest(socket, targetTls, target, method, headers, body, signal) {
    return new Promise((resolve, reject) => {
        const headersFinal = { Host: target.host, ...headers };
        const path = (target.pathname || '/') + target.search;
        const onAbort = () => { sock.destroy(); reject(new Error('aborted')); };
        const run = (sock) => {
            signal.addEventListener('abort', onAbort, { once: true });
            const mod = targetTls ? https : http;
            const req = mod.request({
                method,
                path,
                headers: headersFinal,
                createConnection: () => sock,
                ...(targetTls ? { servername: target.hostname } : {}),
            });
            req.once('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
            req.on('response', (res) => { signal.removeEventListener('abort', onAbort); resolve(wrapIncoming(res)); });
            if (body)
                req.write(body);
            req.end();
        };
        let sock = socket;
        if (targetTls) {
            const tlsSock = tls.connect({ socket, servername: target.hostname });
            tlsSock.once('secureConnect', () => { sock = tlsSock; run(tlsSock); });
            tlsSock.once('error', (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
            signal.addEventListener('abort', () => tlsSock.destroy(), { once: true });
        }
        else {
            run(socket);
        }
    });
}
/** 拉文本（非 2xx 抛错） */
export async function netFetchText(url, init) {
    const res = await netFetch(url, init);
    if (!res.ok)
        throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    return res.text();
}
//# sourceMappingURL=net.js.map