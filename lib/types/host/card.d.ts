/**
 * @dsh-external/dsh-bangumi — 番剧信息卡统一模板（vcp-root HTML）。
 *
 * 设计定稿（用户 2026-09-04 版式 + 2026-09-05 订阅操作改版）：
 *   · 浅色白卡紧凑版式（宽 ≤560px）、朴素系统字体、无 emoji
 *   · 顶部：封面 + 标题（右侧订阅状态点）+ meta + stats 三格 + tags
 *   · 底部操作条：追番订阅/退订按钮（onclick=input() 走 VCP 交互回会话）
 *     ＋ 缺集/齐集状态
 * bangumi_lookup 工具与 REST /lookup 共用此模板，任何入口输出同一样式。
 * 模型拿到工具返回的 HTML 字符串后「原样透传到回复正文」即可渲染成卡。
 */
import type { BangumiSubject } from './bangumi.js';
export interface SubjectCardExtra {
    /** 本地媒体库已有集号（升序） */
    localEpisodes: number[];
    /** 总集数（bgm total_episodes/eps；未知为 undefined） */
    total: number | undefined;
    /** 本地已下载集数 */
    downloaded: number;
    /** 缺失集号（total 已知时计算；空数组表示齐集） */
    missing: number[];
    /** 订阅行（有则展示来源与订阅 id，并切换为退订操作） */
    subscription?: {
        id: string;
        source: string;
    } | null;
    /** 已放送集数（bgm episodes 有 airdate 且 ≤ 今日）；未知为 undefined */
    aired: number | undefined;
    /** 放送状态描述；缺省按 total 未知 →「连载中，以实际为准」 */
    airedLabel?: string;
}
/**
 * 渲染统一番剧信息卡（裸 HTML，以 <div id="vcp-root"> 开篇）。
 * 输出即完整卡片字符串：可作为工具返回值，由调用方原样写入回复正文。
 */
export declare function subjectCardHtml(sub: BangumiSubject, extra: SubjectCardExtra): string;
