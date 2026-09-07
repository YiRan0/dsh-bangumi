/**
 * @dsh-external/dsh-bangumi — Bangumi(bgm.tv) API 客户端。
 * 仅匿名低并发读取（subject search / info / episodes），无需 token。
 */
export interface BangumiSubject {
    id: number;
    name: string;
    nameCn: string;
    airDate?: string;
    totalEpisodes?: number;
    images?: {
        large?: string;
        common?: string;
        grid?: string;
    };
    summary?: string;
    /** 衍生别名集合（搜索匹配用） */
    aliases?: string[];
    /** 放送平台：TV / 剧场版 / WEB / OVA 等 */
    platform?: string;
    /** 热门标签（前几个） */
    tags?: string[];
}
export interface BangumiEpisode {
    ep: number;
    airDate?: string;
    name?: string;
    nameCn?: string;
}
/** 番剧搜索：POST /search/subjects，type=2（动画） */
export declare function searchSubjects(keyword: string, limit?: number): Promise<BangumiSubject[]>;
/** 番剧详情 */
export declare function getSubject(id: number): Promise<BangumiSubject>;
/** 剧集列表（放送日期 —> 对应周几） */
export declare function getEpisodes(subjectId: number): Promise<BangumiEpisode[]>;
/** 取番详情（7 天缓存），附别名集合；miss 时打 API 并回填 */
export declare function getSubjectCached(id: number): Promise<{
    subject: BangumiSubject;
    aliases: string[];
    fromCache: boolean;
}>;
/** 取本篇剧集列表（6 小时缓存） */
export declare function getEpisodesCached(subjectId: number): Promise<BangumiEpisode[]>;
