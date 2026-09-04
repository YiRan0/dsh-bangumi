/**
 * @dsh-external/dsh-bangumi — client：侧边栏「追番」入口 + 对话列整页视图（4 Tab）。
 * 交互模型仿 dsh-mnemon：入口按钮 DOM 自愈放置于侧边栏（记忆入口下方），
 * 点击后对话列切换为独立整页面板；与 mnemon / taskboard / ssh 面板互斥。
 * 数据通道：fetch("/api/bangumi/...") 直连 host REST（无需 RPC）。
 * React 来自客户端外部化模块（tsdown neverBundle react / react-dom）。
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = { slots: SlotsService }

import { installDiag } from './diag'

export const inject = ['slots']

const zh = {
  title: '追番', subscriptions: '订阅', calendar: '日历', search: '检索', library: '媒体库', settings: '设置',
  loading: '加载中…', refresh: '刷新', remove: '退订', confirmRemove: '确认退订？',
  total: '总集数', downloaded: '已下载', libraryHit: '本地已有', source: '来源',
  noSubs: '暂无订阅——到「检索」里搜索番剧并订阅',
  searchPlaceholder: '番名（中日文皆可）…', searchRun: '搜索',
  subscribeDmhy: '订阅(dmhy)', subscribeNyaa: '订阅(nyaa)',
  localEps: '本地已有集数', score: '匹配分', download: '下载', downloadedMark: '已入列',
  episodes: '集', firstAir: '首播', close: '关闭', save: '保存', saved: '已保存并生效',
  qbUrl: 'qB WebUI 地址', qbUser: '用户名', qbPass: '密码', category: '分类', tags: '标签',
  categoryRoot: '分类根（番剧归到 根/作品[/第N季]）', baseDir: '番剧保存根目录', qbSavePathNote: '（旧默认保存目录，分类留空时兜底）',
  savePath: '保存目录', mediaDirs: '媒体库目录（每行一个）', pollMinutes: '轮询间隔(分钟)',
  qbStatus: 'qB 状态', scan: '立即扫描媒体库', scanning: '扫描中…', testConn: '测试连接',
  mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六', sun: '日', prev: '‹', next: '›',
  localEpShort: '本地', aired: '已放送', matchedNone: '（库中作品，未匹配番剧条目）', clickForDetail: '点击查看详情',
  subscribe: '订阅', subscribeTo: '去检索订阅', inLibrary: '库中集数', noSummary: '暂无简介',
}

type Dict = typeof zh
const en: Dict = {
  title: 'Bangumi', subscriptions: 'Subscriptions', calendar: 'Calendar', search: 'Search', library: 'Library', settings: 'Settings',
  loading: 'Loading…', refresh: 'Refresh', remove: 'Remove', confirmRemove: 'Confirm remove?',
  total: 'Total', downloaded: 'Downloaded', libraryHit: 'Already in library', source: 'Source',
  noSubs: 'No subscriptions yet — search a show in the Search tab and subscribe',
  searchPlaceholder: 'Show name…', searchRun: 'Search',
  subscribeDmhy: 'Subscribe (dmhy)', subscribeNyaa: 'Subscribe (nyaa)',
  localEps: 'Episodes already in library', score: 'score', download: 'Download', downloadedMark: 'Queued',
  episodes: 'eps', firstAir: 'First air', close: 'Close', save: 'Save', saved: 'Saved',
  qbUrl: 'qB WebUI URL', qbUser: 'Username', qbPass: 'Password', category: 'Category', tags: 'Tags',
  categoryRoot: 'Category root (shows land under root/title[/Sx])', baseDir: 'Anime save root dir', qbSavePathNote: '(legacy fallback save path when category empty)',
  savePath: 'Save path', mediaDirs: 'Media library dirs (one per line)', pollMinutes: 'Poll interval (min)',
  qbStatus: 'qB status', scan: 'Scan library now', scanning: 'Scanning…', testConn: 'Test connection',
  mon: 'Mo', tue: 'Tu', wed: 'We', th: 'Thu', fri: 'Fr', sat: 'Sa', sun: 'Su', prev: '‹', next: '›',
  localEpShort: 'Local', aired: 'Aired', matchedNone: '（in library, no bgm match yet）', clickForDetail: 'Click for details',
  subscribe: 'Subscribe', subscribeTo: 'Subscribe via Search', inLibrary: 'In library', noSummary: 'No summary',
}

const isZh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh')
const t: Dict = isZh ? zh : en

const api = {
  async get(path: string) {
    const res = await fetch('/api/bangumi' + path)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error ?? ('HTTP ' + res.status))
    return body
  },
  async post(path: string, payload: unknown) {
    const res = await fetch('/api/bangumi' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error ?? ('HTTP ' + res.status))
    return body
  },
}

/* 侧边栏按钮 SVG：电视（追番） */
const ENTRY_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="8.2" rx="1.6"/><path d="M5.4 2.6 4.2 1M10.6 2.6l1.2-1.6M6.2 10.8v2.6M9.8 10.8v2.6M4 13.4h8"/></svg>'

