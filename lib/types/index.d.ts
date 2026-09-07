import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "@dsh-external/dsh-bangumi";
export declare const inject: string[];
export interface Config {
    qbUrl: string;
    qbUsername: string;
    qbPassword: string;
    qbSavePath: string;
    qbCategory: string;
    qbTags: string;
    /** 分类根（如「番」）；番剧按 根/作品/第N季 分层归类 */
    qbCategoryRoot: string;
    /** 番剧保存根目录（如 /Volumes/一块硬盘/电影/番）；作品目录建在其下 */
    qbBaseDir: string;
    mediaDirs: string[];
    pollIntervalMinutes: number;
    minMatchScore: number;
    /** 订阅判新回看窗（天）：只自动下载订阅时刻起 N 天内新发布的集（防订阅即灌历史全集；连载周更天然每周 1-2 篇落窗内）；0=不限（慎用，会把 feed 内全部历史当新集） */
    rssIgnoreDays: number;
    /** AI 介入开关（强介入：每轮轮询/下载/媒体库扫描都经 AI 判断）；false=纯脚本 */
    aiEnabled: boolean;
    /** AI 路由（provider/model；后台无会话，必须显式指定，如 deepseek-official/deepseek-chat） */
    aiProvider: string;
    aiModel: string;
    /** 代理类型：none=直连（默认）；http/https/socks5 走设置页手动配置的出口 */
    proxyType: string;
    /** 代理主机 */
    proxyHost: string;
    /** 代理端口 */
    proxyPort: number;
    /** 代理用户名（可选） */
    proxyUsername: string;
    /** 代理密码（可选） */
    proxyPassword: string;
}
export declare const Config: z<Schemastery.ObjectS<{
    qbUrl: z<string, string>;
    qbUsername: z<string, string>;
    qbPassword: z<string, string>;
    qbSavePath: z<string, string>;
    qbCategory: z<string, string>;
    qbTags: z<string, string>;
    qbCategoryRoot: z<string, string>;
    qbBaseDir: z<string, string>;
    mediaDirs: z<string[], string[]>;
    pollIntervalMinutes: z<number, number>;
    minMatchScore: z<number, number>;
    rssIgnoreDays: z<number, number>;
    aiEnabled: z<boolean, boolean>;
    aiProvider: z<string, string>;
    aiModel: z<string, string>;
    proxyType: z<"none" | "http" | "https" | "socks5", "none" | "http" | "https" | "socks5">;
    proxyHost: z<string, string>;
    proxyPort: z<number, number>;
    proxyUsername: z<string, string>;
    proxyPassword: z<string, string>;
}>, Schemastery.ObjectT<{
    qbUrl: z<string, string>;
    qbUsername: z<string, string>;
    qbPassword: z<string, string>;
    qbSavePath: z<string, string>;
    qbCategory: z<string, string>;
    qbTags: z<string, string>;
    qbCategoryRoot: z<string, string>;
    qbBaseDir: z<string, string>;
    mediaDirs: z<string[], string[]>;
    pollIntervalMinutes: z<number, number>;
    minMatchScore: z<number, number>;
    rssIgnoreDays: z<number, number>;
    aiEnabled: z<boolean, boolean>;
    aiProvider: z<string, string>;
    aiModel: z<string, string>;
    proxyType: z<"none" | "http" | "https" | "socks5", "none" | "http" | "https" | "socks5">;
    proxyHost: z<string, string>;
    proxyPort: z<number, number>;
    proxyUsername: z<string, string>;
    proxyPassword: z<string, string>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
