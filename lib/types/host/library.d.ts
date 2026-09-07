import type { ParsedEpisode } from './parse.js';
export interface LibraryFile {
    path: string;
    dir: string;
    name: string;
    size: number;
    mtimeMs: number;
    parsed: ParsedEpisode;
    /** 归一化标题（normalizeTitle(parsed.title ?? name)） */
    normTitle: string;
    /** 扫描时的根目录（持久化行标记用） */
    root?: string;
    /** 作品目录键：任一媒体根之后的首个路径段（如「尼古喵喵」；顶层散文件为 undefined） */
    dirKey?: string;
    /** 作品目录键的归一化标题（同 normalizeTitle(dirKey)） */
    dirNorm?: string;
}
export interface LibrarySnapshot {
    /** 全部扫描到的文件 */
    files: LibraryFile[];
    /** normTitle -> 集号 -> 最佳文件 */
    byTitle: Record<string, Record<string, LibraryFile>>;
    /** 作品目录(dirNorm) -> 集号 -> 最佳文件；目录是用户整理好的作品分界，比文件名碎片可靠 */
    byDir: Record<string, Record<string, LibraryFile>>;
    /** 扫描时间戳 ms */
    scannedAt: number;
    /** 扫描的目录列表 */
    roots: string[];
}
/** 由平铺文件列表聚合 normTitle -> 集号 -> 最优文件（同集保留更大的） */
export declare function buildByTitle(files: LibraryFile[]): Record<string, Record<string, LibraryFile>>;
/** 作品目录键：任一媒体根之后的首个路径段；Downloads 顶层散文件无作品段 → undefined */
export declare function dirKeyOf(f: LibraryFile, roots: string[]): string | undefined;
/** 按作品目录聚合（byTitle 之外的兜底维度；同集保留更大的） */
export declare function buildByDir(files: LibraryFile[], roots: string[]): Record<string, Record<string, LibraryFile>>;
/** 全量扫描媒体库目录 */
export declare function scanLibrary(roots: string[]): Promise<LibrarySnapshot>;
/**
 * 一个订阅（含别名）在库里已拥有的集号集合。
 * 匹配维度（两路取集数更全者）：
 *  A. 文件名维度：别名归一后被库 normTitle 包含 / 或库 normTitle 被别名包含（原逻辑）
 *  B. 作品目录维度：别名与目录 dirNorm 匹配——目录是用户整理的作品分界，
 *     发布组花式文件名（Yani.Neko / Mushoku Tensei / Jaadugar…）碎成几十个 normTitle 时，
 *     目录仍是干净的「尼古喵喵 / 穹庐下的魔女」，与 bgm 中文别名直接对上。
 */
export declare function findEpisodesInLibrary(snapshot: LibrarySnapshot | null, aliases: string[]): {
    episodes: number[];
    matchedTitle?: string;
    count: number;
};
/** 供海报墙用的候选条目（本地标题 → bgm 条目反查的最小形状） */
export interface PosterCandidate {
    id: number;
    aliases: string[];
    name: string;
    nameCn?: string;
    airDate?: string;
    totalEpisodes?: number;
    images?: BangumiImageSet;
    platform?: string;
    summary?: string;
}
export interface BangumiImageSet {
    large?: string;
    common?: string;
    grid?: string;
}
/** 一个本地标题是否能匹配候选（别名归一后双向包含，规则同 findEpisodesInLibrary） */
export declare function titleMatchesCandidate(localTitle: string, cand: PosterCandidate): boolean;
/** 反查：给定候选列表，找能匹配该本地标题的最佳候选（取别名最长的那个，防泛化误配） */
export declare function findBestCandidate(localTitle: string, cands: PosterCandidate[]): PosterCandidate | undefined;