/* ---------------- 控制器：sidebar 入口 ↔ 对话列整页视图 共享状态 ---------------- */
type Listener = () => void
class PanelController {
  snapshot: { open: boolean } = { open: false }
  private listeners = new Set<Listener>()
  getSnapshot = () => this.snapshot
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
  open = () => this.setOpen(true, true)
  close = () => this.setOpen(false)
  toggle = () => this.setOpen(!this.snapshot.open)
  private setOpen(open: boolean, reassert = false) {
    if (this.snapshot.open === open && !reassert) return
    this.snapshot = { open }
    for (const l of this.listeners) l()
  }
}

/* ---------------- DOM 常量（对齐 dsh-mnemon 的实现契约） ---------------- */
const SIDEBAR_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar'
const CONVERSATION_SELECTOR = '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface'
const SIDEBAR_CONTEXT_SELECTOR = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
const ACTIVATE_EVENT = 'dsh-panel-activate'

/* 我们的 family 标记与三个既有面板 */
const ENTRY_ATTR = 'data-dsh-bangumi-entry'
const ACTIVE_ATTR = 'data-dsh-bangumi-active'
const VIEW_ATTR = 'data-dsh-bangumi-view'
const OTHER_ACTIVES = ['data-dsh-taskboard-active', 'data-dsh-ssh-active', 'data-dsh-mnemon-active'] as const
/* 放置锚点 family：既有面板入口 + 自己 */
const FAMILY_SELECTOR = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [' + ENTRY_ATTR + ']'

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector(SIDEBAR_SELECTOR)
  if (!(column instanceof HTMLElement)) return undefined
  return column.querySelector('[class*="logoRow"]')?.parentElement ?? (column.firstElementChild as HTMLElement | null) ?? undefined
}
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested instanceof HTMLButtonElement) return nested
  for (const child of root.children) if (child instanceof HTMLButtonElement) return child
  return undefined
}

