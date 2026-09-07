/**
 * @dsh-external/dsh-bangumi — 本地媒体库扫描。
 * 递归扫描用户配置的媒体目录，用 parseEpisode 解析每个视频文件的番/集/组/分辨率，
 * 产出「bangumi 归一化标题 -> 已存在的集号集合」。
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEpisode, normalizeTitle } from './parse.js';
const VIDEO_EXT = new Set(['mkv', 'mp4', 'm2ts', 'ts', 'avi', 'mov', 'flv', 'wmv', 'webm', 'rmvb', 'mpg', 'mpeg']);
async function walk(dir, depth, out) {
    if (depth > 10)
        return;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        if (e.name.startsWith('.'))
            continue;
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
            await walk(abs, depth + 1, out);
        }
        else if (e.isFile()) {
            const dot = e.name.lastIndexOf('.');
            if (dot < 0)
                continue;
            const ext = e.name.slice(dot + 1).toLowerCase();
            if (!VIDEO_EXT.has(ext))
                continue;
            let st;
            try {
                st = await stat(abs);
            }
            catch {
                continue;
            }
            const parsed = parseEpisode(e.name);
            const base = parsed.title && parsed.title.length > 1 ? parsed.title : e.name.replace(/\.\w+$/, '');
            out.push({
                path: abs,
                dir,
                name: e.name,
                size: st.size,
                mtimeMs: st.mtimeMs,
                parsed,
                normTitle: normalizeTitle(base),
            });
        }
    }
}
/** 由平铺文件列表聚合 normTitle -> 集号 -> 最优文件（同集保留更大的） */
export function buildByTitle(files) {
    const byTitle = {};
    for (const f of files) {
        if (f.parsed.episode === undefined)
            continue;
        const epKey = String(f.parsed.episode);
        const bucket = byTitle[f.normTitle] ?? (byTitle[f.normTitle] = {});
        const prev = bucket[epKey];
        if (!prev || prev.size < f.size)
            bucket[epKey] = f;
    }
    return byTitle;
}
/** 作品目录键：任一媒体根之后的首个路径段；Downloads 顶层散文件无作品段 → undefined */
export function dirKeyOf(f, roots) {
    const norm = f.path.replace(/\\/g, '/');
    for (const rootRaw of roots) {
        const root = rootRaw.trim().replace(/\\/g, '/').replace(/\/+$/, '');
        const prefix = root + '/';
        if (!norm.startsWith(prefix))
            continue;
        const rest = norm.slice(prefix.length);
        const seg = rest.split('/').filter(Boolean)[0];
        if (seg)
            return seg;
    }
    return undefined;
}
/** 按作品目录聚合（byTitle 之外的兜底维度；同集保留更大的） */
export function buildByDir(files, roots) {
    const byDir = {};
    for (const f of files) {
        if (f.parsed.episode === undefined)
            continue;
        const key = dirKeyOf(f, roots);
        if (!key)
            continue;
        const norm = normalizeTitle(key);
        if (!norm)
            continue;
        f.dirKey = key;
        f.dirNorm = norm;
        const epKey = String(f.parsed.episode);
        const bucket = byDir[norm] ?? (byDir[norm] = {});
        const prev = bucket[epKey];
        if (!prev || prev.size < f.size)
            bucket[epKey] = f;
    }
    return byDir;
}
/** 全量扫描媒体库目录 */
export async function scanLibrary(roots) {
    const files = [];
    for (const root of roots) {
        const r = root.trim();
        if (!r)
            continue;
        await walk(r, 0, files);
    }
    return { files, byTitle: buildByTitle(files), byDir: buildByDir(files, roots), scannedAt: Date.now(), roots };
}
/**
 * 一个订阅（含别名）在库里已拥有的集号集合。
 * 匹配维度（两路取集数更全者）：
 *  A. 文件名维度：别名归一后被库 normTitle 包含 / 或库 normTitle 被别名包含（原逻辑）
 *  B. 作品目录维度：别名与目录 dirNorm 匹配——目录是用户整理的作品分界，
 *     发布组花式文件名（Yani.Neko / Mushoku Tensei / Jaadugar…）碎成几十个 normTitle 时，
 *     目录仍是干净的「尼古喵喵 / 穹庐下的魔女」，与 bgm 中文别名直接对上。
 */
export function findEpisodesInLibrary(snapshot, aliases) {
    if (!snapshot || aliases.length === 0)
        return { episodes: [], count: 0 };
    const norms = aliases.map(normalizeTitle).filter((s) => s.length > 0);
    if (norms.length === 0)
        return { episodes: [], count: 0 };
    const epsOf = (eps) => Object.keys(eps).map((k) => parseFloat(k)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    let best;
    const consider = (key, eps) => {
        const hit = norms.some((n) => key.includes(n) || n.includes(key));
        if (!hit)
            return;
        const episodes = epsOf(eps);
        if (!best || episodes.length > best.episodes.length)
            best = { title: key, episodes };
    };
    for (const [normTitle, eps] of Object.entries(snapshot.byTitle))
        consider(normTitle, eps);
    for (const [dirNorm, eps] of Object.entries(snapshot.byDir))
        consider(dirNorm, eps);
    if (!best)
        return { episodes: [], count: 0 };
    return { episodes: best.episodes, matchedTitle: best.title, count: best.episodes.length };
}
/** 一个本地标题是否能匹配候选（别名归一后双向包含，规则同 findEpisodesInLibrary） */
export function titleMatchesCandidate(localTitle, cand) {
    const norm = normalizeTitle(localTitle);
    if (!norm)
        return false;
    const names = [];
    if (cand.name)
        names.push(cand.name);
    if (cand.nameCn)
        names.push(cand.nameCn);
    for (const a of cand.aliases ?? [])
        names.push(a);
    return names.map(normalizeTitle).filter((s) => s.length > 0).some((n) => norm.includes(n) || n.includes(norm));
}
/** 反查：给定候选列表，找能匹配该本地标题的最佳候选（取别名最长的那个，防泛化误配） */
export function findBestCandidate(localTitle, cands) {
    let best;
    let bestLen = -1;
    for (const c of cands) {
        if (!titleMatchesCandidate(localTitle, c))
            continue;
        const aliasLens = [];
        if (c.name)
            aliasLens.push(c.name.length);
        if (c.nameCn)
            aliasLens.push(c.nameCn.length);
        for (const a of c.aliases ?? [])
            aliasLens.push(a.length);
        const aliasLen = Math.max(0, ...aliasLens);
        if (aliasLen > bestLen) {
            best = c;
            bestLen = aliasLen;
        }
    }
    return best;
}
//# sourceMappingURL=library.js.map