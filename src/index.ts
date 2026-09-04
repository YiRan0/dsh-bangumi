/**
 * @dsh-external/dsh-bangumi — 追番订阅插件（host）。
 * 能力：Bangumi 元数据 / nyaa+dmhy 搜索 / qBittorrent RSS 订阅 / 本地媒体库查重 / 进度聚合。
 *
 * 配置读取优先级：env DSH_BANGUMI_* → ~/.dsh/dsh-bangumi.json → Config 默认值。
 * 状态持久化：~/.dsh/dsh-bangumi/state.json（订阅 + 下载记录）。
 * REST：/api/bangumi/*（webServer.register prefix），client 面板直接 fetch 同路径。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

import { getEpisodesCached, getSubjectCached, searchSubjects, type BangumiSubject } from './host/bangumi.js'
import { scanLibrary, buildByTitle, findEpisodesInLibrary, type LibrarySnapshot } from './host/library.js'
import { getDb } from './host/db.js'
import { rankItems, type ScoredItem } from './host/match.js'
import { detectPack, normalizeTitle, parseEpisode } from './host/parse.js'
import { decideDownloads, collectHave, isCovered, type DecisionAction } from './host/decision.js'
import { QbClient } from './host/qb.js'
import { dmhySearchUrl, fetchFeed, nyaaSearchUrl, searchDmhy, searchNyaa, type RssItem } from './host/rss.js'
import { getState, saveState, type Subscription } from './host/store.js'

export const name = '@dsh-external/dsh-bangumi'
export const inject = ['webServer', 'tools']

export interface Config {
  qbUrl: string
  qbUsername: string
  qbPassword: string
  qbSavePath: string
  qbCategory: string
  qbTags: string
  /** 分类根（如「番」）；番剧按 根/作品/第N季 分层归类 */
  qbCategoryRoot: string
  /** 番剧保存根目录（如 /Volumes/一块硬盘/电影/番）；作品目录建在其下 */
  qbBaseDir: string
  mediaDirs: string[]
  pollIntervalMinutes: number
  minMatchScore: number
  /** 订阅判新回看窗（天）：只自动下载订阅时刻起 N 天内新发布的集（防订阅即灌历史全集；连载周更天然每周 1-2 篇落窗内）；0=不限（慎用，会把 feed 内全部历史当新集） */
  rssIgnoreDays: number
}

export const Config = z.object({
  qbUrl: z.string().default('http://127.0.0.1:8080'),
  qbUsername: z.string().default(''),
  qbPassword: z.string().default(''),
  qbSavePath: z.string().default(''),
  qbCategory: z.string().default('bangumi'),
  qbTags: z.string().default('bangumi'),
  qbCategoryRoot: z.string().default('番'),
  qbBaseDir: z.string().default('/Volumes/一块硬盘/电影/番'),
  mediaDirs: z.array(z.string()).default([]),
  pollIntervalMinutes: z.number().default(30),
  minMatchScore: z.number().default(60),
  // 订阅判新回看窗（天），默认 3：订阅 3 天内发布的新集自动下载
  rssIgnoreDays: z.number().default(3),
})

const FILE_CONFIG = join(homedir(), '.dsh', 'dsh-bangumi.json')

function loadFileConfig(): Partial<Config> {
  try {
    const obj = JSON.parse(readFileSync(FILE_CONFIG, 'utf8'))
    const out: Partial<Config> = {}
    for (const k of ['qbUrl', 'qbUsername', 'qbPassword', 'qbSavePath', 'qbCategory', 'qbTags', 'qbCategoryRoot', 'qbBaseDir'] as const) {
      if (typeof obj[k] === 'string') out[k] = obj[k]
    }
    if (Array.isArray(obj.mediaDirs)) out.mediaDirs = obj.mediaDirs.filter((s: unknown) => typeof s === 'string')
    if (typeof obj.pollIntervalMinutes === 'number' && obj.pollIntervalMinutes > 0) out.pollIntervalMinutes = obj.pollIntervalMinutes
    if (typeof obj.minMatchScore === 'number') out.minMatchScore = obj.minMatchScore
    if (typeof obj.rssIgnoreDays === 'number' && obj.rssIgnoreDays >= 0) out.rssIgnoreDays = obj.rssIgnoreDays
    return out
  } catch {
    return {}
  }
}

function resolveConfig(config: Config): Config {
  const file = loadFileConfig()
  const env = process.env
  return {
    qbUrl: env.DSH_BANGUMI_QB_URL ?? file.qbUrl ?? config.qbUrl,
    qbUsername: env.DSH_BANGUMI_QB_USER ?? file.qbUsername ?? config.qbUsername,
    qbPassword: env.DSH_BANGUMI_QB_PASS ?? file.qbPassword ?? config.qbPassword,
    qbSavePath: file.qbSavePath ?? config.qbSavePath,
    qbCategory: file.qbCategory ?? config.qbCategory,
    qbTags: file.qbTags ?? config.qbTags,
    qbCategoryRoot: file.qbCategoryRoot ?? config.qbCategoryRoot,
    qbBaseDir: file.qbBaseDir ?? config.qbBaseDir,
    mediaDirs: file.mediaDirs ?? config.mediaDirs,
    pollIntervalMinutes: file.pollIntervalMinutes ?? config.pollIntervalMinutes,
    minMatchScore: file.minMatchScore ?? config.minMatchScore,
    rssIgnoreDays: file.rssIgnoreDays ?? config.rssIgnoreDays,
  }
}

/** 运行时（设置写文件后 reloadRuntime 立即生效，无需重启） */
interface Runtime {
  cfg: Config
  qb: QbClient
  library: LibrarySnapshot | null
  libraryScanning: boolean
}

interface SubjectBundle {
  subject: BangumiSubject
  aliases: string[]
}

async function subjectBundle(bangumiId: number): Promise<SubjectBundle> {
  const got = await getSubjectCached(bangumiId)
  return { subject: got.subject, aliases: got.aliases }
}

/** 已拥有集数集合（含全集区间展开）——订阅行内用 */
function haveSet(rt: Runtime, sub: Subscription, lib: { episodes: number[] }): Set<number> {
  const have = new Set<number>(lib.episodes)
  const state = getState()
  for (const d of state.downloads) {
    if (d.bangumiId !== sub.bangumiId) continue
    if (d.episode !== undefined) have.add(d.episode)
    if (d.rangeFrom !== undefined && d.rangeTo !== undefined) {
      for (let n = d.rangeFrom; n <= d.rangeTo; n += 1) have.add(n)
    }
  }
  return have
}