const CSS = [
  /* ---- 对话列整页视图（含互斥条件；只在 bangumi 激活时生效，绝不影响其它面板） ---- */
  '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface{position:relative}',
  '[' + VIEW_ATTR + ']{z-index:60;background:var(--dsw-alias-bg-base);min-width:0;min-height:0;display:none;position:absolute;inset:0;overflow:hidden;flex-direction:column}',
  'html[' + ACTIVE_ATTR + ']:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [' + VIEW_ATTR + ']{display:flex}',
  'html[' + ACTIVE_ATTR + ']:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [data-pane="conversation"]>:not([' + VIEW_ATTR + ']),html[' + ACTIVE_ATTR + ']:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [class*="centerCol"]>:not([' + VIEW_ATTR + ']),html[' + ACTIVE_ATTR + ']:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) .dshDesktopConversationSurface>:not([' + VIEW_ATTR + ']){display:none!important}',
  /* ---- 侧边栏入口按钮（仿 mnemon 官方行样式） ---- */
  '.bg_entry{box-sizing:border-box;width:100%;min-height:36px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:none;border:none;border-radius:8px;align-items:center;gap:10px;padding:0 10px;font-size:13px;display:flex;font-family:inherit}',
  '.bg_entry:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.bg_entry[' + ACTIVE_ATTR + ']{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);font-weight:600}',
  '.bg_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex}',
  '.bg_entryIcon svg{width:18px;height:18px;display:block}',
  '.bg_entryLabel{text-overflow:ellipsis;overflow:hidden}',
  '[data-dsh-frame][data-sidebar-collapsed] .bg_entry{border-radius:50%;justify-content:center;width:36px;min-height:36px;margin:0 auto;padding:0}',
  '[data-dsh-frame][data-sidebar-collapsed] .bg_entryLabel{display:none}',
  /* ---- 整页面板内部 ---- */
  '.bg_page{flex:1;min-height:0;display:flex;flex-direction:column}',
  '.bg_head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.bg_title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary)}',
  '.bg_tabs{display:flex;gap:2px;flex:1}',
  '.bg_tab{appearance:none;border:0;background:none;font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.bg_tabOn{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}',
  '.bg_close{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.bg_view{flex:1;min-height:0;overflow:auto;padding:14px 16px}',
  '.bg_rows{display:flex;flex-direction:column;gap:8px}',
  '.bg_row{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
  '.bg_rowMain{flex:1;min-width:0}',
  '.bg_rowTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.bg_rowSub{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
  '.bg_hitRow{margin-top:5px}',
  '.bg_prog{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
  '.bg_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
  '.bg_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.bg_btn.danger{border-color:#ef4444;color:#ef4444}',
  '.bg_empty{font-size:13px;color:var(--dsw-alias-label-tertiary);padding:16px 4px}',
  '.bg_err{margin:0 0 8px;font-size:12px;color:#ef4444;white-space:pre-wrap}',
  '.bg_search{display:flex;gap:8px;margin-bottom:12px}',
  '.bg_input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px}',
  '.bg_subject{padding:10px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
  '.bg_hit{display:inline-block;font-size:11px;color:#059669;background:rgba(5,150,105,.12);border-radius:6px;padding:2px 8px;margin-left:8px}',
  '.bg_torrent{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-bottom:6px}',
  '.bg_tTitle{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.bg_chip{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;white-space:nowrap}',
  '.bg_chip.local{color:#059669;border-color:#059669}',
  '.bg_field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
  '.bg_label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.bg_textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px;min-height:72px;resize:vertical}',
  '.bg_grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}',
  '.bg_cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
  '.bg_calHead{font-size:11px;text-align:center;color:var(--dsw-alias-label-tertiary);padding:4px 0}',
  '.bg_cell{min-height:72px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 6px;overflow:hidden}',
  '.bg_cellDim{opacity:.35}',
  '.bg_cellToday{border-color:var(--dsw-alias-brand-primary)}',
  '.bg_dayNum{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.bg_item{font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.bg_calBar{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
  '.bg_calLabel{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  /* ---- 媒体库海报墙 ---- */
  '.bg_libToolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px}',
  '.bg_libCount{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1}',
  '.bg_posters{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:12px}',
  '.bg_poster{display:flex;flex-direction:column;gap:6px;background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;min-width:0}',
  '.bg_poster:hover .bg_posterImg{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.18)}',
  '.bg_posterImg{aspect-ratio:2/3;width:100%;object-fit:cover;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 2px 6px rgba(0,0,0,.1);transition:transform .15s ease,box-shadow .15s ease}',
  '.bg_posterPh{aspect-ratio:2/3;width:100%;display:flex;align-items:center;justify-content:center;border-radius:8px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:34px;font-weight:600}',
  '.bg_posterName{font-size:12px;line-height:15px;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
  '.bg_posterMeta{font-size:10px;color:var(--dsw-alias-label-tertiary);display:flex;gap:6px;align-items:center;flex-wrap:nowrap}',
  '.bg_pdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
  '.bg_pdot.sub{background:#059669}',
  '.bg_badge{display:inline-block;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
  /* ---- 海报详情弹层 ---- */
  '.bg_overlay{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}',
  '.bg_modal{width:min(560px,94vw);max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:18px;display:flex;flex-direction:column;gap:12px}',
  '.bg_mHead{display:flex;gap:14px}',
  '.bg_mCover{width:120px;height:170px;object-fit:cover;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);flex:none}',
  '.bg_mPh{width:120px;height:170px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:44px;font-weight:600;flex:none}',
  '.bg_mTitle{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary);line-height:1.35}',
  '.bg_mSub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px 10px}',
  '.bg_mStats{display:flex;gap:8px;margin-top:10px}',
  '.bg_mStat{flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;text-align:center;background:var(--dsw-alias-bg-layer-2)}',
  '.bg_mStat b{display:block;font-size:15px;color:var(--dsw-alias-label-primary)}',
  '.bg_mStat span{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
  '.bg_mDesc{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:180px;overflow:auto}',
  '.bg_mFoot{display:flex;gap:8px;justify-content:flex-end;align-items:center}',
  '.bg_mSubBadge{font-size:11px;color:#059669;background:rgba(5,150,105,.12);border-radius:6px;padding:3px 8px;margin-right:auto}',
  '.bg_mProgRow{display:flex;flex-direction:column;gap:5px;margin-top:2px}',
  '.bg_mProg{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
  '.bg_mProg .lab{flex:none;width:40px;text-align:right;color:var(--dsw-alias-label-tertiary)}',
  '.bg_mProg .tr{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
  '.bg_mProg .tr .fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-accent,#3b82f6)}',
  '.bg_mProg .tr .fill.air{background:#9a6700}',
  '.bg_mProg .tr .fill.dl{background:#0a7d33}',
  '.bg_mProg .n{flex:none;font-variant-numeric:tabular-nums}',
].join('\n')

