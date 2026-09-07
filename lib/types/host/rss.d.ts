/**
 * @dsh-external/dsh-bangumi — nyaa / 动漫花园 RSS 抓取与解析。
 * 无第三方依赖：手写轻量 XML/RSS 解析，容忍两个站的真实 RSS 变体。
 */
import { type ParsedEpisode } from './parse.js';
export interface RssItem {
    /** 种子发布组标题（含 [组][番][集][画质]） */
    title: string;
    /** magnet:?xt=... 链接（dmhy enclosure / nyaa 由 infoHash 合成） */
    magnet?: string;
    /** 种子详情页 */
    page?: string;
    /** 发布时间 ISO */
    pubDate?: string;
    /** nyaa 专属 */
    seeders?: number;
    size?: string;
    infoHash?: string;
    /** dmhy 专属：发布字幕组 */
    author?: string;
    /** parseEpisode 缓存 */
    parsed?: ParsedEpisode;
}
/** 解析 RSS 全文 -> items */
export declare function parseRss(xml: string): RssItem[];
/** 通用 fetch（UA + 超时） */
/** 通用文本拉取（UA + 超时；外网走可配置代理出口 net.ts，qB 等本机服务不受影响） */
export declare function fetchText(url: string, timeoutMs?: number): Promise<string>;
/** nyaa 搜索 RSS */
export declare function nyaaSearchUrl(query: string): string;
/** 动漫花园搜索 RSS */
export declare function dmhySearchUrl(query: string): string;
export declare function searchNyaa(query: string): Promise<RssItem[]>;
export declare function searchDmhy(query: string): Promise<RssItem[]>;
/** 通用 RSS 订阅源（订阅的 feedUrl 全量拉取） */
export declare function fetchFeed(url: string): Promise<RssItem[]>;
