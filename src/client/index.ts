/**
 * @dsh-external/dsh-bangumi — client：左侧栏入口 + 追番面板（4 Tab）。
 * 数据通道：fetch("/api/bangumi/...") 直连 host REST（无需 RPC）。
 * React 来自客户端外部化模块（tsdown neverBundle react）。
 */
import * as React from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = { slots: SlotsService }

export const inject = ['slots']

const zh = {
  title: '追番', subscriptions: '订阅', calendar: '日历', search: '检索', settings: '设置',
  loading: '加载中…', refresh: '刷新', remove: '退订', confirmRemove: '确认退订？',
  total: '总集数', downloaded: '已下载', libraryHit: '本地已有', source: '来源',
  noSubs: '暂无订阅——到「检索」里搜索番剧并订阅',
  searchPlaceholder: '番名（中日文皆可）…', searchRun: '搜索',
  subscribeDmhy: '订阅(dmhy)', subscribeNyaa: '订阅(nyaa)',
  localEps: '本地已有集数', score: '匹配分', download: '下载', downloadedMark: '已入列',
  episodes: '集', firstAir: '首播', close: '关闭', save: '保存', saved: '已保存并生效',
  qbUrl: 'qB WebUI 地址', qbUser: '用户名', qbPass: '密码', category: '分类', tags: '标签',
  savePath: '保存目录', mediaDirs: '媒体库目录（每行一个）', pollMinutes: '轮询间隔(分钟)',
  qbStatus: 'qB 状态', scan: '立即扫描媒体库', scanning: '扫描中…', testConn: '测试连接',
  mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六', sun: '日', prev: '‹', next: '›',
}
type Dict = typeof zh
const en: Dict = {
  title: 'Bangumi', subscriptions: 'Subscriptions', calendar: 'Calendar', search: 'Search', settings: 'Settings',
  loading: 'Loading…', refresh: 'Refresh', remove: 'Remove', confirmRemove: 'Confirm remove?',
  total: 'Total', downloaded: 'Downloaded', libraryHit: 'Already in library', source: 'Source',
  noSubs: 'No subscriptions yet — search a show in the Search tab and subscribe',
  searchPlaceholder: 'Show name…', searchRun: 'Search',
  subscribeDmhy: 'Subscribe (dmhy)', subscribeNyaa: 'Subscribe (nyaa)',
  localEps: 'Episodes already in library', score: 'score', download: 'Download', downloadedMark: 'Queued',
  episodes: 'eps', firstAir: 'First air', close: 'Close', save: 'Save', saved: 'Saved',
  qbUrl: 'qB WebUI URL', qbUser: 'Username', qbPass: 'Password', category: 'Category', tags: 'Tags',
  savePath: 'Save path', mediaDirs: 'Media library dirs (one per line)', pollMinutes: 'Poll interval (min)',
  qbStatus: 'qB status', scan: 'Scan library now', scanning: 'Scanning…', testConn: 'Test connection',
  mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su', prev: '‹', next: '›',
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
const CSS = [
'.bg_layer{position:fixed;inset:0;z-index:60;pointer-events:none}',
'.bg_scrim{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.28)}',
'.bg_panel{position:absolute;top:12px;bottom:12px;left:56px;right:12px;pointer-events:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 16px 48px rgba(0,0,0,.34);overflow:hidden}',
'.bg_head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
'.bg_title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary)}',
'.bg_tabs{display:flex;gap:2px;flex:1}',
'.bg_tab{appearance:none;border:0;background:none;font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
'.bg_tabOn{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}',
'.bg_close{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
'.bg_body{flex:1;min-height:0;overflow:auto;padding:14px 16px}',
'.bg_sideBtn{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
'.bg_sideBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
'.bg_sideBtn.iconOnly{justify-content:center;padding:7px 0}',
'.bg_rows{display:flex;flex-direction:column;gap:8px}',
'.bg_row{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
'.bg_rowMain{flex:1;min-width:0}',
'.bg_rowTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.bg_rowSub{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
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
'.bg_view{flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 16px;overflow:auto}',
].join('\n')

function useCss(): void {
  React.useEffect(() => {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
}

// ---------- 子组件 ----------
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
        h('div', { className: 'bg_rowTitle' }, r.nameCn || r.name,
          r.progress && r.progress.library.length > 0
            ? h('span', { className: 'bg_hit' }, t.libraryHit + ' ' + r.progress.library.length + t.episodes)
            : null),
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
  subject: { id: number; name: string; nameCn: string; airDate?: string; totalEpisodes?: number }
  localEpisodes: number[]
  items: Array<{ title: string; magnet?: string; pubDate?: string; seeders?: number; size?: string; author?: string; score: number; reasons: string[]; episode?: number; group?: string; resolution?: string }>
}

function SearchTab(): React.ReactElement {
  const [kw, setKw] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<Array<{ id: number; name: string; nameCn: string; airDate?: string; totalEpisodes?: number }> | null>(null)
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
      field(t.category, 'qbCategory'),
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

function BangumiPanel(props: { onClose?: () => void; embedded?: boolean }): React.ReactElement {
  useCss()
  const [tab, setTab] = React.useState<'subscriptions' | 'calendar' | 'search' | 'settings'>('subscriptions')
  const body =
    tab === 'subscriptions' ? h(Subscriptions)
    : tab === 'calendar' ? h(Calendar)
    : tab === 'search' ? h(SearchTab)
    : h(SettingsTab)
  if (props.embedded) {
    return h('div', { className: 'bg_view' },
      h('div', { className: 'bg_tabs', style: { marginBottom: '12px' } },
        (['subscriptions', 'calendar', 'search', 'settings'] as const).map((k) =>
          h('button', { key: k, className: 'bg_tab' + (tab === k ? ' bg_tabOn' : ''), onClick: () => setTab(k) }, t[k])),
      ),
      body,
    )
  }
  return h('div', { className: 'bg_layer' },
    h('button', { className: 'bg_scrim', 'aria-label': t.close, onClick: props.onClose }),
    h('div', { className: 'bg_panel', role: 'dialog', 'aria-label': t.title },
      h('div', { className: 'bg_head' },
        h('div', { className: 'bg_title' }, '📺 ' + t.title),
        h('div', { className: 'bg_tabs' },
          (['subscriptions', 'calendar', 'search', 'settings'] as const).map((k) =>
            h('button', { key: k, className: 'bg_tab' + (tab === k ? ' bg_tabOn' : ''), onClick: () => setTab(k) }, t[k])),
        ),
        h('button', { className: 'bg_close', onClick: props.onClose }, t.close),
      ),
      h('div', { className: 'bg_body' }, body),
    ),
  )
}

function SidebarEntry(props: { wide?: boolean }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  return h(React.Fragment, null,
    h('button', {
      className: 'bg_sideBtn' + (props.wide === false ? ' iconOnly' : ''),
      title: t.title,
      onClick: () => setOpen((v) => !v),
    }, props.wide === false ? '📺' : '💮 ' + t.title),
    open ? h(BangumiPanel, { onClose: () => setOpen(false) }) : null,
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-bangumi.entry',
      order: 20,
    }, SidebarEntry),
  ), '@dsh-external/dsh-bangumi: sidebar')

  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'dsh-bangumi.view',
      label: t.title,
      order: 40,
    }, () => h(BangumiPanel, { embedded: true })),
  ), '@dsh-external/dsh-bangumi: view')
}