function useCss(): void {
  React.useEffect(() => {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
}

/* ---------------- 子组件（四个 Tab，页面模式复用） ---------------- */
const h = React.createElement

type SubRow = {
  id: string; name: string; nameCn: string; source: string
  totalEpisodes?: number; weekday?: number; airDate?: string
  progress?: { total?: number; downloaded: number; library: number[]; missing: number[] } | null
}

function Subscriptions(): React.ReactElement {
  const [rows, setRows] = React.useState<SubRow[] | null>(null)
  const [err, setErr] = React.useState('')
  const load = React.useCallback(async () => {
    try { setRows((await api.get('/subscriptions')).subscriptions) } catch (e: any) { setErr(String(e.message ?? e)) }
  }, [])
  React.useEffect(() => { void load() }, [load])
  if (err) return h('div', { className: 'bg_err' }, err)
  if (!rows) return h('div', { className: 'bg_empty' }, t.loading)
  if (!rows.length) return h('div', { className: 'bg_empty' }, t.noSubs)
  return h('div', { className: 'bg_rows' },
    rows.map((r) => h('div', { key: r.id, className: 'bg_row' },
      h('div', { className: 'bg_rowMain' },
        h('div', { className: 'bg_rowTitle' }, r.nameCn || r.name),
        r.progress && r.progress.library.length > 0
          ? h('div', { className: 'bg_hitRow' },
            h('span', { className: 'bg_hit' }, t.libraryHit + ' ' + r.progress.library.length + t.episodes))
          : null,
        h('div', { className: 'bg_rowSub' },
          r.source.toUpperCase(),
          ' · ', t.firstAir + ' ' + (r.airDate ?? '?'),
          r.progress?.missing?.length ? ' · 缺 ' + r.progress.missing.join(',') : ''),
      ),
      h('div', { className: 'bg_prog' },
        t.downloaded + ' ' + (r.progress?.downloaded ?? '?') + ' / ' + t.total + ' ' + (r.totalEpisodes ?? '?')),
      h('button', {
        className: 'bg_btn danger',
        onClick: () => {
          if (!confirm(t.confirmRemove)) return
          void api.post('/subscriptions/delete', { id: r.id }).then(load).catch((e) => setErr(String(e)))
        },
      }, t.remove),
    )),
  )
}

function Calendar(): React.ReactElement {
  const now = new Date()
  const [month, setMonth] = React.useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [data, setData] = React.useState<Record<string, Array<{ name: string; nameCn: string; episode: number | null }>>>({})
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    void api.get('/calendar?year=' + month.y + '&month=' + month.m)
      .then((r) => {
        const map: Record<string, any[]> = {}
        for (const day of r.calendar ?? []) map[day.date] = day.items
        setData(map)
      })
      .catch((e) => setErr(String(e.message ?? e)))
  }, [month])
  const days = new Date(month.y, month.m, 0).getDate()
  const firstWeekday = new Date(month.y, month.m - 1, 1).getDay()
  const cells: React.ReactNode[] = []
  const heads = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat]
  for (let i = 0; i < firstWeekday; i += 1) cells.push(h('div', { key: 'x' + i, className: 'bg_cell bg_cellDim' }))
  for (let d = 1; d <= days; d += 1) {
    const iso = month.y + '-' + String(month.m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const items = data[iso] ?? []
    const isToday = d === now.getDate() && month.m === now.getMonth() + 1 && month.y === now.getFullYear()
    cells.push(h('div', { key: iso, className: 'bg_cell' + (isToday ? ' bg_cellToday' : '') },
      h('div', { className: 'bg_dayNum' }, String(d)),
      items.map((it, i) => h('div', { key: i, className: 'bg_item', title: it.nameCn || it.name },
        (it.nameCn || it.name) + (it.episode ? ' EP' + it.episode : ''))),
    ))
  }
  return h('div', null,
    h('div', { className: 'bg_calBar' },
      h('button', { className: 'bg_btn', onClick: () => setMonth((p) => { const d = new Date(p.y, p.m - 2, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } }) }, t.prev),
      h('div', { className: 'bg_calLabel' }, month.y + '/' + String(month.m).padStart(2, '0')),
      h('button', { className: 'bg_btn', onClick: () => setMonth((p) => { const d = new Date(p.y, p.m, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } }) }, t.next),
    ),
    err ? h('div', { className: 'bg_err' }, err) : null,
    h('div', { className: 'bg_cal' },
      heads.map((wd, i) => h('div', { key: i, className: 'bg_calHead' }, wd)),
      cells,
    ),
  )
}

type SearchResult = {
  subject: { id: number; name: string; nameCn?: string; airDate?: string; totalEpisodes?: number }
  localEpisodes?: number[]
  items: Array<{ title: string; magnet?: string; score: number; resolution?: string; group?: string; seeders?: number; episode?: number }>
}

