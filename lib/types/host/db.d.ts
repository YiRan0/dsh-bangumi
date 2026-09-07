import type { Subscription, DownloadRecord } from './store.js';
import type { BangumiSubject, BangumiEpisode } from './bangumi.js';
import type { LibraryFile } from './library.js';
export declare const DB_DIR: string;
export declare const DB_PATH: string;
declare class BangumiDb {
    private db;
    constructor(path: string);
    listSubscriptions(): Subscription[];
    insertSubscription(sub: Subscription): void;
    updateSubscription(id: string, patch: Partial<Subscription>): void;
    getSubscription(id: string): Subscription | undefined;
    removeSubscription(id: string): void;
    addDownload(rec: DownloadRecord): void;
    listDownloads(): DownloadRecord[];
    replaceLibrary(files: LibraryFile[], roots: string[], scannedAt: number): void;
    loadLibraryFiles(): LibraryFile[];
    getLibraryMeta(): {
        scannedAt: number;
        roots: string[];
    };
    getSubjectCache(id: number): {
        subject: BangumiSubject;
        aliases: string[];
        savedAt: number;
    } | null;
    setSubjectCache(id: number, subject: BangumiSubject, aliases: string[]): void;
    /** 枚举全部缓存条目（含过期）——海报墙把本地标题匹配到条目拿封面用 */
    listSubjectCacheAll(): Array<{
        id: number;
        subject: BangumiSubject;
        aliases: string[];
    }>;
    getEpisodesCache(subjectId: number, allowStale?: boolean): {
        episodes: BangumiEpisode[];
        savedAt: number;
        stale: boolean;
    } | null;
    addLog(level: 'info' | 'warn' | 'error', tag: string, message: string): void;
    listLogs(limit?: number): Array<{
        id: number;
        ts: number;
        level: string;
        tag: string;
        message: string;
    }>;
    clearLogs(): void;
    setEpisodesCache(subjectId: number, episodes: BangumiEpisode[]): void;
    getSubjectCover(subjectId: number, url: string): {
        bytes: Uint8Array;
        contentType: string;
    } | null;
    putSubjectCover(subjectId: number, url: string, bytes: Uint8Array, contentType: string): void;
    private setMeta;
    private getMeta;
    /** 跨连接提交版本：热重载多 fiber 靠它侦测他人写入（本连接提交后也自增） */
    dataVersion(): number;
    /** 全量替换订阅 + 下载（store.ts 内存镜像的落库入口，事务内完成） */
    replaceAll(state: {
        subscriptions: Subscription[];
        downloads: DownloadRecord[];
    }): void;
    get tableStats(): Record<string, number>;
}
/** 惰性单例：热重载后新 fiber 各开各的句柄，WAL 保证并发安全 */
export declare function getDb(): BangumiDb;
/** 活动日记：插件全链路动作/错误的持久化记录（UI「日记」Tab 展示） */
export declare function logActivity(level: 'info' | 'warn' | 'error', tag: string, message: string): void;
export type { BangumiDb };
