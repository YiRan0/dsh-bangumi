/**
 * @dsh-external/dsh-bangumi — 番剧文件名/种子标题解析。
 * 从发布组不规范的命名里提取：发布组 / 分辨率 / 集号 / 季，并给出归一化标题用于匹配。
 */
export interface ParsedEpisode {
    /** 发布组，如 VCB-Studio / ANi / 桜都字幕组 */
    group?: string;
    /** 分辨率，如 1080p / 720p / 2160p */
    resolution?: string;
    /** 集号（含 .5），无剧集含义时 undefined */
    episode?: number;
    /** 季号（S02/Season 2），默认 1 */
    season?: number;
    /** 抽取出的作品标题部分（去标签后） */
    title?: string;
}
/** 归一化标题：小写、去空白隔断、全角转半角常用符号、剥离标点，供包含匹配。 */
export declare function normalizeTitle(raw: string): string;
/** 从发布文件名解析集号信息。tolernat：解析不出时返回尽量多的字段。 */
export declare function parseEpisode(filename: string): ParsedEpisode;
/** 整包/合集识别结果：true=该种子是「一次含多集」的打包资源。 */
export interface PackInfo {
    isPack: boolean;
    /** 起止集号（含端点），单文件无此语义时 undefined */
    from?: number;
    to?: number;
    /** 单季覆盖（seasonFull=true 表示完全包含季号对应全部集） */
    seasonFull?: boolean;
    /** 文案特征：full/box/sp/fin/end 等（调试与展示） */
    flags: string[];
    /** 是否为跨季合集（S1+S2 / S01+S02，订阅单季时必须排除） */
    multiSeason?: boolean;
    /** 去掉跨季合并符后的子季列表（如 [1,2]） */
    seasons?: number[];
    /** 区间字符串（原始形态，如 01-28+SPx11 / 25-48） */
    rangeRaw?: string;
}
/**
 * 标题里常见的打包/区间形态（真实样本归纳）：
 *  1. 「01-28」/「01-28+SPx11」/「[25-48 修正合集]」/「01-24TV全集+SP」 显式区间
 *  2. 标记词：全集 / 合集 / 修正合集 / Fin / END / BOX / TV全集 等
 *  3. 跨季合集：S1+S2 / S01+S02（订阅单季时必须排除）
 * 返回 null = 无打包特征（普通单集或不可判定）。
 */
export declare function detectPack(raw: string): PackInfo | null;