function SearchTab(): React.ReactElement {
  const [kw, setKw] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<Array<{ id: number; name: string; nameCn?: string; airDate?: string; totalEpisodes?: number }> | null>(null)
  const [detail, setDetail] = React.useState<SearchResult | null>(null)
  const [err, setErr] = React.useState('')
  const [doneMagnet, setDoneMagnet] = React.useState<Record<string, boolean>>({})

  const run = () => {
    if (!kw.trim()) return
    setBusy(true); setErr(''); setDetail(null)
    void api.get('/bangumi-search?q=' + encodeURIComponent(kw))
      .then((r) => setResults(r.results ?? []))
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }

  const pick = (id: number) => {
    setBusy(true); setErr('')
    void api.get('/search?bangumiId=' + id + '&source=both')
      .then((r) => setDetail({ subject: r.subject, localEpisodes: r.localEpisodes ?? [], items: r.items ?? [] }))
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }

  const subscribe = (source: 'nyaa' | 'dmhy') => {
    if (!detail) return
    setErr('')
    void api.post('/subscriptions', { bangumiId: detail.subject.id, source })
      .then(() => { setDetail(null); setResults(null) })
      .catch((e) => setErr(String(e.message ?? e)))
  }

  const localSet = new Set(detail?.localEpisodes ?? [])

  return h('div', null,
    h('div', { className: 'bg_search' },
      h('input', {
        className: 'bg_input', value: kw, placeholder: t.searchPlaceholder,
        onChange: (e: any) => setKw(e.target.value),
        onKeyDown: (e: any) => { if (e.key === 'Enter') run() },
      }),
      h('button', { className: 'bg_btn', onClick: run, disabled: busy }, busy ? t.loading : t.searchRun),
    ),
    err ? h('div', { className: 'bg_err' }, err) : null,
    results && !detail ? h('div', { className: 'bg_rows' },
      results.map((s) => h('div', { key: s.id, className: 'bg_row' },
        h('div', { className: 'bg_rowMain' },
          h('div', { className: 'bg_rowTitle' }, s.nameCn || s.name),
          h('div', { className: 'bg_rowSub' }, (t.firstAir + ' ' + (s.airDate ?? '?')) + ' · ' + (s.totalEpisodes ?? '?') + ' ' + t.episodes),
        ),
        h('button', { className: 'bg_btn', onClick: () => pick(s.id) }, t.searchRun),
      )),
    ) : null,
    detail ? h('div', null,
      h('div', { className: 'bg_subject' },
        h('div', { className: 'bg_rowTitle' }, detail.subject.nameCn || detail.subject.name),
        h('div', { className: 'bg_rowSub' },
          (t.firstAir + ' ' + (detail.subject.airDate ?? '?')) + ' · ' + (detail.subject.totalEpisodes ?? '?') + ' ' + t.episodes,
          detail.localEpisodes.length
            ? ' · ' + t.localEps + ': ' + detail.localEpisodes.join(',')
            : ' · ' + t.localEps + ': —'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
          h('button', { className: 'bg_btn', onClick: () => subscribe('dmhy') }, t.subscribeDmhy),
          h('button', { className: 'bg_btn', onClick: () => subscribe('nyaa') }, t.subscribeNyaa),
        ),
      ),
      detail.items.slice(0, 40).map((it, i) => h('div', { key: i, className: 'bg_torrent' },
        h('div', { className: 'bg_tTitle', title: it.title }, it.title),
        h('span', { className: 'bg_chip' }, t.score + ' ' + it.score),
        it.resolution ? h('span', { className: 'bg_chip' }, it.resolution) : null,
        it.group ? h('span', { className: 'bg_chip' }, it.group) : null,
        it.episode !== undefined && localSet.has(it.episode)
          ? h('span', { className: 'bg_chip local' }, '⬇ ' + t.libraryHit + ' EP' + it.episode)
          : null,
        typeof it.seeders === 'number' ? h('span', { className: 'bg_chip' }, '🌱' + it.seeders) : null,
        h('button', {
          className: 'bg_btn',
          disabled: !it.magnet || !!doneMagnet[it.title],
          onClick: () => {
            if (!it.magnet) return
            void api.post('/download', { magnet: it.magnet, title: it.title })
              .then(() => setDoneMagnet((m) => ({ ...m, [it.title]: true })))
              .catch((e) => setErr(String(e.message ?? e)))
          },
        }, doneMagnet[it.title] ? t.downloadedMark : t.download),
      )),
    ) : null,
  )
}

