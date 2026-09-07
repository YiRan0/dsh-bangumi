import type { PackInfo, ParsedEpisode } from './parse.js';
import type { RssItem } from './rss.js';
export interface MatchInput {
    /** Bangumi 别名集合（name, nameCn, infobox 别名） */
    aliases: string[];
    /** 期望分辨率（可选） */
    preferResolution?: string;
    /** 期望发布组（可选） */
    preferGroup?: string;
    /** 订阅季号：1=第一季。命中该季的标题才算数（异季条目如「第二季」在搜第一季时需剔除） */
    seasonOnly?: number;
    /** 是否接受整包资源（完结全集/合集等无单集号的种子） */
    wantFull?: boolean;
}
export interface ScoredItem {
    item: RssItem;
    score: number;
    reasons: string[];
    parsed: ParsedEpisode | undefined;
    pack?: PackInfo;
}
export declare function scoreItem(item: RssItem, input: MatchInput): ScoredItem;
/** 对一组 RssItem 评分并按分降序 */
export declare function rankItems(items: RssItem[], input: MatchInput): ScoredItem[];