/** 聚合一个订阅番的进度：本地库 ∪ qB 已完成 = downloaded；qB 进行中 = pending；缺失 = 缺集 */
async function progressFor(rt: Runtime, sub: Subscription): Promise<{
  total: number | undefined
  library: number[]
  qbEps: number[]
  pendingEps: number[]
  downloaded: number
  pending: number
  missing: number[]
  complete: boolean
}> {
  const lib = findEpisodesInLibrary(rt.library, sub.aliases)
  const qbEps: number[] = []
  const pendingEps: number[] = []
  try {
    const torrents = await rt.qb.torrents({ tag: 'dsh-bangumi-sub-' + sub.id })
    for (const t of torrents) {
      const ep = parseEpisode(t.name).episode
      if (ep === undefined) continue
      if (t.progress >= 1) qbEps.push(ep)
      else pendingEps.push(ep)
    }
  } catch {
    // qB 不可达：仅本地库
  }
  const have = new Set<number>([...lib.episodes, ...qbEps])
  // downloads 记录（单集 + 全集区间展开）也算已有——防进度误报缺集
  const st0 = getState()
  for (const d of st0.downloads) {
    if (d.bangumiId !== sub.bangumiId) continue
    if (d.episode !== undefined) have.add(d.episode)
    if (d.rangeFrom !== undefined && d.rangeTo !== undefined) {
      for (let n = d.rangeFrom; n <= d.rangeTo; n += 1) have.add(n)
    }
  }
  const total = sub.totalEpisodes
  return {
    total,
    library: lib.episodes,
    qbEps: qbEps.sort((a, b) => a - b),
    pendingEps: [...new Set(pendingEps)].sort((a, b) => a - b),
    downloaded: have.size,
    pending: pendingEps.length,
    missing: total ? Array.from({ length: total }, (_v, i) => i + 1).filter((n) => !have.has(n)) : [],
    complete: total !== undefined && total > 0 && Array.from({ length: total }, (_v, i) => i + 1).every((n) => have.has(n)),
  }
}

/**
 * 订阅（自管模式）：不建 qB RSS feed/rule——只落库，判新下载由 timer 轮询驱动。
 * lastCheckAt 置为当前时刻 = 判新游标：feed 里订阅前发布的历史全集落在游标外，
 * 从机制上杜绝 qB RSS 建规则即灌历史的爆炸；首轮 timer 只收游标之后的新文章。
 */
async function subscribeBangumi(
  rt: Runtime,
  bangumiId: number,
  opts: { source: 'nyaa' | 'dmhy'; group?: string; resolution?: string; query?: string },
  logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void },
): Promise<Subscription> {
  const { subject, aliases } = await subjectBundle(bangumiId)
  const source = opts.source
  const query = opts.query || subject.nameCn || subject.name
  const feedUrl = source === 'nyaa' ? nyaaSearchUrl(query) : dmhySearchUrl(query)
  const id = 'sub-' + bangumiId + '-' + Date.now().toString(36)
  const firstAir = subject.airDate
  const weekday = firstAir ? new Date(firstAir + 'T00:00:00+08:00').getDay() : undefined
  const now = Date.now()
  // 判新游标起点 = now - 回看窗：订阅前 rssIgnoreDays 天内发布的集也会收（补最近几集），
  // 更早的历史全集（通常数十个种子）落在游标外，从机制上杜绝 qB RSS 式「订阅即拉全集」
  const lookbackMs = rt.cfg.rssIgnoreDays * 86400_000
  const season = seasonOf((subject.nameCn || '') + ' ' + (subject.name || ''))

  // rssRuleName/rssItemPath 留空 = 非 qB RSS 托管（启动清理只动旧版遗留非空记录）
  const sub: Subscription = {
    id,
    bangumiId,
    name: subject.name,
    nameCn: subject.nameCn,
    aliases,
    totalEpisodes: subject.totalEpisodes,
    season,
    airDate: subject.airDate,
    weekday,
    source,
    group: opts.group,
    resolution: opts.resolution,
    query,
    rssRuleName: '',
    feedUrl,
    rssItemPath: undefined,
    savePath: rt.cfg.qbSavePath,
    category: rt.cfg.qbCategory,
    tags: 'dsh-bangumi-sub-' + id + ',' + rt.cfg.qbTags,
    seenEpisodes: [],
    lastCheckAt: now - lookbackMs,
    status: 'unknown',
    createdAt: now,
  }

  // 分类/目录：番/作品[/第N季]。S≥2 必分层；S1 若同作品已有 S≥2 也分层
  const lay = layoutFor(rt, { nameCn: subject.nameCn, name: subject.name, season, id })
  sub.category = lay.category
  sub.savePath = lay.savePath || rt.cfg.qbSavePath

  const state = getState()
  state.subscriptions.push(sub)
  saveState(state)

  // 建好分类与磁盘目录（qB add 时自动落到正确保存路径）
  void ensureCategory(rt, lay.category, lay.savePath, logger)
  // S≥2 新订阅：把该作品「扁平态第一季」迁移为 番/作品/第一季 分层
  if (season >= 2) {
    try { await migrateFlatFirstSeason(rt, lay.core, logger) } catch { /* 迁移失败不影响订阅 */ }
  }
  return sub
}

/** 退订：移除本地订阅；旧版 qB RSS 托管订阅（rssRuleName 非空）顺带清 qB RSS 规则/源 */
async function unsubscribeBangumi(rt: Runtime, id: string): Promise<Subscription> {
  const state = getState()
  const idx = state.subscriptions.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error('订阅不存在: ' + id)
  const sub = state.subscriptions[idx]
  // 自管订阅不建 qB RSS；仅当是旧版遗留的 RSS 托管订阅才做 qB 侧清理
  if (sub.rssRuleName) {
    try {
      await rt.qb.removeRssRule(sub.rssRuleName)
      if (!state.subscriptions.some((s) => s.id !== sub.id && s.feedUrl === sub.feedUrl)) {
        await rt.qb.removeRssFeed(sub.rssItemPath ?? 'dsh-bangumi/' + sub.id)
      }
    } catch {
      // qB 不可达：仅移除本地
    }
  }
  state.subscriptions.splice(idx, 1)
  saveState(state)
  return sub
}

/**
 * 三层查重判新：媒体库（本地文件）→ qB 已有任务（tag 标记）→ downloads 记录。
 * 返回「该订阅在下载侧已拥有（含进行中）的集号集合」。
 */
async function alreadyHaveEpisodes(rt: Runtime, sub: Subscription): Promise<Set<number>> {
  const have = new Set<number>()
  // 1) 本地媒体库
  if (rt.library) {
    const lib = findEpisodesInLibrary(rt.library, sub.aliases)
    for (const n of lib.episodes) have.add(n)
  }
  // 2) qB 现有任务（本订阅 tag 前缀 dsh-bangumi-sub-<id>，含进行中/已完成）
  try {
    const mine = await rt.qb.torrents({ tag: 'dsh-bangumi-sub-' + sub.id })
    for (const t of mine) {
      const ep = parseEpisode(t.name).episode
      if (ep !== undefined) have.add(ep)
    }
  } catch {
    // qB 不可达：仅媒体库+downloads
  }
  // 3) downloads 表（本订阅绑定的加磁记录；防 qB 侧清理后重复加）
  const state = getState()
  for (const d of state.downloads) {
    if (d.bangumiId !== sub.bangumiId) continue
    if (d.episode !== undefined) have.add(d.episode)
  }
  return have
}

/** 评分选种：偏好分辨率/发布组（订阅设定）；未指定则偏好 1080p，且拒绝整包/合集（无单集号） */
function pickTorrent(cands: ScoredItem[], prefer: { resolution?: string; group?: string }): ScoredItem | null {
  const singles = cands.filter((c) => c.parsed?.episode !== undefined)
  const pool = singles.length ? singles : cands.filter((c) => c.parsed?.episode === undefined)
  if (!pool.length) return null
  // 已按分降序；同样分数优先期望分辨率（默认 1080p）
  const want = prefer.resolution ?? '1080p'
  const resMatch = pool.find((c) => c.parsed?.resolution?.toLowerCase().includes('1080'))
  const exact = pool.find((c) => c.parsed?.resolution?.toLowerCase() === want.toLowerCase())
  return exact ?? resMatch ?? pool[0]
}