function SettingsTab(): React.ReactElement {
  const [cfg, setCfg] = React.useState<any>(null)
  const [err, setErr] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const [scanning, setScanning] = React.useState(false)
  const [qb, setQb] = React.useState<{ ok?: boolean; version?: string; error?: string } | null>(null)
  React.useEffect(() => {
    void api.get('/settings').then((r) => setCfg(r.settings)).catch((e) => setErr(String(e.message ?? e)))
    void api.get('/qb/status').then(setQb).catch((e) => setQb({ ok: false, error: String((e as any)?.message ?? e) }))
  }, [])
  const update = (k: string, v: unknown) => setCfg((c: any) => ({ ...c, [k]: v }))
  const save = () => {
    setErr(''); setSaved(false)
    void api.post('/settings', cfg)
      .then((r) => { setCfg(r.settings); setSaved(true) })
      .catch((e) => setErr(String(e.message ?? e)))
  }
  if (!cfg) return h('div', { className: 'bg_empty' }, t.loading)
  const field = (label: string, key: string, type = 'text') =>
    h('label', { key, className: 'bg_field' },
      h('span', { className: 'bg_label' }, label),
      h('input', { className: 'bg_input', type, value: cfg[key] ?? '', onChange: (e: any) => update(key, e.target.value) }),
    )
  return h('div', null,
    err ? h('div', { className: 'bg_err' }, err) : null,
    h('div', { className: 'bg_grid' },
      field(t.qbUrl, 'qbUrl'),
      field(t.qbUser, 'qbUsername'),
      field(t.qbPass, 'qbPassword', 'password'),
      field(t.categoryRoot, 'qbCategoryRoot'),
      field(t.baseDir, 'qbBaseDir'),
      field(t.tags, 'qbTags'),
      field(t.savePath, 'qbSavePath'),
      field(t.pollMinutes, 'pollIntervalMinutes', 'number'),
    ),
    h('label', { className: 'bg_field' },
      h('span', { className: 'bg_label' }, t.mediaDirs),
      h('textarea', {
        className: 'bg_textarea', value: (cfg.mediaDirs ?? []).join('\n'),
        onChange: (e: any) => update('mediaDirs', e.target.value.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)),
      }),
    ),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('button', { className: 'bg_btn', onClick: save }, t.save),
      saved ? h('span', { className: 'bg_chip local' }, t.saved) : null,
      h('button', {
        className: 'bg_btn', disabled: scanning,
        onClick: () => { setScanning(true); void api.post('/library/scan', {}).catch(() => undefined).finally(() => setScanning(false)) },
      }, scanning ? t.scanning : t.scan),
      h('button', {
        className: 'bg_btn',
        onClick: () => void api.get('/qb/status').then(setQb).catch((e) => setQb({ ok: false, error: String((e as any)?.message ?? e) })),
      }, t.testConn),
    ),
    qb ? h('div', { className: 'bg_rowSub', style: { marginTop: '10px' } },
      t.qbStatus + ': ' + (qb.ok ? 'OK (' + (qb.version ?? '?') + ')' : '✕ ' + (qb.error ?? 'fail')),
    ) : null,
  )
}

type Poster = {
  key: string
  displayName: string
  episodes: number[]
  id?: number
  name?: string
  nameCn?: string
  airDate?: string
  totalEpisodes?: number
  aired?: number
  platform?: string
  summary?: string
  cover?: string
  subscribed?: boolean
  subscriptionId?: string
  source?: string
}

