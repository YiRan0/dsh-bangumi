import type { Message } from '@deepseek-ai/dsh-llm';
/** 与宿主 LlmRuntime.stream 兼容的最小子集（便于测试注入） */
export interface LlmStreamLike {
    stream(options: {
        provider: string;
        model: string;
        messages: readonly Message[];
        system?: string;
        maxTokens?: number;
        temperature?: number;
    }): AsyncIterable<{
        type?: string;
        text?: string;
        block?: {
            type?: string;
            text?: string;
        };
    }>;
}
export interface AiRoute {
    provider: string;
    model: string;
}
export interface AiReviewConfig {
    enabled: boolean;
    route?: AiRoute;
}
/** AI 审核层实例：持有 llm + 路由，提供三个介入点的判断 */
export declare class AiReviewer {
    private readonly llm;
    private readonly cfg;
    private readonly log;
    constructor(llm: LlmStreamLike, cfg: () => AiReviewConfig, log: (msg: string) => void);
    get enabled(): boolean;
    /** 通用单轮调用：组装 system+user，流式收全文，剥 ```json 围栏后 JSON.parse。失败返回 null。 */
    private ask;
    /** 介入点1 — 每轮轮询：审核候选清单，决定该下/该搜/该跳过。 */
    reviewCandidates(input: {
        subName: string;
        bangumiId: number;
        totalEpisodes?: number;
        finished: boolean;
        haveEpisodes: number[];
        candidates: Array<{
            episode?: number;
            full: boolean;
            range?: string;
            title: string;
            score: number;
            pubDate?: string;
            group?: string;
        }>;
        missingAired: number[];
    }): Promise<{
        decision: 'download-all' | 'download-selected' | 'hold' | 'search-backfill';
        selectedEpisodes: number[];
        backfillEpisodes: number[];
        reason: string;
    } | null>;
    /** 介入点2 — 每次下载前审核（单条种子是否真的该下/该换更好源）。 */
    reviewDownload(input: {
        subName: string;
        episode?: number;
        full: boolean;
        title: string;
        magnet: string;
        group?: string;
        resolution?: string;
        score: number;
        haveEpisodes: number[];
        totalEpisodes?: number;
    }): Promise<{
        approve: boolean;
        alternativeMagnet?: string;
        reason: string;
    } | null>;
    /** 介入点3 — 媒体库扫描后：判断新增文件是否异常/值得关注（如重复、缺集被补、新作品）。 */
    reviewLibrary(input: {
        addedFiles: number;
        changedWorks: Array<{
            name: string;
            episodes: number[];
            missing?: number[];
        }>;
        subscribedMissing: Array<{
            name: string;
            missing: number[];
        }>;
    }): Promise<{
        note: string;
        notifyMissing: boolean;
    } | null>;
}
