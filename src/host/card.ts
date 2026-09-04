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

import type { BangumiSubject } from './bangumi.js'

export interface SubjectCardExtra {
  /** 本地媒体库已有集号（升序） */
  localEpisodes: number[]
  /** 总集数（bgm total_episodes/eps；未知为 undefined） */
  total: number | undefined
  /** 本地已下载集数 */
  downloaded: number
  /** 缺失集号（total 已知时计算；空数组表示齐集） */
  missing: number[]
  /** 订阅行（有则展示来源与订阅 id，并切换为退订操作） */
  subscription?: { id: string; source: string } | null
  /** 已放送集数（bgm episodes 有 airdate 且 ≤ 今日）；未知为 undefined */
  aired: number | undefined
  /** 放送状态描述；缺省按 total 未知 →「连载中，以实际为准」 */
  airedLabel?: string
}

/** 简介净化：bgm.tv 简介常带末尾来源标注「[简介原文]…」，截断前先剥离；再压空白截 160 字 */
function cleanSummary(s: string): string {
  const t = String(s || '').replace(/\s+/g, ' ')
  const idx = t.indexOf('[简介原文]')
  return (idx >= 0 ? t.slice(0, idx) : t).trim().slice(0, 160)
}

/** HTML 转义（标题/简介/标签均可能含 < > & "） */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 放进 onclick="input('...')" 的文本：去单引号防破属性 */
function cmdSafe(v: unknown): string {
  return String(v ?? '').replace(/'/g, '').trim()
}

/**
 * 渲染统一番剧信息卡（裸 HTML，以 <div id="vcp-root"> 开篇）。
 * 输出即完整卡片字符串：可作为工具返回值，由调用方原样写入回复正文。
 */
export function subjectCardHtml(sub: BangumiSubject, extra: SubjectCardExtra): string {
  const name = (sub.nameCn || sub.name || '').trim()
  const jpName = sub.nameCn && sub.name && sub.nameCn !== sub.name ? sub.name : ''
  const coverRaw = sub.images?.common ?? sub.images?.large ?? ''
  const cover = coverRaw ? '/api/bangumi/cover?u=' + encodeURIComponent(coverRaw) : ''
  const tags = (sub.tags ?? []).slice(0, 5)
  const missing = extra.missing.slice(0, 8)
  const missingMore = extra.missing.length - missing.length

  const stTotal = extra.total === undefined ? '?' : String(extra.total)
  const stAired = extra.aired === undefined ? '?' : String(extra.aired)
  const stLocal = String(extra.downloaded)

  // 下载进度：downloaded/total（total 未知或 0 → 不画条）
  const pct = extra.total && extra.total > 0
    ? Math.max(0, Math.min(100, Math.round((extra.downloaded / extra.total) * 100)))
    : -1
  const pbarHtml = pct >= 0
    ? '<div class="sc-pbar"><div class="sc-pbar-track"><div class="sc-pbar-fill" style="width:' + pct + '%"></div></div><span class="sc-pbar-tx">下载 <b>' + extra.downloaded + '/' + extra.total + '</b> · ' + pct + '%</span></div>'
    : ''

  // 订阅状态点（标题行右侧）
  const statusHtml = extra.subscription
    ? '<span class="sc-dot sc-dot-on"></span><span class="sc-stx sc-stx-on">已订阅' + (extra.subscription.source ? ' · ' + esc(extra.subscription.source) : '') + '</span>'
    : '<span class="sc-dot"></span><span class="sc-stx">未订阅</span>'

  // 底部操作：未订阅 → 追番订阅主按钮；已订阅 → 状态 pill + 退订次按钮
  const bangumiId = String(sub.id)
  const nameArg = cmdSafe(name)
  const ctaHtml = extra.subscription
    ? '<span class="sc-pill-on">已订阅' + (extra.subscription.source ? ' · ' + esc(extra.subscription.source) : '') + '</span>'
      + '<button class="sc-ghost" type="button" onclick="input(\'用 bangumi_unsubscribe 退订 ' + cmdSafe(extra.subscription.id) + '（' + nameArg + '）\')">退订</button>'
    : '<button class="sc-cta" type="button" onclick="input(\'用 bangumi_subscribe 订阅番剧 #' + bangumiId + '（' + nameArg + '，source dmhy）\')">'
      + '<svg width="11" height="11" viewBox="0 0 12 12" style="margin-right:4px;vertical-align:-1px"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>'
      + '追番订阅</button>'

  const missHtml = extra.total === undefined
    ? ''
    : extra.missing.length === 0
      ? '<span class="sc-miss sc-miss-ok">本地齐集</span>'
      : '<span class="sc-miss">缺 ' + missing.join(', ') + (missingMore > 0 ? ' 等 ' + (missingMore + missing.length) + ' 集' : '') + '</span>'

  const tagsHtml = tags.length
    ? '<div class="sc-tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>'
    : ''

  const coverHtml = cover
    ? '<img class="sc-img" src="' + esc(cover) + '" alt="' + esc(name) + '" loading="lazy">'
    : '<div class="sc-img sc-ph">' + esc(name.slice(0, 1)) + '</div>'

  const metaHtml = '<div class="sc-meta">'
    + (sub.airDate ? '<span>' + esc(sub.airDate) + ' 开播</span>' : '')
    + (sub.platform ? '<span class="sc-msep"></span><span>' + esc(sub.platform) + '</span>' : '')
    + '<span class="sc-msep"></span><a href="https://bgm.tv/subject/' + sub.id + '" target="_blank" rel="noopener noreferrer">bgm.tv #' + sub.id + ' ↗</a>'
    + '</div>'

  return '<div id="vcp-root" style="background:#fff;color:#24292f;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Hiragino Sans GB\',\'Microsoft YaHei\',sans-serif;font-size:13px;line-height:1.55;border:1px solid #e6e8eb;border-radius:14px;padding:14px;max-width:560px;box-sizing:border-box">'
    + '<style>'
    + '#vcp-root{box-sizing:border-box}'
    + '#vcp-root .sc{display:flex;gap:14px;align-items:flex-start}'
    + '#vcp-root .sc-cv{flex:none;width:96px;height:134px;border-radius:10px;overflow:hidden;background:#f2f3f5}'
    + '#vcp-root .sc-img{display:block;width:100%;height:100%;object-fit:cover;border-radius:10px;background:#f2f3f5;border:1px solid #eceef1}'
    + '#vcp-root .sc-ph{display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:600;color:#c6cbd1;border:none}'
    + '#vcp-root .sc-main{flex:1;min-width:0}'
    + '#vcp-root .sc-titlerow{display:flex;align-items:baseline;justify-content:space-between;gap:10px}'
    + '#vcp-root .sc-title{font-size:16px;font-weight:700;color:#111;margin:0}'
    + '#vcp-root .sc-stat-wrap{display:inline-flex;align-items:center;flex:none;white-space:nowrap}'
    + '#vcp-root .sc-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#c6cbd1;margin-right:5px;vertical-align:1px}'
    + '#vcp-root .sc-dot-on{background:#0a7d33}'
    + '#vcp-root .sc-stx{font-size:11px;color:#8b949e}'
    + '#vcp-root .sc-stx-on{color:#0a7d33;font-weight:600}'
    + '#vcp-root .sc-jp{font-size:12px;color:#8b949e;margin:2px 0 0}'
    + '#vcp-root .sc-meta{font-size:12px;color:#6e7781;margin:6px 0 0}'
    + '#vcp-root .sc-msep{display:inline-block;width:1px;height:9px;background:#d8dde2;margin:0 8px;vertical-align:-1px}'
    + '#vcp-root .sc-meta a{color:#0969da;text-decoration:none;border-bottom:1px dotted #7fb3f0;cursor:pointer}'
    + '#vcp-root .sc-meta a:hover{color:#0969da;border-bottom-color:#0969da}'
    + '#vcp-root .sc-stats{display:flex;gap:6px;margin:9px 0 0}'
    + '#vcp-root .st{display:inline-flex;align-items:baseline;gap:4px;font-size:11px;color:#6e7781;background:#f6f8fa;border:1px solid #eaeef2;border-radius:7px;padding:3px 9px}'
    + '#vcp-root .st b{font-size:14px;font-weight:700;color:#24292f}'
    + '#vcp-root .st-a b{color:#9a6700}'
    + '#vcp-root .st-l b{color:#0a7d33}'
    + '#vcp-root .sc-tags{margin:9px 0 0;font-size:0}'
    + '#vcp-root .sc-tags span{display:inline-block;font-size:11px;color:#6e7781;background:#f6f8fa;border:1px solid #eaeef2;border-radius:999px;padding:2px 8px;margin:0 6px 4px 0}'
    + '#vcp-root .sc-desc{font-size:12px;color:#57606a;margin:10px 0 0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '#vcp-root .sc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 0;padding-top:11px;border-top:1px solid #f0f1f3}'
    + '#vcp-root .sc-cta{display:inline-flex;align-items:center;font-family:inherit;font-size:12px;font-weight:600;color:#fff;background:#24292f;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;letter-spacing:.02em}'
    + '#vcp-root .sc-cta:hover{background:#000}'
    + '#vcp-root .sc-ghost{font-family:inherit;font-size:12px;color:#8b949e;background:transparent;border:1px solid #d8dde2;border-radius:8px;padding:5px 12px;cursor:pointer;margin-left:8px}'
    + '#vcp-root .sc-ghost:hover{color:#cf222e;border-color:#cf222e}'
    + '#vcp-root .sc-pill-on{display:inline-flex;align-items:center;font-size:12px;font-weight:600;color:#0a7d33;background:#e8f5ec;border-radius:8px;padding:6px 12px}'
    + '#vcp-root .sc-miss{font-size:12px;color:#b35900;text-align:right}'
    + '#vcp-root .sc-miss-ok{color:#0a7d33}'
    + '#vcp-root .sc-pbar{display:flex;align-items:center;gap:10px;margin:10px 0 0}'
    + '#vcp-root .sc-pbar-track{flex:1;height:6px;border-radius:999px;background:#eaeef2;overflow:hidden}'
    + '#vcp-root .sc-pbar-fill{height:100%;border-radius:999px;background:#0a7d33;min-width:0}'
    + '#vcp-root .sc-pbar-tx{font-size:11px;color:#6e7781;white-space:nowrap}'
    + '#vcp-root .sc-pbar-tx b{font-size:12px;color:#0a7d33;font-weight:700}'
    + '</style>'
    + '<div class="sc">'
    + '<div class="sc-cv">' + coverHtml + '</div>'
    + '<div class="sc-main">'
    + '<div class="sc-titlerow"><p class="sc-title">' + esc(name) + '</p><span class="sc-stat-wrap">' + statusHtml + '</span></div>'
    + (jpName ? '<p class="sc-jp">' + esc(jpName) + '</p>' : '')
    + metaHtml
    + '<div class="sc-stats"><span class="st st-t"><b>' + stTotal + '</b>总集数</span><span class="st st-a"><b>' + stAired + '</b>已放送</span><span class="st st-l"><b>' + stLocal + '</b>已下载</span></div>'
    + tagsHtml
    + '</div>'
    + '</div>'
    + pbarHtml
    + (sub.summary ? '<div class="sc-desc">' + esc(cleanSummary(sub.summary)) + '</div>' : '')
    + '<div class="sc-foot"><div>' + ctaHtml + '</div>' + missHtml + '</div>'
    + '</div>'
}
