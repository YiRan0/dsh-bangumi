/**
 * @dsh-external/dsh-bangumi — qBittorrent WebUI API 客户端（Cookie 认证）。
 * 覆盖：登录 / torrents.info / add / rss feed+rule / app preferences。
 */
export interface QbConfig {
    url: string;
    username?: string;
    password?: string;
}
export interface QbTorrent {
    hash: string;
    name: string;
    progress: number;
    state: string;
    savePath?: string;
    category?: string;
    tags?: string;
}
export declare class QbClient {
    private cfg;
    private cookie;
    constructor(cfg: QbConfig);
    private req;
    private authTried;
    /** 登录一次；失败则保持匿名（依赖 WebUI AuthSubnetWhitelist/LocalHostAuth 免登） */
    login(): Promise<boolean>;
    /** 测试连通与认证 */
    test(): Promise<{
        ok: boolean;
        version?: string;
        error?: string;
    }>;
    /** 按分类+标签拉取种子 */
    torrents(options?: {
        category?: string;
        tag?: string;
    }): Promise<QbTorrent[]>;
    /** 添加 magnet */
    addMagnet(magnet: string, opts?: {
        savePath?: string;
        category?: string;
        tags?: string;
        paused?: boolean;
    }): Promise<void>;
    /** 添加 RSS 订阅源（409 = 已存在，幂等成功） */
    addRssFeed(url: string, path?: string): Promise<void>;
    /** 移除 RSS 订阅源（qB v5 用 path 参数，值为 feed 条目的面板路径） */
    removeRssFeed(itemPath: string): Promise<void>;
    /** 增/改一条 RSS 下载规则 */
    setRssRule(name: string, def: Record<string, unknown>): Promise<void>;
    /** 删除 RSS 规则 */
    removeRssRule(name: string): Promise<void>;
    /** 创建分类（含 savePath）；已存在时幂等（qB 自动建中间层级） */
    createCategory(category: string, savePath?: string): Promise<void>;
    /** 现存分类清单（{category, savePath}，qB 返回含子分类） */
    categories(): Promise<Array<{
        category: string;
        savePath: string;
    }>>;
    /** 删除空分类（qB 要求分类下无任务，否则 409） */
    deleteCategory(category: string): Promise<void>;
    /** 修改单个任务分类 */
    setTorrentCategory(hashes: string, category: string): Promise<void>;
    /** 修改任务保存路径（contentLayout=Original 保留结构） */
    setTorrentSavePath(hashes: string, savePath: string): Promise<void>;
}
