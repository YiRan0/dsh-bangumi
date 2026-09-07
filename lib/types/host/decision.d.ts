/**
 * @dsh-external/dsh-bangumi — 订阅决策引擎（纯函数，可单测）。
 * 用户需求决策树（2026-09-04 定稿）：
 *  1. 判断剧集描述是否精准：完整名字搜索筛选（lookup 收敛，feed 用多别名打分匹配）
 *  2. 判断剧集是否完结：完结 → 优先全集资源
 *  3. 未完结 → 确认最新一集 + 本地已有 → 补全缺漏剧集至最新
 *  4. 后续新资源：判重（新增全集不下载避免重复；区间/单集已拥有则不收）
 *  5. 本地齐集 → 自动停订阅（completedAt 标记，不再轮询下载）
 */
import type { ScoredItem } from './match.js';
export type SubStatus = 'airing' | 'finished' | 'unknown';
/** 决策引擎的输入快照（订阅上下文 + 当日全量候选） */
export interface DecisionInput {
    /** 订阅番总集数（bgm 本篇数；undefined=未知） */
    totalEpisodes?: number;
    /** 已完结？（bgm episodes 端点：全部本篇 airdate 无未来 → true） */
    finished: boolean;
    /** 本地媒体库已拥有的集号 */
    libraryEpisodes: number[];
    /** qB 现有任务集号（含进行中） */
    qbEpisodes: number[];
    /** downloads 表已记录（单集 + 全集区间） */
    downloads: Array<{
        episode?: number;
        full?: boolean;
        rangeFrom?: number;
        rangeTo?: number;
    }>;
    /** 当日 feed 打分排序后的全部候选 */
    candidates: ScoredItem[];
    /** 期望分辨率（选种偏好） */
    preferResolution?: string;
    /** 期望发布组 */
    preferGroup?: string;
}
export interface DecisionAction {
    kind: 'download';
    scored: ScoredItem;
    /** 是否整包（全集/合集） */
    full: boolean;
    /** 整包覆盖集号区间 */
    rangeFrom?: number;
    rangeTo?: number;
    /** 单集时集号 */
    episode?: number;
    /** 决策理由（日志/展示） */
    why: string;
}
export interface DecisionResult {
    actions: DecisionAction[];
    /** 本轮已拥有（去重后新增的记入，模拟并集推进） */
    nowHave: Set<number>;
    /** 已全集覆盖（downloads 里 full 且区间含 [1..total]，或本次下了全集） */
    fullCovered: boolean;
    /** 全部集齐（含本次）？ */
    allCovered: boolean;
    /** 是否应该自动停订阅（本地齐集且完结） */
    stopSubscription: boolean;
}
/** 计算「已知拥有」的集号集合（本地库 ∪ qB ∪ downloads 单集 ∪ downloads 全集区间） */
export declare function collectHave(input: DecisionInput): Set<number>;
/**
 * 判断一个打分候选是否被「已有」覆盖：
 *  - 整包（pack.isPack）：区间 [from..to] 内集号已全部拥有 → 覆盖；部分拥有 → 部分覆盖（区间内仍有缺失 → 可下载）；全集无区间但 seasonFull → 若已知总集数且本地已全 → 覆盖
 *  - 单集：episode 已在 have → 覆盖
 */
export declare function isCovered(c: ScoredItem, have: Set<number>, input: DecisionInput): boolean;
/** 整包覆盖哪些缺失集（用于记录区间，防后续重复） */
export declare function packCoverage(c: ScoredItem, have: Set<number>): {
    missing: number[];
    from?: number;
    to?: number;
};
/**
 * 主决策：给定输入，返回本轮该下载的动作序列。
 * 规则：
 *  - finished：优先全集资源（区间包/合集，含无单集号全集）——一次补全；无全集则按缺集逐集补
 *  - airing：只下「缺失单集」——整包资源视为会与未来单集重复/灌历史 → 不选全集；补缺至最新
 *  - 全集/区间已覆盖缺失集 → 不重复下载（即使日期新）
 *  - 收尾：全部集齐 → stopSubscription（finished 时置）
 */
export declare function decideDownloads(input: DecisionInput): DecisionResult;