/** 媒体库 Tab：海报墙（目录聚合卡片）+ 点击弹详情层（简介/放送/下载进度） */
function LibraryTab(): React.ReactElement {
  const [posters, setPosters] = React.useState<Poster[] | null>(null)
  const [sel, setSel] = React.useState<Poster | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [err, setErr] = React.useState('')

  const load = () => {
    setErr('')
    void api.get('/library/posters')
      .then((r) => setPosters(r.posters ?? []))
      .catch((e) => setErr(String(e.message ?? e)))
  }
  React.useEffect(load, [])

  // Esc 关闭弹层
  React.useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  const scan = () => {
    setScanning(true); setErr('')
    void api.post('/library/scan', {}).then(load).catch((e) => setErr(String(e.message ?? e))).finally(() => setScanning(false))
  }

  const name = (p: Poster) => p.nameCn || p.name || p.displayName

  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // 封面或占位（首字符）
  const coverEl = (p: Poster, clsImg: string, clsPh: string, big = false) =>
    p.cover
      ? h('img', { key: p.key, className: clsImg, src: p.cover, alt: '', loading: 'lazy', draggable: false,
          onError: (e: any) => { const el = e.currentTarget as HTMLElement; el.style.display = 'none'; el.nextElementSibling?.removeAttribute('style') } })
      : h('div', { className: clsPh, style: { fontSize: big ? undefined : undefined } },
          (name(p) || '?').slice(0, 1).toUpperCase())

  // 进度条行：label + 轨道 + n/total；分母未知时返回 null（整行不渲染）
  const barRow = (label: string, n: number | undefined, tot: number | undefined, cls: string): React.ReactElement | null => {
    if (tot === undefined || tot <= 0) return null
    const v = Math.min(Math.max(n ?? 0, 0), tot)
    const pct = Math.round((v / tot) * 100)
    return h('div', { className: 'bg_mProg' },
      h('span', { className: 'lab' }, label),
      h('span', { className: 'tr' }, h('span', { className: 'fill ' + cls, style: { width: pct + '%' } })),
      h('span', { className: 'n' }, String(v) + ' / ' + tot),
    )
  }

  return h('div', null,
    err ? h('div', { className: 'bg_err' }, err) : null,
    h('div', { className: 'bg_libToolbar' },
      h('span', { className: 'bg_libCount' },
        posters === null ? t.loading : (isZh ? posters.length + ' 部作品' : posters.length + ' works') ),
      h('button', { className: 'bg_btn', disabled: scanning, onClick: scan }, scanning ? t.scanning : t.scan),
      h('button', { className: 'bg_btn', onClick: load }, t.refresh),
    ),
    posters && posters.length === 0
      ? h('div', { className: 'bg_empty' }, t.noSubs)
      : h('div', { className: 'bg_posters' },
          (posters ?? []).map((p) => h('button', {
            key: p.key, className: 'bg_poster', title: name(p),
            onClick: () => setSel(p),
          },
            coverEl(p, 'bg_posterImg', 'bg_posterPh'),
            h('span', { className: 'bg_posterName' }, name(p)),
            h('span', { className: 'bg_posterMeta' },
              p.episodes.length ? h('span', { className: 'bg_badge' }, t.localEpShort + ' ' + p.episodes.length + t.episodes) : null,
              p.totalEpisodes !== undefined ? h('span', { className: 'bg_badge' }, t.total + ' ' + p.totalEpisodes) : null,
            ),
          )),
        ),
    sel ? h('div', { className: 'bg_overlay', onClick: (e: any) => { if (e.target === e.currentTarget) setSel(null) } },
      h('div', { className: 'bg_modal' },
        h('div', { className: 'bg_mHead' },
          sel.cover ? h('img', { className: 'bg_mCover', src: sel.cover, alt: '', onClick: (e: any) => e.stopPropagation() })
            : h('div', { className: 'bg_mPh' }, name(sel).slice(0, 1).toUpperCase()),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'bg_mTitle' }, name(sel)),
            h('div', { className: 'bg_mSub' },
              sel.airDate ? h('span', null, t.firstAir + ' ' + sel.airDate) : null,
              sel.platform ? h('span', null, sel.platform) : null,
              sel.id ? h('span', null, 'bgm.tv #' + sel.id) : null,
            ),
            h('div', { className: 'bg_mStats' },
              h('div', { className: 'bg_mStat' },
                h('b', null, sel.totalEpisodes !== undefined ? String(sel.totalEpisodes) : '?'),
                h('span', null, t.total)),
              h('div', { className: 'bg_mStat' },
                h('b', null, sel.aired !== undefined ? String(sel.aired) : '?'),
                h('span', null, t.aired)),
              h('div', { className: 'bg_mStat' },
                h('b', null, String(sel.episodes.length)),
                h('span', null, t.localEpShort)),
            ),
            h('div', { className: 'bg_mProgRow' },
              barRow(t.aired, sel.aired, sel.totalEpisodes, 'air'),
              barRow(t.downloaded, sel.episodes.length, sel.totalEpisodes, 'dl'),
            ),
          ),
        ),
        h('div', { className: 'bg_mDesc', style: { whiteSpace: 'normal' } },
          (sel.summary || t.noSummary)),
        h('div', { className: 'bg_mFoot' },
          sel.subscribed
            ? h('span', { className: 'bg_mSubBadge' }, t.subscribe + ': ' + String(sel.source ?? '').toUpperCase())
            : (sel.id
                ? h('span', { className: 'bg_mSubBadge' }, t.subscribeTo)
                : h('span', { className: 'bg_mSubBadge' }, t.matchedNone)),
          h('button', { className: 'bg_btn', onClick: () => setSel(null) }, t.close),
        ),
      ),
    ) : null,
  )
}

const TABS = ['subscriptions', 'calendar', 'library', 'search', 'settings'] as const

/** 整页视图：页头（标题 + Tab + 关闭） + 滚动内容区 */
function BangumiPage(props: { onClose?: () => void }): React.ReactElement {
  useCss()
  const [tab, setTab] = React.useState<typeof TABS[number]>('subscriptions')
  const body =
    tab === 'subscriptions' ? h(Subscriptions)
    : tab === 'calendar' ? h(Calendar)
    : tab === 'library' ? h(LibraryTab)
    : tab === 'search' ? h(SearchTab)
    : h(SettingsTab)
  return h('div', { className: 'bg_page' },
    h('div', { className: 'bg_head' },
      h('div', { className: 'bg_title' }, '📺 ' + t.title),
      h('div', { className: 'bg_tabs' },
        TABS.map((k) =>
          h('button', { key: k, className: 'bg_tab' + (tab === k ? ' bg_tabOn' : ''), onClick: () => setTab(k) }, t[k])),
      ),
      h('button', { className: 'bg_close', onClick: props.onClose }, t.close),
    ),
    h('div', { className: 'bg_view' }, body),
  )
}

/* ---------------- 侧边栏入口：自愈放置 ---------------- */
function createEntry(controller: PanelController): { entry: HTMLButtonElement; label: HTMLSpanElement } {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(ENTRY_ATTR, '')
  entry.className = 'bg_entry'
  const icon = document.createElement('span')
  icon.className = 'bg_entryIcon'
  icon.innerHTML = ENTRY_ICON_SVG
  const label = document.createElement('span')
  label.className = 'bg_entryLabel'
  label.textContent = t.title
  entry.append(icon, label)
  entry.addEventListener('click', () => controller.open())
  return { entry, label }
}

