export type ProxyType = 'none' | 'http' | 'https' | 'socks5';
export interface ProxyConfig {
    type: ProxyType;
    host: string;
    port: number;
    username: string;
    password: string;
}
export declare const NO_PROXY: ProxyConfig;
export declare function isProxyEnabled(p: ProxyConfig | null | undefined): boolean;
export interface NetResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text(): Promise<string>;
    json(): Promise<any>;
    buffer(): Promise<Buffer>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
/** 设置当前出口代理（设置页保存 / 初始化时调用；none 恢复直连） */
export declare function configureNet(p: ProxyConfig): void;
export declare function getNetConfig(): ProxyConfig;
/** 解析 "http://user:pass@host:port" 或 "socks5://host:port" 形式的字符串 */
export declare function parseProxyUrl(raw: string): ProxyConfig | null;
export interface NetRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | null;
    /** true = 强制直连（如本机 qB），忽略代理 */
    direct?: boolean;
    timeoutMs?: number;
}
/**
 * 代理感知 fetch。
 * - direct=true 或未配置代理 → 原生全局 fetch（宿主 preload 场景自动被 EnvHttpProxyAgent 接管）
 * - http 代理 + GET/HEAD/OPTIONS + http 目标 → absolute-form（无需隧道）
 * - 其余 → 建隧道（CONNECT 或 socks5）后走原生 http(s) 客户端
 */
export declare function netFetch(url: string, init?: NetRequestInit, proxyOverride?: ProxyConfig): Promise<NetResponse>;
/** 拉文本（非 2xx 抛错） */
export declare function netFetchText(url: string, init?: NetRequestInit): Promise<string>;