/**
 * 自管判新核心（决策树 v3，2026-09-04 需求定稿）：
 *  1. 拉订阅 feed → 打分（别名/集号/分辨率/组/seeders；整包/全集识别）
 *  2. 判断完结态：bgm episodes 端点缓存无未来日期 → finished（缓存 6h）
 *  3. finished → 优先全集资源；airing → 只补缺失单集至最新
 *  4. 判重：已有集号 / 全集区间覆盖 / 全集新增重复 → 不下
 *  5. 齐集（本地 ∪ qB ∪ downloads ≥ 总集数）且完结 → 自动停订阅（completedAt）
 * 返回本次下载的 {episode,title} 列表。
 */
async function pollSubscriptions(rt: Runtime, logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void }): Promise<Array<{ subId: string; episode: number; title: string }>> {
  const state = getState()
  const got: Array<{ subId: string; episode: number; title: string }> = []
  for (const sub of state.subscriptions) {
    // 已自动停订阅的跳过
    if (sub.completedAt) continue
    try {
      const items = await fetchFeed(sub.feedUrl)
      const ranked = rankItems(items, {
        aliases: sub.aliases.length ? sub.aliases : [sub.query],
        preferResolution: sub.resolution,
        preferGroup: sub.group,
        seasonOnly: sub.season ?? 1, // 只认订阅季（跨季合集若含本季仍收）
      })
      // 窗口过滤：完结番全集不受限；连载番只收回看窗内（不补远古历史缺集）与上次检查后的新文
      const lookback = rt.cfg.rssIgnoreDays * 86400_000
      const cursorFloor = Date.now() - lookback
      const windowed = ranked.filter((c) => {
        if (c.pack?.isPack) return true // 整包（全集）始终候选（完结判定在决策层把关）
        const pub = c.item.pubDate ? new Date(c.item.pubDate).getTime() : Date.now()
        const afterLast = !sub.lastCheckAt || pub > sub.lastCheckAt
        return afterLast && pub >= cursorFloor && c.score >= rt.cfg.minMatchScore
      })
      // 完结态（bgm episodes 缓存；拉取失败沿用旧 status）
      let finished = sub.status === 'finished'
      if (sub.status !== 'finished') {
        try {
          const eps = await getEpisodesCached(sub.bangumiId)
          if (eps.length) {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const hasFuture = eps.some((e) => e.airDate && new Date(e.airDate + 'T00:00:00').getTime() > today.getTime())
            finished = !hasFuture && eps.length > 0 // 全部定档且无未来日期 = 已放送完（完结）
            if (eps.length === 1 && hasFuture) finished = false
          }
        } catch {
          /* bgm 不可达：沿用 */
        }
        sub.status = 'finished'
      }
      // 本地已有（媒体库）+ qB 任务 + downloads（rt.library 由调用方在轮询前水合）
      const lib = rt.library ? findEpisodesInLibrary(rt.library, sub.aliases) : { episodes: [] as number[], count: 0 }
      const have = await alreadyHaveEpisodes(rt, sub)
      // qB 任务（进行中也算有，防重复）
      const qbEps: number[] = []
      try {
        const mine = await rt.qb.torrents({ tag: 'dsh-bangumi-sub-' + sub.id })
        for (const t of mine) {
          const ep = parseEpisode(t.name).episode
          if (ep !== undefined) qbEps.push(ep)
        }
      } catch { /* qB 不可达 */ }
      for (const n of qbEps) have.add(n)

      // 决策引擎输入（downloads 行带全集区间）
      const downloads = getState().downloads.filter((d) => d.bangumiId === sub.bangumiId)
      const input = {
        totalEpisodes: sub.totalEpisodes,
        finished,
        libraryEpisodes: lib.episodes,
        qbEpisodes: qbEps,
        downloads,
        candidates: ranked,
        preferResolution: sub.resolution,
        preferGroup: sub.group,
      }
      const input2 = { ...input, candidates: windowed }
      const dec = decideDownloads(input2)
      for (const act of dec.actions) {
        try {
          const magnet = act.scored.item.magnet
          if (!magnet) continue
          await rt.qb.addMagnet(magnet, {
            savePath: sub.savePath || rt.cfg.qbSavePath || undefined,
            category: sub.category,
            tags: sub.tags,
          })
          const st = getState()
          st.downloads.push({
            magnet,
            title: act.scored.item.title,
            bangumiId: sub.bangumiId,
            episode: act.episode,
            group: act.scored.parsed?.group,
            resolution: act.scored.parsed?.resolution,
            origin: 'rss',
            full: act.full,
            rangeFrom: act.rangeFrom,
            rangeTo: act.rangeTo,
            at: Date.now(),
          })
          saveState(st)
          got.push({ subId: sub.id, episode: act.episode ?? act.rangeFrom ?? 0, title: act.scored.item.title })
        } catch (err) {
          logger.warn('bangumi download fail sub=%s %s: %s', sub.id, act.why, err instanceof Error ? err.message : String(err))
        }
      }
      // 停订阅判定：本地齐集且完结
      if (dec.stopSubscription && !sub.completedAt) {
        sub.completedAt = Date.now()
        logger.info('bangumi subscription complete (auto-stop): %s %s', sub.id, sub.nameCn || sub.name)
      }
      // 游标推进
      sub.lastCheckAt = Date.now()
      sub.lastEpisodeAt = sub.lastEpisodeAt ?? Date.now()
      saveState(state)
    } catch (err) {
      logger.warn('bangumi poll fail sub=%s: %s', sub.id, err instanceof Error ? err.message : String(err))
    }
  }
  return got
}

/**
 * 启动迁移清理：旧版 qB RSS 托管订阅残留的 feed/rule（rssRuleName 非空的遗留订阅）。
 * 自管模式起不再建 qB RSS；把老订阅转自管 = 删 qB 侧规则与 feed（若无人共享），保留本地订阅。
 */
async function cleanupLegacyRss(rt: Runtime, logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  const state = getState()
  const legacy = state.subscriptions.filter((s) => s.rssRuleName)
  if (!legacy.length) return
  for (const sub of legacy) {
    // qB 侧清理独立 try：失败仅告警，本地仍转自管（规则已不存在时 qB 返回 404/409 = 视为已清）
    try {
      await rt.qb.removeRssRule(sub.rssRuleName)
      if (!state.subscriptions.some((s) => s.id !== sub.id && s.feedUrl === sub.feedUrl)) {
        await rt.qb.removeRssFeed(sub.rssItemPath ?? 'dsh-bangumi/' + sub.id)
      }
    } catch (err) {
      logger.warn('bangumi legacy rss cleanup fail %s: %s', sub.id, err instanceof Error ? err.message : String(err))
    }
    sub.rssRuleName = ''
    sub.rssItemPath = undefined
    logger.info('bangumi legacy rss cleaned: %s', sub.id)
  }
  saveState(state)
}