/** 把入口插到既有面板族（taskboard/ssh/mnemon/自己）之后；无族员时插在新建会话行下。 */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  if (entry.parentElement === root) return true
  const button = newSessionButton(root)
  if (!button) return false
  const row = button.closest('[class*="logoRow"]')
  const base: HTMLElement = row && row.parentElement === root ? (row as HTMLElement) : button
  const family = Array.from(root.children).filter((el): el is HTMLElement =>
    el instanceof HTMLElement && el.matches(FAMILY_SELECTOR))
  const anchor = (family.length ? family[family.length - 1].nextElementSibling : base.nextElementSibling) as HTMLElement | null
  root.insertBefore(entry, anchor)
  return true
}

function mountSidebarEntry(controller: PanelController): () => void {
  const { entry, label } = createEntry(controller)
  const syncActive = () => {
    if (controller.getSnapshot().open) entry.setAttribute(ACTIVE_ATTR, '')
    else entry.removeAttribute(ACTIVE_ATTR)
  }
  const syncLabel = () => {
    if (entry.getAttribute('aria-label') !== t.title) entry.setAttribute('aria-label', t.title)
    if (entry.title !== t.title) entry.title = t.title
    if (label.textContent !== t.title) label.textContent = t.title
  }
  let root: HTMLElement | undefined
  let placed = false
  const tryPlace = () => {
    syncLabel()
    if (root !== undefined && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect(); root = undefined; placed = false
    }
    root ??= sidebarRoot()
    if (!root) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }
  const rootObserver = new MutationObserver(tryPlace)
  const waitObserver = new MutationObserver(tryPlace)
  waitObserver.observe(document.body, { childList: true, subtree: true })
  const unsubscribe = controller.subscribe(syncActive)
  syncActive()
  tryPlace()
  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribe()
    entry.remove()
  }
}

/* ---------------- 对话列整页视图 ---------------- */
function conversationColumn(): HTMLElement | undefined {
  const col = document.querySelector(CONVERSATION_SELECTOR)
  return col instanceof HTMLElement ? col : undefined
}

function mountPage(controller: PanelController): () => void {
  let root: ReturnType<typeof createRoot> | undefined
  let container: HTMLDivElement | undefined
  let suppressCompatibilityClose = false
  const ensure = () => {
    if (container !== undefined && container.isConnected) return
    if (container !== undefined) {
      root?.unmount()
      root = undefined
      container = undefined
    }
    const column = conversationColumn()
    if (!column) return
    container = document.createElement('div')
    container.setAttribute(VIEW_ATTR, '')
    container.className = 'bg_viewport'
    column.append(container)
    root = createRoot(container)
    root.render(h(BangumiPage, {
      onClose: () => controller.close(),
    }))
  }
  const waitObserver = new MutationObserver(ensure)
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = () => {
    if (!controller.getSnapshot().open) {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
      return
    }
    suppressCompatibilityClose = true
    try {
      /* 通知既有面板（taskboard/ssh/mnemon…）收起 */
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'ssh' }))
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'taskboard' }))
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'mnemon' }))
    } finally {
      suppressCompatibilityClose = false
    }
    for (const attr of OTHER_ACTIVES) document.documentElement.removeAttribute(attr)
    document.documentElement.setAttribute(ACTIVE_ATTR, '')
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'bangumi' }))
  }
  const onOtherPanelActivate = (event: Event) => {
    if (suppressCompatibilityClose || !controller.getSnapshot().open) return
    const detail = (event as CustomEvent<string>).detail
    if (detail === 'taskboard' || detail === 'ssh' || detail === 'mnemon') controller.close()
  }
  const onSidebarContextClick = (event: MouseEvent) => {
    if (!controller.getSnapshot().open) return
    const target = event.target
    if (target instanceof Element && target.closest(SIDEBAR_CONTEXT_SELECTOR) !== null) controller.close()
  }
  const activeObserver = new MutationObserver(() => {
    if (!controller.getSnapshot().open) return
    const html = document.documentElement
    if (!html.hasAttribute(ACTIVE_ATTR) || OTHER_ACTIVES.some((a) => html.hasAttribute(a))) controller.close()
  })
  activeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ACTIVE_ATTR, ...OTHER_ACTIVES] })

  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()
  return () => {
    document.removeEventListener('click', onSidebarContextClick, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherPanelActivate)
    activeObserver.disconnect()
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}

/* ---------------- apply ---------------- */
export function apply(ctx: ClientContext): void {
  void ctx
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
    const disposeDiag = installDiag()
    const controller = new PanelController()
    const disposeEntry = mountSidebarEntry(controller)
    const disposePage = mountPage(controller)
    return () => {
      disposeDiag()
      disposePage()
      disposeEntry()
    }
  }, '@dsh-external/dsh-bangumi: workspace')
}