/** 按 Bangumi 别名搜索 nyaa+dmhy 并打分排序 */
async function searchTorrentsForBangumi(
  rt: Runtime,
  bangumiId: number,
  options: { source?: 'nyaa' | 'dmhy' | 'both'; query?: string } = {},
): Promise<{ subject: BangumiSubject; items: ScoredItem[] }> {
  const { subject, aliases } = await subjectBundle(bangumiId)
  const queries = options.query
    ? [options.query]
    : [...new Set([subject.nameCn, subject.name].filter(Boolean))]
  const items: RssItem[] = []
  const src = options.source ?? 'both'
  for (const q of queries) {
    if (src === 'nyaa' || src === 'both') {
      try {
        items.push(...(await searchNyaa(q)))
      } catch {
        /* 单源失败忽略 */
      }
    }
    if (src === 'dmhy' || src === 'both') {
      try {
        items.push(...(await searchDmhy(q)))
      } catch {
        /* ignore */
      }
    }
    if (items.length > 60) break
  }
  const seen = new Set<string>()
  const unique = items.filter((i) => {
    if (seen.has(i.title)) return false
    seen.add(i.title)
    return true
  })
  return { subject, items: rankItems(unique, { aliases }) }
}


/** 季关键词集合：识别番名里的续作季，用于「唯一返回」挑选 */
const SEASON_KW = [
  '第二季', '第三季', '第四季', '第五季', '2期', '3期', '4期', '5期',
  's2', 's3', 's4', 's5', 'season 2', 'season 3', 'season 4', 'season 5',
  'part 2', 'part 3', 'part 4', '二期', '三期', '四期', '五期', '2nd', '3rd', 'ii', 'iii',
]
function seasonOf(raw: string): number {
  const n = normalizeTitle(raw)
  if (/第?[一二三四五]s*季|第?[二三四五]期|(?:^|[^0-9])2s*期|(?:^|[^0-9])3s*期/.test(n)) {
    for (const [kw, v] of [['第五季', 5], ['第四季', 4], ['第三季', 3], ['第二季', 2], ['第五期', 5], ['第四期', 4], ['第三期', 3], ['第二期', 2], ['二期', 2], ['三期', 3], ['四期', 4], ['五期', 5]] as const) {
      if (n.includes(kw)) return v
    }
  }
  if (/s2(?:$|[^0-9])/.test(n)) return 2
  if (/s3(?:$|[^0-9])/.test(n)) return 3
  if (/s4(?:$|[^0-9])/.test(n)) return 4
  if (/s5(?:$|[^0-9])/.test(n)) return 5
  if (/seasons*2/.test(n)) return 2
  if (/seasons*3/.test(n)) return 3
  if (/parts*2/.test(n)) return 2
  if (/parts*3/.test(n)) return 3
  if (/2nd|second/.test(n)) return 2
  if (/3rd|third/.test(n)) return 3
  return 1
}
function hasSeasonWord(raw: string): boolean {
  const n = normalizeTitle(raw)
  return SEASON_KW.some((kw) => n.includes(normalizeTitle(kw)))
}
/** 去掉季词，留下「本体名」用于跨条目归并 */
function coreOf(raw: string): string {
  return normalizeTitle(raw)
    .replace(/第?[一二三四五]s*季/g, '')
    .replace(/第?[一二三四五]期/g, '')
    .replace(/(?:s[2-5]|seasons*[2-5]|parts*[2-5]|2nd|3rd|second|third)/g, '')
    .replace(/[〜~～].*$/, '')
    .replace(/[（(].*?[）)]/g, '')
}

// ---------- 分类/目录布局（番/作品[/第N季]） ----------
const SEASON_CN = ['', '第一季', '第二季', '第三季', '第四季', '第五季']
function seasonLabel(n?: number): string {
  const s = n ?? 1
  return SEASON_CN[s] || 'S' + s
}
/** 作品主干名（保留原大小写/中文，只剥季词、副标题分隔、括号注释、〜〜后缀） */
function coreNameOf(sub: { nameCn?: string; name?: string }): string {
  const base = (sub.nameCn || sub.name || '').trim()
  const stripped = base
    .replace(/第?[一二三四五]s*季/g, '')
    .replace(/第?[一二三四五]s*期/g, '')
    .replace(/[〜~～].*$/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/s*[:：].*$/, '')
    .replace(/[Ss]([2-9])/g, '')
    .replace(/(?:Season|Part)s*[2-9]/gi, '')
    .trim()
  return stripped || base
}
/** 布局目标：{category, savePath}。S1 且同作品无更高季订阅 → 扁平 番/作品；否则 番/作品/第N季 */
function layoutFor(rt: Runtime, sub: { nameCn?: string; name?: string; season?: number; id?: string }): { category: string; savePath: string; season: number; core: string } {
  const core = coreNameOf(sub)
  const season = Math.max(1, sub.season ?? 1)
  const hasLater = season < 2 ? false : true // 本季 ≥2 即分层
  const st = getState()
  const laterSubExists = st.subscriptions.some((x) => x.id !== (sub.id ?? '') && coreNameOf(x) === core && (x.season ?? 1) >= 2)
  const layered = season >= 2 || laterSubExists
  const root = (rt.cfg.qbCategoryRoot || '番').replace(//+$/, '')
  const base = (rt.cfg.qbBaseDir || '').replace(//+$/, '')
  const parts = [core]
  if (layered) parts.push(seasonLabel(season))
  const category = [root, ...parts].join('/')
  const savePath = base ? [base, ...parts].join('/') : ''
  return { category, savePath, season, core }
}
/** 幂等建分类（qB 自动建父级）；失败仅告警（qB 不可达时订阅仍落库） */
async function ensureCategory(rt: Runtime, category: string, savePath: string, logger: { warn: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  try {
    await rt.qb.createCategory(category, savePath || undefined)
  } catch (err) {
    logger.warn('bangumi createCategory fail %s: %s', category, err instanceof Error ? err.message : String(err))
  }
}
/**
 * S≥2 订阅落库后调用：把同作品现存「扁平态第一季」（订阅行 + qB 任务）
 * 迁移到 番/作品/第一季（新建目录并把任务内容整体移入）。
 */
async function migrateFlatFirstSeason(rt: Runtime, core: string, logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  const root = (rt.cfg.qbCategoryRoot || '番').replace(//+$/, '')
  const base = (rt.cfg.qbBaseDir || '').replace(//+$/, '')
  const flatCat = root + '/' + core
  const flatPath = base + '/' + core
  const layeredCat = flatCat + '/' + seasonLabel(1)
  const layeredPath = flatPath + '/' + seasonLabel(1)
  const st = getState()
  // 1) 同作品第一季订阅行（仍平铺在 番/作品）→ 更新为分层
  let changed = false
  for (const s of st.subscriptions) {
    if (coreNameOf(s) !== core || (s.season ?? 1) !== 1) continue
    if (s.category === flatCat || !s.category) {
      s.category = layeredCat
      s.savePath = s.savePath || layeredPath
      changed = true
    }
  }
  // 2) qB 任务：扁平分类/路径 → 分层（setSavePath 会把任务内容整体搬入子目录）
  try {
    const flatTasks = await rt.qb.torrents({ category: flatCat })
    const hashes = flatTasks.map((t) => t.hash)
    if (hashes.length) {
      await rt.qb.setTorrentCategory(hashes.join('|'), layeredCat)
      await rt.qb.setTorrentSavePath(hashes.join('|'), layeredPath)
      logger.info('bangumi layout migrate %s: %d task(s) -> %s', core, hashes.length, layeredCat)
    }
  } catch (err) {
    logger.warn('bangumi layout migrate qb fail %s: %s', core, err instanceof Error ? err.message : String(err))
  }
  if (changed) {
    saveState(st)
    logger.info('bangumi layout migrate %s: subscriptions updated to %s', core, layeredCat)
  }
}

async function lookupSubject(keyword: string): Promise<BangumiSubject | null> {
  const kw = String(keyword ?? '').trim()
  if (!kw) return null
  const wantSeason = seasonOf(kw)
  const wantSeasonWord = hasSeasonWord(kw)
  const kwCore = coreOf(kw)
  // 搜索用本体词（剥离季词），避免 bgm 长 query 退化
  let subjects = await searchSubjects(kwCore || kw, 12)
  if (!subjects.length) subjects = await searchSubjects(kw, 12)
  if (!subjects.length) return null
  if (subjects.length === 1) return subjects[0]

  // 归一化主体信息
  const rows = subjects.map((sub) => {
    const season = seasonOf((sub.nameCn || '') + ' ' + (sub.name || ''))
    return { sub, season, name: (sub.nameCn || sub.name || '').trim() }
  })

  // 1) 带季词：只认对应季条目（season === wantSeason），coreOf 相等 > 包含 > 最短名
  if (wantSeasonWord) {
    const seasonal = rows.filter((r) => r.season === wantSeason)
    if (!seasonal.length) return null // 候选里没有该季（bgm 未建条目）→ 宁缺毋滥
    const exactSeason = seasonal.filter((r) => coreOf(r.sub.nameCn || '') === kwCore || coreOf(r.sub.name || '') === kwCore)
    const pick = exactSeason.length ? exactSeason : seasonal.filter((r) => coreOf(r.sub.nameCn || r.sub.name || '').includes(kwCore) || kwCore.includes(coreOf(r.sub.nameCn || r.sub.name || '')))
    const pool = pick.length ? pick : seasonal
    const dateVal = (d?: string) => (d ? d.replace(/[^0-9]/g, '') : '')
    const sortedSeason = [...pool].sort((a, b) => {
      const la = (a.sub.nameCn || a.sub.name || '').length
      const lb = (b.sub.nameCn || b.sub.name || '').length
      if (la !== lb) return la - lb
      const ad = dateVal(a.sub.airDate)
      const bd = dateVal(b.sub.airDate)
      if (!!ad !== !!bd) return ad ? -1 : 1
      return ad && bd ? ad.localeCompare(bd) : 0
    })
    return sortedSeason[0].sub
  }

  // 2) 无季词：限定主篇（season 1 / 无季标记）——绝不默认返回续作季
  const body = rows.filter((r) => r.season === 1 || !hasSeasonWord(r.sub.nameCn || r.sub.name || ''))
  if (!body.length) return null
  const exact = body.find((r) => coreOf(r.sub.nameCn || '') === kwCore || coreOf(r.sub.name || '') === kwCore)
  if (exact) return exact.sub
  const exactBody = body.filter((r) => coreOf(r.sub.nameCn || r.sub.name || '').includes(kwCore) || kwCore.includes(coreOf(r.sub.nameCn || r.sub.name || '')))
  if (exactBody.length === 1) return exactBody[0].sub
  if (exactBody.length > 1) {
    const dateVal = (d?: string) => (d ? d.replace(/[^0-9]/g, '') : '')
    const sortedExact = [...exactBody].sort((a, b) => {
      const la = (a.sub.nameCn || a.sub.name || '').length
      const lb = (b.sub.nameCn || b.sub.name || '').length
      if (la !== lb) return la - lb
      return dateVal(a.sub.airDate).localeCompare(dateVal(b.sub.airDate))
    })
    return sortedExact[0].sub
  }

  // 3) 兜底：只在名称含 kwCore 的相关候选中选（宁缺毋滥，绝不返回无关番）
  const relevant = rows.filter((r) => coreOf(r.sub.nameCn || r.sub.name || '').includes(kwCore) || kwCore.includes(coreOf(r.sub.nameCn || r.sub.name || '')))
  if (!relevant.length) return null
  // 带季词时，优先限定在对应季内
  let candidates = relevant
  if (wantSeasonWord) {
    const seasonal = relevant.filter((r) => r.season === wantSeason)
    if (seasonal.length) candidates = seasonal
  }
  // 名称短者优先（主番名通常最短，衍生/副标题更长）；同长按首播早
  const dateVal = (d?: string) => (d ? d.replace(/[^0-9]/g, '') : '')
  const sorted = [...candidates].sort((a, b) => {
    const la = (a.sub.nameCn || a.sub.name || '').length
    const lb = (b.sub.nameCn || b.sub.name || '').length
    if (la !== lb) return la - lb
    const ad = dateVal(a.sub.airDate)
    const bd = dateVal(b.sub.airDate)
    if (!!ad !== !!bd) return ad ? -1 : 1
    return ad && bd ? ad.localeCompare(bd) : 0
  })
  return sorted[0]?.sub ?? null
}

/** 渲染「查番唯一卡片」文本（工具与 REST 共用语义） */
function formatSubjectCard(sub: BangumiSubject, extra: {
  localEpisodes: number[]; total: number | undefined; downloaded: number; missing: number[];
  subscription?: { id: string; source: string } | null;
}): string {
  const nl = String.fromCharCode(10)
  const lines: string[] = []
  const name = sub.nameCn || sub.name
  lines.push('📺 ' + name + (sub.name && sub.nameCn && sub.name !== sub.nameCn ? ' / ' + sub.name : ''))
  lines.push('🔖 bgm.tv #' + sub.id)
  if (sub.platform) lines.push('📺 平台: ' + sub.platform)
  if (sub.airDate) lines.push('📅 首播: ' + sub.airDate)
  if (sub.totalEpisodes !== undefined) lines.push('🎞 共 ' + sub.totalEpisodes + ' 集')
  if (sub.summary) lines.push('📝 ' + sub.summary.replace(/\s+/g, ' ').slice(0, 200) + (sub.summary.length > 200 ? '…' : ''))
  if (sub.tags && sub.tags.length) lines.push('🏷 ' + sub.tags.slice(0, 6).join(' / '))
  if (extra.subscription) lines.push('✅ 已订阅（' + extra.subscription.source + '，id=' + extra.subscription.id + '）')
  else lines.push('❎ 未订阅')
  // 已更新到多少集
  const airedKnown = sub.totalEpisodes !== undefined
  lines.push('⏱ 已放送: ' + (airedKnown ? '至第 ' + (sub.totalEpisodes ?? '?') + ' 集' : '连载中，以实际为准'))
  lines.push('💾 本地已下载: ' + extra.downloaded + ' 集' + (extra.total !== undefined ? '/' + extra.total : ''))
  if (extra.localEpisodes.length) lines.push('  已有集号: ' + extra.localEpisodes.slice(0, 50).join(',') + (extra.localEpisodes.length > 50 ? '…' : ''))
  if (extra.missing.length) lines.push('  缺: ' + extra.missing.slice(0, 30).join(',') + (extra.missing.length > 30 ? '…' : ''))
  return lines.join(nl)
}

// ---------- apply：REST / 工具 / 定时 ----------

import type { IncomingMessage, ServerResponse } from 'node:http'

type WebServerRegistration = { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }
type WebServerLike = { register: (entry: WebServerRegistration) => () => void }
type BangumiContext = Context & { webServer: WebServerLike }


async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

interface Rt { cfg: Config; qb: QbClient; library: LibrarySnapshot | null; libraryScanning: boolean; resetCaches: boolean }

export function apply(ctx: Context, config: Config): void {
  const bctx = ctx as unknown as BangumiContext
  const logger = bctx.logger
  const rt: Rt = {
    cfg: resolveConfig(config),
    qb: null as unknown as QbClient,
    library: null,
    libraryScanning: false,
    resetCaches: false,
  }
  rt.qb = new QbClient({ url: rt.cfg.qbUrl, username: rt.cfg.qbUsername, password: rt.cfg.qbPassword })

  const reloadRuntime = (): void => {
    rt.cfg = resolveConfig(config)
    rt.qb = new QbClient({ url: rt.cfg.qbUrl, username: rt.cfg.qbUsername, password: rt.cfg.qbPassword })
    // 媒体库快照以 db 为权威：设置变更后丢弃内存壳，下次按需从 db 水合
    rt.library = null
    rt.resetCaches = true
  }

  /** 返回媒体库快照：优先内存，必要时从 db 水合（目录变更后自动重扫） */
  const getLibrary = async (): Promise<LibrarySnapshot> => {
    if (rt.resetCaches) {
      rt.library = null
      rt.resetCaches = false
    }
    if (rt.library) return rt.library
    const meta = getDb().getLibraryMeta()
    if (rt.cfg.mediaDirs.length === 0) return { files: [], byTitle: {}, scannedAt: meta.scannedAt, roots: [] }
    const needRescan =
      !meta.scannedAt ||
      meta.roots.length === 0 ||
      JSON.stringify(meta.roots.sort()) !== JSON.stringify([...rt.cfg.mediaDirs].sort())
    if (!needRescan) {
      const files = getDb().loadLibraryFiles()
      if (files.length || meta.scannedAt) {
        rt.library = { files, byTitle: buildByTitle(files), scannedAt: meta.scannedAt, roots: meta.roots }
        return rt.library
      }
    }
    return doLibraryScan()
  }

  const doLibraryScan = async (): Promise<LibrarySnapshot> => {
    if (rt.libraryScanning) return rt.library ?? { files: [], byTitle: {}, scannedAt: 0, roots: [] }
    rt.libraryScanning = true
    try {
      const snap = await scanLibrary(rt.cfg.mediaDirs)
      rt.library = snap
      rt.resetCaches = false
      // 持久化快照 -> sqlite（启动时据此水合；root 标记用于下次扫描剔除消失目录）
      getDb().replaceLibrary(snap.files, snap.roots, snap.scannedAt)
      return snap
    } finally {
      rt.libraryScanning = false
    }
  }

  // ---------- REST ----------
  bctx.effect(() => bctx.webServer.register({
    kind: 'prefix',
    path: '/api/bangumi',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://local')
        const route = url.pathname.replace(/^\/api\/bangumi/, '') || '/'
        try {
          if (route === '/settings' && req.method === 'GET') {
            return sendJson(res, 200, { settings: rt.cfg, file: FILE_CONFIG })
          }
          if (route === '/settings' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const next = { ...loadFileConfig(), ...body }
            const { writeFileSync, mkdirSync } = await import('node:fs')
            const { dirname } = await import('node:path')
            mkdirSync(dirname(FILE_CONFIG), { recursive: true })
            writeFileSync(FILE_CONFIG, JSON.stringify(next, null, 2), 'utf8')
            reloadRuntime()
            return sendJson(res, 200, { settings: rt.cfg })
          }
          if (route === '/qb/status') {
            return sendJson(res, 200, await rt.qb.test())
          }
          if (route === '/subscriptions' && req.method === 'GET') {
            await getLibrary()
            const state = getState()
            const rows = []
            for (const sub of state.subscriptions) {
              try {
                const progress = await progressFor(rt, sub)
                rows.push({ ...sub, progress })
              } catch {
                rows.push({ ...sub, progress: null })
              }
            }
            return sendJson(res, 200, { subscriptions: rows })
          }
          if (route === '/subscriptions' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const sub = await subscribeBangumi(rt, Number(body.bangumiId), {
              source: body.source === 'nyaa' ? 'nyaa' : 'dmhy',
              group: body.group, resolution: body.resolution, query: body.query,
            })
            // 订阅后立即触发一轮判新（不等下一轮 timer），结果异步返回不阻塞响应
            const snap = await getLibrary().catch(() => null)
            if (snap) rt.library = snap
            void pollSubscriptions(rt, logger).then((fresh) => {
              if (fresh.length) logger.info('bangumi post-subscribe fetched %d episode(s) for %s', fresh.length, sub.id)
            }).catch((err) => logger.warn('bangumi post-subscribe poll fail: %s', err instanceof Error ? err.message : String(err)))
            return sendJson(res, 200, { subscription: sub })
          }
          if (route === '/subscriptions/delete' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            const sub = await unsubscribeBangumi(rt, String(body.id))
            return sendJson(res, 200, { removed: sub.id })
          }
          if (route === '/search' && req.method === 'GET') {
            const bangumiId = Number(url.searchParams.get('bangumiId') ?? 0)
            const source = (url.searchParams.get('source') ?? 'both') as 'nyaa' | 'dmhy' | 'both'
            const q = url.searchParams.get('query') ?? undefined
            const out = await searchTorrentsForBangumi(rt, bangumiId, { source, query: q })
            // 标注本地已有集数（查重核心信息）
            const libSnap = await getLibrary()
            const lib = libSnap ? findEpisodesInLibrary(libSnap, out.subject.aliases ?? []) : { episodes: [] as number[], count: 0 }
            return sendJson(res, 200, {
              subject: out.subject,
              localEpisodes: lib.episodes,
              items: out.items.map((s) => ({
                title: s.item.title,
                magnet: s.item.magnet,
                page: s.item.page,
                pubDate: s.item.pubDate,
                seeders: s.item.seeders,
                size: s.item.size,
                author: s.item.author,
                score: s.score,
                reasons: s.reasons,
                episode: s.parsed?.episode,
                group: s.parsed?.group,
                resolution: s.parsed?.resolution,
              })),
            })
          }
          if (route === '/subject' && req.method === 'GET') {
            const id = Number(url.searchParams.get('id'))
            const got = await getSubjectCached(id)
            const episodes = await getEpisodesCached(id).catch(() => [])
            return sendJson(res, 200, { subject: got.subject, aliases: got.aliases, episodes })
          }
          if (route === '/bangumi-search' && req.method === 'GET') {
            const q = url.searchParams.get('q') ?? ''
            return sendJson(res, 200, { results: await searchSubjects(q, 12) })
          }
          if (route === '/download' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}')
            await rt.qb.addMagnet(String(body.magnet), {
              savePath: rt.cfg.qbSavePath || undefined,
              category: rt.cfg.qbCategory,
              tags: rt.cfg.qbTags,
            })
            const state = getState()
            state.downloads.push({ magnet: String(body.magnet), title: String(body.title ?? ''), origin: 'qb', at: Date.now() })
            saveState(state)
            return sendJson(res, 200, { ok: true })
          }
          if (route === '/library' && req.method === 'GET') {
            const snap = await getLibrary()
            return sendJson(res, 200, { scanning: rt.libraryScanning, scannedAt: snap?.scannedAt ?? 0, files: snap?.files.length ?? 0, titles: snap ? Object.keys(snap.byTitle).length : 0 })
          }
          if (route === '/library/scan' && req.method === 'POST') {
            const snap = await doLibraryScan()
            return sendJson(res, 200, { files: snap.files.length, titles: Object.keys(snap.byTitle).length, scannedAt: snap.scannedAt })
          }
          if (route === '/calendar' && req.method === 'GET') {
            const year = Number(url.searchParams.get('year')) || new Date().getFullYear()
            const month = Number(url.searchParams.get('month')) || new Date().getMonth() + 1
            const state = getState()
            const days = new Date(year, month, 0).getDate()
            const calendar: Array<{ date: string; items: Array<{ name: string; nameCn: string; episode: number | null }> }> = []
            for (let d = 1; d <= days; d += 1) {
              const date = new Date(year, month - 1, d)
              const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0')
              const items: Array<{ name: string; nameCn: string; episode: number | null }> = []
              for (const sub of state.subscriptions) {
                if (sub.weekday === undefined || date.getDay() !== sub.weekday) continue
                let ep: number | null = null
                if (sub.airDate) {
                  const first = new Date(sub.airDate + 'T00:00:00')
                  const est = date >= first ? Math.floor((date.getTime() - first.getTime()) / (7 * 86400_000)) + 1 : null
                  // 已在播的集数估算；超过总集数说明番已完结，不再逐周铺点
                  if (est !== null && (sub.totalEpisodes === undefined || est <= sub.totalEpisodes)) ep = est
                }
                if (ep !== null) items.push({ name: sub.name, nameCn: sub.nameCn, episode: ep })
              }
              if (items.length) calendar.push({ date: iso, items })
            }
            return sendJson(res, 200, { calendar })
          }
          if (route === '/lookup' && req.method === 'GET') {
            const kw = url.searchParams.get('q') ?? ''
            const subject = await lookupSubject(kw)
            if (!subject) return sendJson(res, 404, { error: 'no unique subject for: ' + kw })
            const bundle = await subjectBundle(subject.id)
            const libSnap = await getLibrary()
            const lib = libSnap ? findEpisodesInLibrary(libSnap, bundle.aliases) : { episodes: [] as number[], count: 0 }
            const epsCache = getDb().getEpisodesCache(subject.id)
            return sendJson(res, 200, {
              subject: bundle.subject,
              aliases: bundle.aliases,
              localEpisodes: lib.episodes,
              progress: {
                libraryCount: lib.count,
                downloaded: lib.count,
                total: subject.totalEpisodes ?? undefined,
                missing: subject.totalEpisodes
                  ? Array.from({ length: subject.totalEpisodes }, (_v, i) => i + 1).filter((n) => !lib.episodes.includes(n))
                  : [],
              },
              episodesCached: !!epsCache,
            })
          }
          sendJson(res, 404, { error: 'not found: ' + route })
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })()
    },
  }), '@dsh-external/dsh-bangumi: rest api')

  logger.info('bangumi plugin mounted at /api/bangumi (qb=%s, mediaDirs=%d)', rt.cfg.qbUrl, rt.cfg.mediaDirs.length)
  // ---------- 工具（供 LLM 调用） ----------
  const text = (v: unknown) => [{ type: 'text' as const, text: String(v) }]

  ctx.effect(() => [
    ctx.tools.register(defineTool({
      name: 'bangumi_lookup',
      description: '查一部番的完整资料卡（唯一返回）：自动收敛到最匹配的一部，含封面/平台/简介/总集数/已放送/本地已下载集数/缺集/订阅状态。优先用这个而非 bangumi_search',
      parameters: {
        keyword: { type: 'string', required: true, description: '番名关键词（中日文皆可）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { keyword: string }) {
        const subject = await lookupSubject(args.keyword)
        if (!subject) return '未找到匹配的番剧: ' + args.keyword
        const bundle = await subjectBundle(subject.id)
        const libSnap = await getLibrary()
        const lib = libSnap ? findEpisodesInLibrary(libSnap, bundle.aliases) : { episodes: [] as number[], count: 0 }
        const state = getState()
        const sub = state.subscriptions.find((x) => x.bangumiId === subject.id)
        const total = subject.totalEpisodes
        const missing = total
          ? Array.from({ length: total }, (_v, i) => i + 1).filter((n) => !lib.episodes.includes(n))
          : []
        return formatSubjectCard(subject, {
          localEpisodes: lib.episodes,
          total,
          downloaded: lib.count,
          missing,
          subscription: sub ? { id: sub.id, source: sub.source } : null,
        })
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_search',
      description: '列出候选番剧（同名/续作/衍生都在内）+ 可选检索 nyaa/dmhy 种子候选；返回 matchScore 与本地库已有集数。单查一部请用 bangumi_lookup（唯一卡片）',
      parameters: {
        keyword: { type: 'string', required: true, description: '番名关键词（中日文皆可）' },
        withTorrents: { type: 'boolean', description: '是否同时检索种子列表（默认 false）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { keyword: string; withTorrents?: boolean }) {
        const subs = await searchSubjects(args.keyword, 8)
        if (!subs.length) return '未找到番剧: ' + args.keyword
        const nl = String.fromCharCode(10)
        const lines: string[] = ['找到 ' + subs.length + ' 部番剧：']
        for (const s of subs) {
          lines.push('- [' + s.id + '] ' + (s.nameCn || s.name) + (s.nameCn && s.name !== s.nameCn ? ' / ' + s.name : '') + '（首播 ' + (s.airDate ?? '?') + '，共 ' + (s.totalEpisodes ?? '?') + ' 集）')
        }
        if (args.withTorrents && subs[0]) {
          const out = await searchTorrentsForBangumi(rt, subs[0].id, { source: 'both' })
          const libSnap = await getLibrary()
          const lib = libSnap ? findEpisodesInLibrary(libSnap, out.subject.aliases ?? []) : { episodes: [] as number[], count: 0 }
          lines.push('', '「' + (out.subject.nameCn || out.subject.name) + '」本地库已有 ' + lib.count + ' 集' + (lib.count ? '（' + lib.episodes.slice(0, 30).join(',') + '）' : ''))
          for (const r of out.items.slice(0, 12)) {
            lines.push('- [' + r.score + '分] ' + r.item.title + (r.item.magnet ? ' （可下载）' : '（无磁链）'))
          }
        }
        return lines.join(nl)
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_subscribe',
      description: '订阅番剧（nyaa/dmhy）：插件自动判新下载到 qBittorrent——已完结番优先一次拿全集资源，连载番只补最新缺集并持续轮询新集；自动套用保存目录/分类/标签',
      parameters: {
        bangumiId: { type: 'number', required: true, description: 'Bangumi 条目 ID（先用 bangumi_search 查）' },
        source: { type: 'string', required: true, description: 'rss 源：nyaa 或 dmhy' },
        group: { type: 'string', description: '限定发布组（可选）' },
        resolution: { type: 'string', description: '如 1080p（可选）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { bangumiId: number; source: string; group?: string; resolution?: string }) {
        const sub = await subscribeBangumi(rt, args.bangumiId, { source: args.source === 'nyaa' ? 'nyaa' : 'dmhy', group: args.group, resolution: args.resolution })
        return '已订阅「' + (sub.nameCn || sub.name) + '」（' + sub.source + '，id=' + sub.id + '）。插件每 ' + rt.cfg.pollIntervalMinutes + ' 分钟检查新集并自动下载到 qBittorrent。'
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_unsubscribe',
      description: '退订番剧：停止该番的自动判新下载，移除本地跟踪（及旧版遗留的 qB RSS 规则）',
      parameters: { id: { type: 'string', required: true, description: '订阅 id（bangumi_list 可见）' } },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { id: string }) {
        const sub = await unsubscribeBangumi(rt, args.id)
        return '已退订「' + (sub.nameCn || sub.name) + '」'
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_list',
      description: '列出当前订阅的番剧与下载进度（总集数/已下载/缺哪几集，含本地媒体库）',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute() {
        await getLibrary()
        const state = getState()
        if (!state.subscriptions.length) return '暂无订阅。用 bangumi_lookup + bangumi_subscribe 开始追番。'
        const nl = String.fromCharCode(10)
        const lines: string[] = ['当前订阅 ' + state.subscriptions.length + ' 部：']
        for (const sub of state.subscriptions) {
          const p = await progressFor(rt, sub)
          const miss = p.missing.length ? ' 缺: ' + p.missing.join(',') + '；' : ''
          const st = sub.completedAt ? '✅ 齐集已停' : sub.status === 'finished' ? '📺 已完结' : sub.status === 'airing' ? '📡 连载中' : ''
          lines.push('- [' + sub.id + '] ' + (sub.nameCn || sub.name) + '：' + p.downloaded + '/' + (p.total ?? '?') + miss + '（' + sub.source + '）' + (st ? ' ' + st : ''))
        }
        return lines.join(nl)
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_progress',
      description: '查看单个订阅番剧的下载进度（本地∪qB），给出缺失集号列表',
      parameters: { id: { type: 'string', required: true, description: '订阅 id' } },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { id: string }) {
        await getLibrary()
        const sub = getState().subscriptions.find((s) => s.id === args.id)
        if (!sub) return '订阅不存在: ' + args.id
        const p = await progressFor(rt, sub)
        const statusTag = sub.completedAt ? '（已齐集自动停订阅）' : sub.status === 'finished' ? '（已完结）' : sub.status === 'airing' ? '（连载中）' : ''
        return (sub.nameCn || sub.name) + '：共 ' + (p.total ?? '?') + ' 集，已下载 ' + p.downloaded + '（本地 ' + p.library.length + ' / qB ' + p.qbEps.length + '）' + (p.missing.length ? '，缺 ' + p.missing.join(',') : '') + statusTag
      },
    })),

    ctx.tools.register(defineTool({
      name: 'bangumi_calendar',
      description: '本月追番日历：哪天更新哪部番第几集',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute() {
        const now = new Date()
        const state = getState()
        const nl = String.fromCharCode(10)
        const lines: string[] = [now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + ' 追番表：']
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        let any = false
        for (let d = 1; d <= days; d += 1) {
          const date = new Date(now.getFullYear(), now.getMonth(), d)
          const items: string[] = []
          for (const sub of state.subscriptions) {
            if (sub.weekday === undefined || date.getDay() !== sub.weekday) continue
            let ep: number | null = null
            if (sub.airDate) {
              const first = new Date(sub.airDate + 'T00:00:00')
              if (date >= first) ep = Math.floor((date.getTime() - first.getTime()) / (7 * 86400_000)) + 1
            }
            items.push((sub.nameCn || sub.name) + (ep ? ' EP' + ep : ''))
          }
          if (items.length) { any = true; lines.push(String(d).padStart(2, '0') + ': ' + items.join(', ')) }
        }
        if (!any) lines.push('（本月暂无订阅更新）')
        return lines.join(nl)
      },
    })),

    ctx.tools.register(defineTool({
      name: 'qb_status',
      description: '检查 qBittorrent 连接与版本（验证配置是否生效）',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute() {
        const r = await rt.qb.test()
        return r.ok ? 'qBittorrent 正常（' + rt.cfg.qbUrl + '，版本 ' + (r.version ?? '?') + '）' : '连接失败: ' + (r.error ?? '?')
      },
    })),

    ctx.tools.register(defineTool({
      name: 'qb_configure',
      description: '写入 qBittorrent 连接与默认保存参数（~/.dsh/dsh-bangumi.json，立即生效）',
      parameters: {
        url: { type: 'string', description: 'qB WebUI 地址，如 http://127.0.0.1:8080' },
        username: { type: 'string', description: 'qB 用户名' },
        password: { type: 'string', description: 'qB 密码' },
        savePath: { type: 'string', description: '下载保存目录' },
        category: { type: 'string', description: '分类，默认 bangumi' },
        tags: { type: 'string', description: '标签，逗号分隔' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: Record<string, string>) {
        const { readFileSync: rf, writeFileSync: wf, mkdirSync: md, existsSync: ex } = await import('node:fs')
        const { dirname } = await import('node:path')
        let cur: Record<string, unknown> = {}
        if (ex(FILE_CONFIG)) { try { cur = JSON.parse(rf(FILE_CONFIG, 'utf8')) } catch { cur = {} } }
        if (args.url) cur.qbUrl = args.url
        if (args.username) cur.qbUsername = args.username
        if (args.password) cur.qbPassword = args.password
        if (args.savePath) cur.qbSavePath = args.savePath
        if (args.category) cur.qbCategory = args.category
        if (args.tags) cur.qbTags = args.tags
        md(dirname(FILE_CONFIG), { recursive: true })
        wf(FILE_CONFIG, JSON.stringify(cur, null, 2), 'utf8')
        reloadRuntime()
        return '已保存并生效：qbUrl=' + rt.cfg.qbUrl + ' category=' + rt.cfg.qbCategory + ' savePath=' + (rt.cfg.qbSavePath || '(qB 默认)')
      },
    })),

    ctx.tools.register(defineTool({
      name: 'qb_add_torrent',
      description: '手动加一个磁链到 qBittorrent（自动套用保存目录/分类/标签）',
      parameters: { magnet: { type: 'string', required: true, description: 'magnet:?xt=... 链接' } },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { magnet: string }) {
        await rt.qb.addMagnet(args.magnet, { savePath: rt.cfg.qbSavePath || undefined, category: rt.cfg.qbCategory, tags: rt.cfg.qbTags })
        return '已添加下载'
      },
    })),

    ctx.tools.register(defineTool({
      name: 'library_scan',
      description: '立即扫描媒体库（设置里配置的媒体库目录列表），更新「本地已有集数」',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute() {
        const snap = await doLibraryScan()
        return '媒体库扫描完成：' + snap.files.length + ' 个视频文件，识别出 ' + Object.keys(snap.byTitle).length + ' 部作品。目录: ' + snap.roots.join('; ')
      },
    })),
  ], '@dsh-external/dsh-bangumi: tools')

  // ---------- 定时：媒体库首扫 + 旧 RSS 迁移清理（一次性）+ 自管判新下载 ----------
  ctx.effect(() => {
    let cleanedLegacy = false
    const tick = async (): Promise<void> => {
      try {
        if (rt.cfg.mediaDirs.length && !rt.library) {
          rt.library = await getLibrary().catch(() => null)
        }
        if (!cleanedLegacy) {
          cleanedLegacy = true
          await cleanupLegacyRss(rt, logger)
        }
        const fresh = await pollSubscriptions(rt, logger)
        if (fresh.length) {
          logger.info('bangumi auto-downloaded %d new episode(s)', fresh.length)
        }
      } catch (err) {
        logger.warn('bangumi tick failed: %s', err instanceof Error ? err.message : String(err))
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), Math.max(5, rt.cfg.pollIntervalMinutes) * 60_000)
    return () => clearInterval(timer)
  }, '@dsh-external/dsh-bangumi: timer')
}