/**
 * @dsh-external/dsh-bangumi — 追番订阅插件（host）。
 * 能力：Bangumi 元数据 / nyaa+dmhy 搜索 / qBittorrent RSS 订阅 / 本地媒体库查重 / 进度聚合。
 *
 * 配置读取优先级：env DSH_BANGUMI_* → ~/.dsh/dsh-bangumi.json → Config 默认值。
 * 状态持久化：~/.dsh/dsh-bangumi/state.json（订阅 + 下载记录）。
 * REST：/api/bangumi/*（webServer.register prefix），client 面板直接 fetch 同路径。
 */
import { readFileSync, appendFileSync, statSync, truncateSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

import { getEpisodesCached, getSubjectCached, searchSubjects, type BangumiSubject } from './host/bangumi.js'
import { subjectCardHtml } from './host/card.js'
import { scanLibrary, buildByTitle, buildByDir, findEpisodesInLibrary, findBestCandidate, type LibrarySnapshot, type PosterCandidate } from './host/library.js'
import { getDb } from './host/db.js'
import { rankItems, type ScoredItem } from './host/match.js'
import { detectPack, normalizeTitle, parseEpisode } from './host/parse.js'
import { decideDownloads, collectHave, isCovered, type DecisionAction } from './host/decision.js'
import { QbClient } from './host/qb.js'
import { dmhySearchUrl, fetchFeed, nyaaSearchUrl, searchDmhy, searchNyaa, type RssItem } from './host/rss.js'
import { getState, saveState, type Subscription } from './host/store.js'
import { AiReviewer, type AiReviewConfig, type LlmStreamLike } from './host/ai-review.js'

const DBG = homedir() + '/.dsh/dsh-bangumi-debug.log'
function dbg(msg: string): void {
  try {
    const st = statSync(DBG, { throwIfNoEntry: false })
    if (st && st.size > 512 * 1024) truncateSync(DBG, Math.floor(st.size / 2)) // 超 512KB 截半防膨胀
    appendFileSync(DBG, new Date().toISOString() + ' ' + msg + '\n')
  } catch { /* ignore */ }
}

export const name = '@dsh-external/dsh-bangumi'
export const inject = ['webServer', 'tools', 'llm']

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
  /** AI 介入开关（强介入：每轮轮询/下载/媒体库扫描都经 AI 判断）；false=纯脚本 */
  aiEnabled: boolean
  /** AI 路由（provider/model；后台无会话，必须显式指定，如 deepseek-official/deepseek-chat） */
  aiProvider: string
  aiModel: string
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
  // AI 介入默认关（避免无配置时后台乱调模型）。开启需在 ~/.dsh/dsh-bangumi.json 设 aiEnabled+aiProvider+aiModel
  aiEnabled: z.boolean().default(false),
  aiProvider: z.string().default(''),
  aiModel: z.string().default(''),
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
    if (typeof obj.aiEnabled === 'boolean') out.aiEnabled = obj.aiEnabled
    if (typeof obj.aiProvider === 'string') out.aiProvider = obj.aiProvider
    if (typeof obj.aiModel === 'string') out.aiModel = obj.aiModel
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
    aiEnabled: file.aiEnabled ?? config.aiEnabled,
    aiProvider: env.DSH_BANGUMI_AI_PROVIDER ?? file.aiProvider ?? config.aiProvider,
    aiModel: env.DSH_BANGUMI_AI_MODEL ?? file.aiModel ?? config.aiModel,
  }
}

/** 运行时（设置写文件后 reloadRuntime 立即生效，无需重启） */
interface Runtime {
  cfg: Config
  qb: QbClient
  library: LibrarySnapshot | null
  libraryScanning: boolean
  /** AI 审核层（强介入；aiEnabled=false 时 enabled=false，各调用点回退纯脚本） */
  ai: AiReviewer
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
 * 介入点2 — 下载前 AI 审核（强介入）：
 * rt.ai.enabled 且 AI 判定不通过 → 返回 {ok:false}（调用方跳过该磁力，记日志）；
 * AI 给出 alternativeMagnet → 替换下载目标；AI 未配置/调用失败(null) → 放行（AI 不阻塞脚本）。
 */
async function aiApproveDownload(
  rt: Runtime,
  info: {
    subName: string
    bangumiId?: number
    episode?: number
    full: boolean
    title: string
    magnet: string
    group?: string
    resolution?: string
    score: number
    haveEpisodes: number[]
    totalEpisodes?: number
  },
  logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void },
): Promise<{ ok: boolean; magnet: string; title: string }> {
  const base = { magnet: info.magnet, title: info.title }
  if (!rt.ai.enabled) return { ok: true, ...base }
  const verdict = await rt.ai.reviewDownload({
    subName: info.subName,
    episode: info.episode,
    full: info.full,
    title: info.title,
    magnet: info.magnet,
    group: info.group,
    resolution: info.resolution,
    score: info.score,
    haveEpisodes: info.haveEpisodes,
    totalEpisodes: info.totalEpisodes,
  })
  if (!verdict) return { ok: true, ...base } // AI 失败 → 不阻塞
  if (verdict.alternativeMagnet && verdict.alternativeMagnet.startsWith('magnet:?xt=')) {
    logger.info('bangumi ai-swap-magnet: %s (%s)', info.subName, verdict.reason)
    return { ok: true, magnet: verdict.alternativeMagnet, title: info.title }
  }
  if (!verdict.approve) {
    logger.info('bangumi ai-veto-download: %s ep=%s %s (%s)', info.subName, info.episode ?? '全集', info.title.slice(0, 60), verdict.reason)
    return { ok: false, ...base }
  }
  return { ok: true, ...base }
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
      // 窗口过滤：完结番全集不受限；连载番收回看窗内（3 天内发布）的候选。
      // 注意：不再要求 pub > lastCheckAt——「已发布但当时漏下」的窗内缺集（如切源/订阅
      // 后补历史）也应能补；是否真缺由决策层判断（已有集不会重复下）。远古条目仍被
      // cursorFloor 挡在窗外，防订阅即拉全集。lastCheckAt 仅作状态记录。
      const lookback = rt.cfg.rssIgnoreDays * 86400_000
      const cursorFloor = Date.now() - lookback
      const windowed = ranked.filter((c) => {
        if (c.pack?.isPack) return true // 整包（全集）始终候选（完结判定在决策层把关）
        const pub = c.item.pubDate ? new Date(c.item.pubDate).getTime() : Date.now()
        return pub >= cursorFloor && c.score >= rt.cfg.minMatchScore
      })
      // 完结态（bgm episodes 缓存；拉取失败沿用旧 status）
      let finished = sub.status === 'finished'
      let epsAll = await getEpisodesCached(sub.bangumiId).catch(() => [] as Array<{ ep: number; airDate?: string }>)
      if (sub.status !== 'finished') {
        try {
          if (epsAll.length) {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const hasFuture = epsAll.some((e) => e.airDate && new Date(e.airDate + 'T00:00:00').getTime() > today.getTime())
            finished = !hasFuture && epsAll.length > 0 // 全部定档且无未来日期 = 已放送完（完结）
            if (epsAll.length === 1 && hasFuture) finished = false
          }
        } catch {
          /* bgm 不可达：沿用 */
        }
        sub.status = finished ? 'finished' : 'airing'
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
      let aiDecided: Awaited<ReturnType<AiReviewer['reviewCandidates']>> = null
      let aiCandidates = windowed
      dbg('ai-gate sub=' + sub.id + ' enabled=' + rt.ai.enabled + ' ranked=' + ranked.length + ' windowed=' + windowed.length + ' have=' + JSON.stringify([...have].sort((a: number, b: number) => a - b)))
      if (rt.ai.enabled) {
        // 已放送但本地没有的集号（供 AI 判断是否补历史）
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const airedEps = epsAll.filter((e) => e.airDate && new Date(e.airDate + 'T00:00:00').getTime() <= today.getTime()).map((e) => e.ep)
        const missingAired = airedEps.filter((n) => !have.has(n))
        aiDecided = await rt.ai.reviewCandidates({
          subName: sub.nameCn || sub.name,
          bangumiId: sub.bangumiId,
          totalEpisodes: sub.totalEpisodes,
          finished,
          haveEpisodes: [...have].sort((a, b) => a - b),
          missingAired,
          candidates: windowed.map((c) => ({
            episode: c.parsed?.episode,
            full: !!c.pack?.isPack,
            range: c.pack?.rangeRaw,
            title: c.item.title,
            score: c.score,
            pubDate: c.item.pubDate,
            group: c.parsed?.group,
          })),
        })
        if (aiDecided && aiDecided.decision === 'hold') {
          // AI 判定本轮不下（画质/源不理想/放送未到等）
          logger.info('bangumi ai-hold: sub=%s %s (%s)', sub.id, sub.nameCn || sub.name, aiDecided.reason)
          sub.lastCheckAt = Date.now()
          saveState(state)
          continue
        }
        if (aiDecided && aiDecided.decision === 'download-selected') {
          // 只下 AI 选中的集：筛出对应候选，交下方统一决策/下载循环
          const sel = new Set(aiDecided.selectedEpisodes)
          aiCandidates = windowed.filter((c) => c.parsed?.episode !== undefined && sel.has(c.parsed.episode))
          logger.info('bangumi ai-select: sub=%s select [%s] of %s candidates (%s)',
            sub.id, [...sel].sort((a, b) => a - b).join(','), windowed.length, aiDecided.reason)
        }
        if (aiDecided && aiDecided.decision === 'search-backfill') {
          // AI 指出历史缺集需补搜：跨源搜索（dmhy 订阅读 nyaa，反之读 dmhy），
          // 命中缺集的条目并入本轮候选走统一决策/下载循环（have 检查防重复）。
          logger.info('bangumi ai-backfill: sub=%s missing %s (%s)', sub.id, aiDecided.backfillEpisodes.join(','), aiDecided.reason)
          const want = new Set(aiDecided.backfillEpisodes)
          try {
            // 补搜关键词：遍历别名（日文/英文名在异源上才搜得到；中文名往往只命中中文站）
            const base = (sub.nameCn || sub.name || '').replace(/第?[一二三四五]季/g, '').trim()
            const kws = [base, ...(sub.aliases.filter((a) => normalizeTitle(a).length >= 3 && a !== base))].slice(0, 4)
            let items: RssItem[] = []
            let kwUsed = ''
            for (const kw of kws) {
              const hits = sub.source === 'dmhy' ? await searchNyaa(kw) : await searchDmhy(kw)
              if (hits.length) { items = hits; kwUsed = kw; break }
            }
            dbg('ai-backfill-search sub=' + sub.id + ' kws=' + kws.join('|') + ' got=' + items.length + ' via=' + (sub.source === 'dmhy' ? 'nyaa' : 'dmhy') + ' kw=' + kwUsed)
            const bf = rankItems(items, {
              aliases: sub.aliases.length ? sub.aliases : [kwUsed || base],
              seasonOnly: sub.season ?? 1,
              preferResolution: sub.resolution,
              preferGroup: sub.group,
            }).filter((c) => c.parsed?.episode !== undefined && want.has(c.parsed.episode) && c.score >= rt.cfg.minMatchScore)
            const seen = new Set(aiCandidates.map((c) => c.item.magnet))
            const fresh = bf.filter((c) => !seen.has(c.item.magnet))
            if (fresh.length) {
              aiCandidates = [...fresh, ...aiCandidates]
              dbg('ai-backfill hit sub=' + sub.id + ' eps=' + fresh.map((c) => c.parsed?.episode).join(','))
              logger.info('bangumi ai-backfill found %d for sub=%s (%s)', fresh.length, sub.id, aiDecided.reason)
            } else {
              dbg('ai-backfill miss sub=' + sub.id + ' want=' + aiDecided.backfillEpisodes.join(','))
            }
          } catch (err) {
            logger.warn('bangumi ai-backfill search fail %s: %s', sub.id, err instanceof Error ? err.message : String(err))
          }
        }
        // download-all / search-backfill / null(失败回退) → aiCandidates 保持 windowed 走原逻辑
      }
      const dec = decideDownloads({ ...input2, candidates: aiCandidates })
      dbg('ai-done sub=' + sub.id + ' verdict=' + (aiDecided ? aiDecided.decision : 'null') + ' aiCands=' + aiCandidates.length + ' actions=' + dec.actions.map((a: { episode?: number; why: string; full?: boolean }) => (a.episode ?? (a.full ? 'full' : '?')).toString()).join(',') + ' why=' + dec.actions.map((a: { why: string }) => a.why).join('|').slice(0, 80))
      for (const act of dec.actions) {
        try {
          const magnet0 = act.scored.item.magnet
          if (!magnet0) continue
          // 介入点2：每次下载前 AI 审核（未配置/失败放行；否决则跳过）
          const gated = await aiApproveDownload(rt, {
            subName: sub.nameCn || sub.name,
            bangumiId: sub.bangumiId,
            episode: act.episode,
            full: act.full,
            title: act.scored.item.title,
            magnet: magnet0,
            group: act.scored.parsed?.group,
            resolution: act.scored.parsed?.resolution,
            score: act.scored.score,
            haveEpisodes: [...have].sort((a, b) => a - b),
            totalEpisodes: sub.totalEpisodes,
          }, logger)
          if (!gated.ok) {
            logger.warn('bangumi ai-skip: sub=%s %s (%s)', sub.id, act.why, act.scored.item.title.slice(0, 60))
            continue
          }
          const magnet = gated.magnet
          const dlTitle = gated.title
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
    .replace(/\b(?:s[2-5]|seasons*[2-5]|parts*[2-5]|2nd|3rd|second|third)\b/g, '')
    .replace(/[〜~～].*$/, '')
    .replace(/[（(].*?[）)]/g, '')
}

/**
 * 去掉中文名后的英文副标题（含空格分隔/冒号分隔，只对「主名含汉字」生效，纯英文不动）：
 *   '攻壳机动队 THE GHOST IN THE SHELL' → '攻壳机动队'
 *   '攻壳机动队 STAND ALONE COMPLEX'    → '攻壳机动队'
 * 副标也剥季词（如 S.A.C. 2nd GIG / THE MOVIE）以与季判定对齐；末尾残留分隔符一并清理。
 */
function stripEnSuffix(base: string): string {
  let out = base
  if (/[\u4e00-\u9fff]/.test(out)) {
    out = out.replace(/[\s·:：-]+[A-Za-z0-9].*$/, '')
    out = out.replace(/\s*[Ss](?:eason)?\s*(\d+)$/i, '')
    out = out.replace(/\s*[（(]\s*[Ss](?:eason)?\s*(\d+)\s*[）)]$/i, '')
  }
  out = out.replace(/[\s·:：-]+$/, '')
  return out.trim()
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
    .replace(/\b[Ss]([2-9])\b/g, '')
    .replace(/\b(?:Season|Part)s*[2-9]\b/gi, '')
  const final = stripEnSuffix(stripped) || base
  return final
}
/** 布局目标：{category, savePath}。S1 且同作品无更高季订阅 → 扁平 番/作品；否则 番/作品/第N季 */
function layoutFor(rt: Runtime, sub: { nameCn?: string; name?: string; season?: number; id?: string }): { category: string; savePath: string; season: number; core: string } {
  const core = coreNameOf(sub)
  const season = Math.max(1, sub.season ?? 1)
  const st = getState()
  // 同作品已有 S≥2 订阅/下载 → 分层（老行 season 缺失时从名字推断）
  const xSeason = (x: { nameCn?: string; name?: string; season?: number }): number => {
    const s = x.season ?? seasonOf((x.nameCn || '') + ' ' + (x.name || ''))
    return s >= 2 ? s : 1
  }
  const laterSubExists = st.subscriptions.some((x) => x.id !== (sub.id ?? '') && coreNameOf(x) === core && xSeason(x) >= 2)
  const layered = season >= 2 || laterSubExists
  const root = (rt.cfg.qbCategoryRoot || '番').replace(/\/+$/, '')
  const base = (rt.cfg.qbBaseDir || '').replace(/\/+$/, '')
  const parts = [core]
  if (layered) parts.push(seasonLabel(season))
  const category = [root, ...parts].join('/')
  const savePath = base ? [base, ...parts].join('/') : ''
  return { category, savePath, season, core }
}

/** 双向包含（别名/标题匹配用；两侧同源清洗后再判） */
const covers = (a: string, b: string): boolean => {
  const x = normalizeTitle(stripEnSuffix(a))
  const y = normalizeTitle(stripEnSuffix(b))
  return (x.length > 0 && y.length > 0) && (x.includes(y) || y.includes(x))
}

/** 无 bangumiId 的标题直入布局：先按标题匹配既有订阅（别名/核心），命中 → 复用该订阅的
 * category/savePath（若标题里出现与订阅季冲突的显式季词，按显式季重算布局）；
 * 未命中 → 清洗标题（剥组名括号/季词/EN 副标）后 layoutFor。保证「同一部剧分类一致」。 */
function layoutForTitle(rt: Runtime, title: string): { category: string; savePath: string; season: number; core: string } {
  const state = getState()
  // 显式季词优先级最高（先于订阅匹配判定冲突）
  const explicit = hasSeasonWord(title) ? seasonOf(title) : 0
  let best: Subscription | undefined
  let score = -1
  for (const s of state.subscriptions) {
    const cands = [s.nameCn, s.name, ...(s.aliases ?? [])].filter(Boolean) as string[]
    if (cands.some((c) => covers(title, c))) {
      // 命中的别名越长越可信
      const len = Math.max(...cands.map((c) => c.length))
      if (len > score) { score = len; best = s }
    }
  }
  if (best) {
    const season = explicit || best.season || 1
    return layoutFor(rt, { nameCn: best.nameCn || best.name, name: best.name, season, id: best.id })
  }
  const cleaned = stripEnSuffix(coreOf(title) || title).trim()
  const season = seasonOf(title)
  return layoutFor(rt, { nameCn: cleaned || title, name: undefined, season })
}

async function ensureCategory(rt: Runtime, category: string, savePath: string, logger: { warn: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  try {
    await rt.qb.createCategory(category, savePath || undefined)
  } catch (err) {
    logger.warn('bangumi createCategory fail %s: %s', category, err instanceof Error ? err.message : String(err))
  }
}
/**
 * 分层归位（S≥2 订阅落库后调用）：把同作品仍平铺在 番/作品 的 qB 任务
 * 按各自季号迁入 番/作品/第N季；作品尚无分层目录时任务留在平铺层。
 * 订阅行同步：同作品 S1 订阅若平铺且存在 S≥2（本作品已升级分层）→ 迁入 第一季。
 */
async function migrateFlatFirstSeason(rt: Runtime, core: string, logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  const root = (rt.cfg.qbCategoryRoot || '番').replace(/\/+$/, '')
  const base = (rt.cfg.qbBaseDir || '').replace(/\/+$/, '')
  const flatCat = root + '/' + core
  const flatPath = base + '/' + core
  const st = getState()
  // 是否有本作品 S≥2 订阅（有 → 作品已进入分层形态，S1 也归 第一季）
  const hasLaterSub = st.subscriptions.some((x) => coreNameOf(x) === core && (x.season ?? 1) >= 2)
  // 1) 订阅行：平铺在 番/作品 的 S1 → 若作品已分层则迁 第一季
  let changed = false
  if (hasLaterSub) {
    const layeredCat1 = flatCat + '/' + seasonLabel(1)
    const layeredPath1 = flatPath + '/' + seasonLabel(1)
    for (const s of st.subscriptions) {
      if (coreNameOf(s) !== core || (s.season ?? 1) !== 1) continue
      if (s.category === flatCat || !s.category) {
        s.category = layeredCat1
        s.savePath = s.savePath || layeredPath1
        changed = true
      }
    }
    if (changed) saveState(st)
  }
  // 2) qB 平铺任务按季归位：s≥2 的任务进 第s季；作品已分层时无季/1季任务也进 第一季
  try {
    const flatTasks = await rt.qb.torrents({ category: flatCat })
    const groups = new Map<string, string[]>()
    for (const t of flatTasks) {
      const s = parseEpisode(t.name).season ?? 0
      const wantLayer = s >= 2 || (hasLaterSub && (s === 0 || s === 1))
      if (!wantLayer) continue
      const target = flatCat + '/' + seasonLabel(s >= 2 ? s : 1)
      const arr = groups.get(target) ?? []
      arr.push(t.hash)
      groups.set(target, arr)
    }
    for (const [cat, hashes] of groups) {
      const seg = cat.split('/').pop() || ''
      try {
        await rt.qb.setTorrentCategory(hashes.join('|'), cat)
        if (base) await rt.qb.setTorrentSavePath(hashes.join('|'), base + '/' + core + '/' + seg)
        logger.info('bangumi layout migrate %s: %d task(s) -> %s', core, hashes.length, cat)
      } catch (err) {
        logger.warn('bangumi layout migrate qb fail %s -> %s: %s', core, cat, err instanceof Error ? err.message : String(err))
      }
    }
  } catch (err) {
    logger.warn('bangumi layout migrate qb list fail %s: %s', core, err instanceof Error ? err.message : String(err))
  }
}

/** 分类一致性巡检（核心名变更/核心名重复/结构升级后调用）：
 * 对每个订阅重算 layoutFor（核心名变短/季结构变化都可能改目标），需要变化时：
 *  ① ensureCategory 建目标分类+目录；② qB 侧本订阅 tag 任务迁到新分类/savePath；
 *  ③ 同 core 的平铺任务（含无 tag 的）经 migrateFlatFirstSeason 归位分层。
 * 任务迁移成功才覆写订阅行（失败保留旧值 → 下轮重试）。旧分类清空后删除。
 * S≥2 订阅无条件跑 migrate（行未变也要归位同 core 平铺任务）。
 */
async function syncCategoryLayout(rt: Runtime, logger: { warn: (fmt: string, ...a: unknown[]) => void; info: (fmt: string, ...a: unknown[]) => void }): Promise<void> {
  const state = getState()
  const base = (rt.cfg.qbBaseDir || '').replace(/\/+$/, '')
  dbg('sync-cat start subs=' + state.subscriptions.length)
  const stale: Array<{ category: string }> = []
  let changedRows = 0
  for (const s of [...state.subscriptions]) {
    const lay = layoutFor(rt, s)
    const needChange = lay.category !== s.category || (!!lay.savePath && lay.savePath !== s.savePath)
    dbg('sync-cat row ' + s.id + ' old=' + s.category + ' new=' + lay.category + ' need=' + needChange + ' season=' + lay.season + ' core=' + lay.core)
    let ok = true
    if (needChange) {
      await ensureCategory(rt, lay.category, lay.savePath, logger)
      try {
        const mine = await rt.qb.torrents({ tag: 'dsh-bangumi-sub-' + s.id })
        if (mine.length) {
          const hashes = mine.map((t) => t.hash).join('|')
          await rt.qb.setTorrentCategory(hashes, lay.category)
          if (base && lay.savePath) await rt.qb.setTorrentSavePath(hashes, lay.savePath)
        }
        stale.push({ category: s.category })
      } catch (err) {
        logger.warn('bangumi sync layout qb fail %s: %s', s.id, err instanceof Error ? err.message : String(err))
        dbg('sync-cat qb fail ' + s.id + ' ' + (err instanceof Error ? err.message : String(err)))
        ok = false
      }
      if (ok) {
        s.category = lay.category
        s.savePath = lay.savePath || s.savePath
        changedRows++
        dbg('sync-cat updated ' + s.id + ' -> ' + lay.category)
      }
    }
    // S≥2：同 core 平铺任务归位分层（无论本行是否变化）
    if (ok && lay.season >= 2) {
      try { await migrateFlatFirstSeason(rt, lay.core, logger) } catch { /* 归位失败下轮重试 */ }
    }
  }
  dbg('sync-cat loop-done changedRows=' + changedRows)
  if (changedRows) {
    try { saveState(state); dbg('sync-cat saveState ok') } catch (err) { dbg('sync-cat saveState ERR ' + (err instanceof Error ? err.message : String(err))) }
  }
  // 清理空分类（订阅已不引用、qB 无任务、非默认分类）
  let existing = new Set<string>()
  try {
    const all = await rt.qb.categories()
    existing = new Set(all.map((c) => c.category))
  } catch { existing = new Set() }
  const liveCats = new Set<string>()
  for (const s of getState().subscriptions) liveCats.add(s.category)
  let removed = 0
  for (const st of stale) {
    if (!st.category || st.category === rt.cfg.qbCategory || !existing.has(st.category)) continue
    if (liveCats.has(st.category)) continue
    try {
      const t = await rt.qb.torrents({ category: st.category })
      if (t.length) continue
      await rt.qb.deleteCategory(st.category)
      removed++
    } catch (err) {
      logger.warn('bangumi sync layout deleteCategory %s: %s', st.category, err instanceof Error ? err.message : String(err))
    }
  }
  if (removed || changedRows) {
    logger.info('bangumi category sync: %d row(s) updated, %d empty category(ies) removed', removed, changedRows)
    dbg('sync-cat done removed=' + removed + ' changed=' + changedRows)
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

// ---------- apply：REST / 工具 / 定时 ----------

import type { IncomingMessage, ServerResponse } from 'node:http'

type WebServerRegistration = { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }
type WebServerLike = { register: (entry: WebServerRegistration) => () => void }
type BangumiContext = Context & { webServer: WebServerLike; llm?: LlmStreamLike }


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

/** 宿主 LLM 目录：providers = 已注册路由；models = 指定 provider 的模型列表（失败返回空数组） */
async function llmModelCatalog(bctx: BangumiContext, provider: string): Promise<{ providers: Array<{ id: string; name: string }>; models: Array<{ id: string; name: string }>; loadingProvider: string }> {
  try {
    const llm = bctx.llm as (LlmStreamLike & { listProviders?: () => Array<{ id: string; name: string }>; listModels?: (p: string) => Promise<Array<{ id: string; name: string }>> }) | undefined
    const providers = (llm?.listProviders?.() ?? []).map((p) => ({ id: p.id, name: p.name || p.id }))
    let models: Array<{ id: string; name: string }> = []
    const target = provider || providers[0]?.id || ''
    if (llm?.listModels && target) {
      try { models = await llm.listModels(target) } catch { models = [] }
    }
    return { providers, models, loadingProvider: target }
  } catch {
    return { providers: [], models: [], loadingProvider: '' }
  }
}

interface Rt { cfg: Config; qb: QbClient; library: LibrarySnapshot | null; libraryScanning: boolean; resetCaches: boolean; ai: AiReviewer }

export function apply(ctx: Context, config: Config): void {
  const bctx = ctx as unknown as BangumiContext
  const logger = bctx.logger
  dbg('apply pid=' + process.pid + ' ts=' + Date.now() + ' ai=' + resolveConfig(config).aiProvider + '/' + resolveConfig(config).aiModel)
  const rt: Rt = {
    cfg: resolveConfig(config),
    qb: null as unknown as QbClient,
    library: null,
    libraryScanning: false,
    resetCaches: false,
    ai: null as unknown as AiReviewer,
  }
  rt.qb = new QbClient({ url: rt.cfg.qbUrl, username: rt.cfg.qbUsername, password: rt.cfg.qbPassword })
  const aiCfg = (): AiReviewConfig => ({ enabled: rt.cfg.aiEnabled, route: rt.cfg.aiProvider && rt.cfg.aiModel ? { provider: rt.cfg.aiProvider, model: rt.cfg.aiModel } : undefined })
  dbg('apply llm=' + (bctx.llm ? 'present' : 'MISSING') + ' ai=' + rt.cfg.aiEnabled + ' ' + rt.cfg.aiProvider + '/' + rt.cfg.aiModel)
  rt.ai = new AiReviewer(bctx.llm ?? (null as unknown as LlmStreamLike), aiCfg, (m) => { logger.warn('%s', m); dbg('ai-log ' + m) })

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
    if (rt.cfg.mediaDirs.length === 0) return { files: [], byTitle: {}, byDir: {}, scannedAt: meta.scannedAt, roots: [] }
    const needRescan =
      !meta.scannedAt ||
      meta.roots.length === 0 ||
      JSON.stringify(meta.roots.sort()) !== JSON.stringify([...rt.cfg.mediaDirs].sort())
    if (!needRescan) {
      const files = getDb().loadLibraryFiles()
      if (files.length || meta.scannedAt) {
        rt.library = { files, byTitle: buildByTitle(files), byDir: buildByDir(files, meta.roots), scannedAt: meta.scannedAt, roots: meta.roots }
        return rt.library
      }
    }
    return doLibraryScan()
  }

  const doLibraryScan = async (): Promise<LibrarySnapshot> => {
    if (rt.libraryScanning) return rt.library ?? { files: [], byTitle: {}, byDir: {}, scannedAt: 0, roots: [] }
    rt.libraryScanning = true
    try {
      // 扫描前的旧库行（用于 diff 新增；replaceLibrary 后旧数据不可再得）
      let prevByDir: Record<string, Record<number, unknown>> = {}
      try {
        const prevFiles = getDb().loadLibraryFiles()
        prevByDir = buildByDir(prevFiles, rt.cfg.mediaDirs)
      } catch { /* 首次扫描无旧数据 */ }
      const snap = await scanLibrary(rt.cfg.mediaDirs)
      rt.library = snap
      rt.resetCaches = false
      // 持久化快照 -> sqlite（启动时据此水合；root 标记用于下次扫描剔除消失目录）
      getDb().replaceLibrary(snap.files, snap.roots, snap.scannedAt)
      // 介入点3：媒体库更新后 AI 判断（新增文件/变化作品/订阅缺集；未配置跳过）
      if (rt.ai.enabled) {
        try {
          // 变化作品：dirKey 级集号 diff
          const changedWorks: Array<{ name: string; episodes: number[]; missing?: number[] }> = []
          for (const [key, eps] of Object.entries(snap.byDir)) {
            const prevEps = Object.keys(prevByDir[key] ?? {}).map(Number)
            const added = Object.keys(eps).map(Number).filter((n) => !prevEps.includes(n))
            if (added.length) changedWorks.push({ name: key, episodes: added.sort((a, b) => a - b) })
          }
          // 订阅已放送缺集（只为有变化的作品匹配的订阅拉 episodes，控制成本）
          const st0 = getState()
          const subscribedMissing: Array<{ name: string; missing: number[] }> = []
          if (changedWorks.length) {
            const today0 = new Date(); today0.setHours(0, 0, 0, 0)
            for (const sub of st0.subscriptions) {
              const have = findEpisodesInLibrary(snap, sub.aliases.length ? sub.aliases : [sub.query]).episodes
              const epsAll0 = await getEpisodesCached(sub.bangumiId).catch(() => [] as Array<{ ep: number; airDate?: string }>)
              const aired = epsAll0.filter((e) => e.airDate && new Date(e.airDate + 'T00:00:00').getTime() <= today0.getTime()).map((e) => e.ep)
              const missing = aired.filter((n) => !have.includes(n))
              if (missing.length) subscribedMissing.push({ name: sub.nameCn || sub.name, missing })
            }
          }
          const note = await rt.ai.reviewLibrary({
            addedFiles: Math.max(0, snap.files.length - Object.keys(prevByDir).reduce((a, k) => a + Object.keys(prevByDir[k]).length, 0)),
            changedWorks,
            subscribedMissing,
          })
          if (note) {
            logger.info('bangumi ai-library: %s', note.note)
            if (note.notifyMissing) {
              // AI 判定有订阅缺集需要补 → 立即触发一轮判新下载
              logger.info('bangumi ai-library notifyMissing → trigger poll')
              void pollSubscriptions(rt, logger).then((fr) => {
                if (fr.length) logger.info('bangumi ai-triggered poll downloaded %d', fr.length)
              }).catch((e) => logger.warn('bangumi ai-triggered poll fail: %s', e instanceof Error ? e.message : String(e)))
            }
          }
        } catch (err) {
          logger.warn('bangumi ai-library scan note fail: %s', err instanceof Error ? err.message : String(err))
        }
      }
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
            const wantModels = url.searchParams.get('models') === '1'
            const models = wantModels ? await llmModelCatalog(bctx, rt.cfg.aiProvider) : undefined
            return sendJson(res, 200, { settings: rt.cfg, file: FILE_CONFIG, models })
          }
          if (route === '/settings/models' && req.method === 'GET') {
            const provider = url.searchParams.get('provider') ?? ''
            return sendJson(res, 200, { models: await llmModelCatalog(bctx, provider) })
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
            }, logger)
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
          if (route === '/poll' && req.method === 'POST') {
            // 手动触发一轮判新轮询（与定时器同链路）：先刷新媒体库快照再 poll
            const snap = await getLibrary().catch(() => null)
            if (snap) rt.library = snap
            const fresh = await pollSubscriptions(rt, logger)
            return sendJson(res, 200, { at: Date.now(), fetched: fresh })
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
          if (route === '/dbg' && req.method === 'POST') {
            // 浏览器诊断回执：client 侧 DOM 扫描/点击事件实测数据（临时调试）
            const body = (await readBody(req)).slice(0, 8192)
            const { appendFileSync } = await import('node:fs')
            const { homedir } = await import('node:os')
            appendFileSync(homedir() + '/.dsh/dsh-bangumi-debug.log', new Date().toISOString() + ' ' + body + '\n')
            return sendJson(res, 200, { ok: true })
          }
          if (route === '/cover' && req.method === 'GET') {
            // 封面本地缓存优先（2026-09-05 用户需求「图片存 sqlite 本地调用」）：
            // cover_cache 命中且 URL 未变 → 直接回字节（零外网、断网可显）；miss 才走代理
            // 拉取并写库。lain.bgm.tv 浏览器直连超时，host fetch 走系统代理取图同源流回。
            const target = String(url.searchParams.get('u') ?? '')
            logger.info('bangumi cover req ua=%s u=%s', String(req.headers['user-agent'] ?? '').slice(0, 60), target.slice(0, 80))
            if (!/^https?:\/\//.test(target) || !/^(https?:\/\/(?:lain|mirror|bangumi)[^/]*\/)/.test(target)) {
              return sendJson(res, 400, { error: 'bad cover url' })
            }
            const sidm = /\/pic\/cover\/[a-z]\/[0-9a-f]{1,2}\/[0-9a-f]{1,2}\/(\d+)_/i.exec(target)
            const sid = sidm ? Number(sidm[1]) : 0
            // 命中本地缓存直接返回（sid=0 无法归属时不查库）
            if (sid) {
              const { getDb } = await import('./host/db.js')
              const hit = getDb().getSubjectCover(sid, target)
              if (hit) {
                res.writeHead(200, {
                  'content-type': hit.contentType,
                  'cache-control': 'public, max-age=86400',
                  'content-length': hit.bytes.length,
                })
                res.end(Buffer.from(hit.bytes))
                return
              }
            }
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), 15000)
            try {
              // 自愈（2026-09-05 实测定位）：subject 详情 7 天缓存里的封面 URL 带内容哈希
              // （…/pic/cover/l/xx/yy/<id>_<hash>.jpg），bgm.tv 一换封面旧 hash 即 404——缓存期内
              // 卡片永远裂图。这里遇 404 从 URL 反解 subjectId → 绕过缓存拉最新详情 → 用新 URL
              // 直接补发字节并回写缓存，卡片无感自愈。
              let effTarget = target
              let effSid = sid
              let preflight = await fetch(target, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 dsh-bangumi-cover' } })
              if (preflight.status === 404) {
                preflight.body?.cancel().catch(() => {})
                let freshUrl = ''
                try {
                  const { getSubject } = await import('./host/bangumi.js')
                  const { getDb } = await import('./host/db.js')
                  const fresh = effSid ? await getSubject(effSid).catch(() => null) : null
                  freshUrl = fresh?.images?.common ?? fresh?.images?.large ?? ''
                  if (fresh && effSid) {
                    try { getDb().setSubjectCache(effSid, fresh, fresh.aliases ?? []) } catch { /* noop */ }
                  }
                } catch { /* noop */ }
                logger.info('bangumi cover heal: old=404 sid=%d new=%s', effSid, freshUrl ? freshUrl.slice(-60) : '(none)')
                if (freshUrl && freshUrl !== target && /^(https?:\/\/(?:lain|mirror|bangumi)[^/]*\/)/.test(freshUrl)) {
                  effTarget = freshUrl
                  effSid = Number((/\/(\d+)_/.exec(freshUrl) ?? [])[1] ?? 0) || effSid
                  preflight = await fetch(freshUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 dsh-bangumi-cover' } })
                }
              }
              const up = preflight
              if (!up.ok) throw new Error('upstream ' + up.status + ' ' + effTarget.slice(-60))
              const buf = Buffer.from(await up.arrayBuffer())
              // 成功拉到 → 落库（>1MB 不落，防库膨胀；正常封面 30-80KB）
              if (effSid && buf.length <= 1_048_576) {
                try {
                  const { getDb } = await import('./host/db.js')
                  getDb().putSubjectCover(effSid, effTarget, new Uint8Array(buf), up.headers.get('content-type') || 'image/jpeg')
                } catch { /* 落库失败不影响出图 */ }
              }
              res.writeHead(200, {
                'content-type': up.headers.get('content-type') || 'image/jpeg',
                'cache-control': 'public, max-age=86400',
                'content-length': buf.length,
              })
              res.end(buf)
            } catch (err) {
              sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) })
            } finally {
              clearTimeout(timer)
            }
            return
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
            let cat = rt.cfg.qbCategory
            let sp = rt.cfg.qbSavePath
            let bgmId: number | undefined
            let dtitle = String(body.title ?? '')
            // 带 bangumiId 或能从标题识别作品 → 走番剧布局（番/作品[/第N季]）
            const subId = body.subscriptionId ? String(body.subscriptionId) : ''
            const subRow = subId ? getState().subscriptions.find((s) => s.id === subId) : undefined
            if (subRow) {
              bgmId = subRow.bangumiId
              dtitle = subRow.nameCn || subRow.name || dtitle
              const lay = layoutFor(rt, subRow)
              cat = lay.category; sp = lay.savePath || rt.cfg.qbSavePath
            } else if (body.bangumiId) {
              const n = Number(body.bangumiId)
              if (Number.isInteger(n)) {
                try {
                  const { subject } = await subjectBundle(n)
                  bgmId = n
                  dtitle = subject.nameCn || subject.name || dtitle
                  const season = seasonOf((subject.nameCn || '') + ' ' + (subject.name || ''))
                  const lay = layoutFor(rt, { nameCn: subject.nameCn, name: subject.name, season })
                  cat = lay.category; sp = lay.savePath || rt.cfg.qbSavePath
                } catch { /* 元数据拿不到：退回默认分类 */ }
              }
            } else if (dtitle) {
              const lay = layoutForTitle(rt, dtitle)
              cat = lay.category; sp = lay.savePath || rt.cfg.qbSavePath
            }
            // 确保目标分类与磁盘目录存在（title-only 清洗后可能产生全新分类）
            if (cat !== rt.cfg.qbCategory) await ensureCategory(rt, cat, sp, logger)
            // 介入点2：REST 手动下载也走 AI 审核（有番剧归属时；未配置/失败放行）
            if (bgmId || dtitle) {
              let libEps: number[] = []
              try {
                const snap = await getLibrary()
                if (snap) {
                  const found = findEpisodesInLibrary(snap, subRow?.aliases ?? [dtitle])
                  libEps = found.episodes
                }
              } catch { /* 忽略 */ }
              const gated = await aiApproveDownload(rt, {
                subName: dtitle || '未知名',
                bangumiId: bgmId,
                full: true,
                title: String(body.title ?? dtitle),
                magnet: String(body.magnet),
                score: 0,
                haveEpisodes: libEps,
              }, logger)
              if (!gated.ok) return sendJson(res, 403, { ok: false, error: 'AI 审核未通过（详情见日志）' })
            }
            await rt.qb.addMagnet(String(body.magnet), { savePath: sp || undefined, category: cat, tags: rt.cfg.qbTags })
            const dlState = getState()
            dlState.downloads.push({ magnet: String(body.magnet), title: dtitle, bangumiId: bgmId, origin: 'qb', at: Date.now() })
            saveState(dlState)
            return sendJson(res, 200, { ok: true, category: cat, savePath: sp })
          }
          if (route === '/library/posters' && req.method === 'GET') {
            // 海报墙：媒体库文件按「作品目录」聚合（本地目录结构 = 作品分界，天然把 S01/S02 并卡），
            // 每个目录匹配到订阅/已缓存 bgm 条目拿封面；未命中给本地目录名灰卡。
            const snap = await getLibrary()
            const files = snap?.files ?? []
            // 作品分组：取「任一媒体根之后的第一个路径段」为作品键（Downloads 顶层散文件无作品段→排除）
            const works = new Map<string, { key: string; dir: string; episodes: number[]; names: string[] }>()
            const mediaRoots = rt.cfg.mediaDirs.map((p) => p.replace(/[\/]+$/, ''))
            const workKeyOf = (p: string): string | undefined => {
              const norm = p.replace(/\\/g, '/')
              for (const root of mediaRoots) {
                const prefix = root.replace(/\\/g, '/') + '/'
                if (!norm.startsWith(prefix)) continue
                const rest = norm.slice(prefix.length)
                const seg = rest.split('/').filter(Boolean)[0]
                if (seg) return seg
              }
              return undefined
            }
            for (const f of files) {
              if (f.parsed.episode === undefined) continue
              const key = workKeyOf(f.path)
              if (!key) continue
              let g = works.get(key)
              if (!g) { g = { key, dir: f.dir, episodes: [], names: [] }; works.set(key, g) }
              g.episodes.push(f.parsed.episode)
              if (g.names.length < 3 && !g.names.includes(f.name)) g.names.push(f.name)
            }
            // 候选池：订阅（含别名）+ 全部 subject_cache（含过期的，老条目也能当封面）。
            // ⚠️ 2026-09-05 修复：订阅行本身不带 images——已订阅作品必须回查 subject_cache
            // 补封面（根因：尼古喵喵海报 cover 空）。缓存条目先全量建索引再装配候选。
            const state = getState()
            const subByBgmId = new Map<number, Subscription>()
            const cachedById = new Map<number, PosterCandidate>()
            for (const c of getDb().listSubjectCacheAll()) {
              cachedById.set(c.id, {
                id: c.id,
                aliases: c.aliases.length ? c.aliases : [c.subject.name, c.subject.nameCn].filter(Boolean),
                name: c.subject.name,
                nameCn: c.subject.nameCn,
                airDate: c.subject.airDate,
                totalEpisodes: c.subject.totalEpisodes,
                images: c.subject.images,
                platform: c.subject.platform,
                summary: c.subject.summary,
              })
            }
            const cands: PosterCandidate[] = []
            for (const sub of state.subscriptions) {
              subByBgmId.set(sub.bangumiId, sub)
              const cc = cachedById.get(sub.bangumiId)
              cands.push({
                id: sub.bangumiId,
                aliases: sub.aliases.length ? sub.aliases : [sub.name, sub.nameCn].filter(Boolean),
                name: sub.name,
                nameCn: sub.nameCn,
                airDate: sub.airDate,
                totalEpisodes: sub.totalEpisodes,
                images: cc?.images,
                platform: cc?.platform,
                summary: cc?.summary,
              })
            }
            for (const [cid, cc] of cachedById) {
              if (!subByBgmId.has(cid)) cands.push(cc)
            }
            const posters: Array<{
              key: string
              displayName: string            // 作品目录名
              episodes: number[]             // 本地集号（升序去重）
              id?: number                    // 命中 bgm 条目 id
              name?: string; nameCn?: string
              airDate?: string; totalEpisodes?: number; platform?: string; summary?: string
              aired?: number                // 已放送集数（episodes 表 airdate ≤ 今日；缺失=未知）
              cover?: string                 // /api/bangumi/cover?u=...（client 直用）
              subscribed?: boolean
              subscriptionId?: string
              source?: string
            }> = []
            for (const g of works.values()) {
              const displayName = g.key
              const episodes = [...new Set(g.episodes)].sort((a, b) => a - b)
              // 匹配键：目录名优先，取不到可读标题时用抽样文件解析出的 title
              let matchKey = displayName
              for (const n of g.names) {
                const t = parseEpisode(n).title
                if (t && t.length > 1 && t !== displayName) { matchKey = t; break }
              }
              const best = findBestCandidate(normalizeTitle(matchKey), cands)
              if (!best) {
                // 未命中缓存：用目录名/可读标题做一次 bgm 搜索反查（拿搜索结果里中文名/原名与 key 精确一致者）；
                // 命中则深拉 getSubjectCached 回填 subject_cache（后续打开零网络）。失败静默降级灰卡。
                let looked: PosterCandidate | undefined
                try {
                  const hits = await searchSubjects(matchKey.length > 1 ? matchKey : displayName, 6)
                  const exact = hits.find((s) => (s.nameCn && normalizeTitle(s.nameCn) === normalizeTitle(matchKey)) || (s.name && normalizeTitle(s.name) === normalizeTitle(matchKey)))
                  const chosen = exact ?? hits[0]
                  if (chosen) {
                    const fresh = await getSubjectCached(chosen.id)
                    looked = {
                      id: fresh.subject.id,
                      aliases: fresh.aliases,
                      name: fresh.subject.name,
                      nameCn: fresh.subject.nameCn,
                      airDate: fresh.subject.airDate,
                      totalEpisodes: fresh.subject.totalEpisodes,
                      images: fresh.subject.images,
                      platform: fresh.subject.platform,
                      summary: fresh.subject.summary,
                    }
                    cands.push(looked)
                  }
                } catch {
                  /* 网络失败：保持灰卡 */
                }
                if (!looked) {
                  posters.push({ key: g.key, displayName, episodes })
                  continue
                }
                const rim = looked.images?.common ?? looked.images?.large
                posters.push({
                  key: g.key,
                  displayName,
                  episodes,
                  id: looked.id,
                  name: looked.name,
                  nameCn: looked.nameCn,
                  airDate: looked.airDate,
                  totalEpisodes: looked.totalEpisodes,
                  platform: looked.platform,
                  summary: looked.summary,
                  cover: rim ? '/api/bangumi/cover?u=' + encodeURIComponent(rim) : undefined,
                  subscribed: subByBgmId.has(looked.id),
                  subscriptionId: subByBgmId.get(looked.id)?.id,
                  source: subByBgmId.get(looked.id)?.source,
                })
                continue
              }
              const img = best.images?.common ?? best.images?.large
              posters.push({
                key: g.key,
                displayName,
                episodes,
                id: best.id,
                name: best.name,
                nameCn: best.nameCn,
                airDate: best.airDate,
                totalEpisodes: best.totalEpisodes,
                platform: best.platform,
                summary: best.summary,
                cover: img ? '/api/bangumi/cover?u=' + encodeURIComponent(img) : undefined,
                subscribed: subByBgmId.has(best.id),
                subscriptionId: subByBgmId.get(best.id)?.id,
                source: subByBgmId.get(best.id)?.source,
              })
            }
            // 已放送集数：episodes 表 airdate ≤ 今日（episodes_cache 6h；与 /lookup 同口径）。
            // 并发拉取不阻塞主流程太久——4~5 部作品一次 Promise.all。缺失静默保持 undefined。
            const todayE = new Date().toISOString().slice(0, 10)
            await Promise.all(posters.map(async (p) => {
              if (p.id === undefined) return
              try {
                const eps = await getEpisodesCached(p.id)
                if (!eps.length) return
                const dated = eps.filter((e) => e.airDate && e.airDate <= todayE)
                if (dated.length) p.aired = dated.length
                // totalEpisodes 缺失/为 0 时用 episodes 表条数兜底（bgm 搜索响应常标 0）
                if (p.totalEpisodes === undefined || p.totalEpisodes <= 0) p.totalEpisodes = eps.length
              } catch { /* 网络/缓存失败：aired 保持未知 */ }
            }))
            posters.sort((a, b) => (a.nameCn || a.displayName).localeCompare(b.nameCn || b.displayName, 'zh-Hans-CN'))
            return sendJson(res, 200, {
              scannedAt: snap?.scannedAt ?? 0,
              scanning: rt.libraryScanning,
              count: posters.length,
              posters,
            })
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
            // ⚠️ 2026-09-05 修复：弃用「(日期-首播)/7+1」周推算——首日多集连播（穹庐/无职 EP1+2 同 7/4）会让
            // 整季滞后一集（9/5 真 EP11 被算成 EP10）。改铺 episodes 表真实 airDate（bgm 权威放送日）。
            const year = Number(url.searchParams.get('year')) || new Date().getFullYear()
            const month = Number(url.searchParams.get('month')) || new Date().getMonth() + 1
            const state = getState()
            const days = new Date(year, month, 0).getDate()
            const calendar: Array<{ date: string; items: Array<{ name: string; nameCn: string; episode: number | null }> }> = []
            // 每订阅一次性拉 episodes 表 → date→ep 映射（缓存 6h；失败回退估算）
            const perSubEps: Array<{ sub: (typeof state.subscriptions)[number]; map: Map<string, number> }> = []
            for (const sub of state.subscriptions) {
              let map = new Map<string, number>()
              try {
                const eps = await getEpisodesCached(sub.bangumiId).catch(() => [] as Array<{ ep: number; airDate?: string }>)
                for (const e of eps) if (e.airDate) map.set(e.airDate, e.ep)
              } catch { /* keep empty */ }
              perSubEps.push({ sub, map })
            }
            for (let d = 1; d <= days; d += 1) {
              const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0')
              const items: Array<{ name: string; nameCn: string; episode: number | null }> = []
              for (const { sub, map } of perSubEps) {
                let ep: number | null = null
                const known = map.get(iso)
                if (known !== undefined) {
                  ep = known
                } else if (map.size > 0 && sub.airDate) {
                  // 无精确 airdate 的日期不铺点（避免周末错位猜集号）
                  continue
                } else {
                  // episodes 拉不到（异常）→ 兜底原周推算
                  const date = new Date(year, month - 1, d)
                  if (sub.weekday !== undefined && date.getDay() === sub.weekday && sub.airDate) {
                    const first = new Date(sub.airDate + 'T00:00:00')
                    const est = date >= first ? Math.floor((date.getTime() - first.getTime()) / (7 * 86400_000)) + 1 : null
                    if (est !== null && (sub.totalEpisodes === undefined || est <= sub.totalEpisodes)) ep = est
                  }
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
            // 已放送：episodes 表 airdate ≤ 今日（6h 缓存）
            let aired: number | undefined
            let epsTotal = 0
            try {
              const eps = await getEpisodesCached(subject.id)
              epsTotal = eps.length
              const today = new Date().toISOString().slice(0, 10)
              const dated = eps.filter((e) => e.airDate && e.airDate <= today)
              if (dated.length) aired = dated.length
            } catch { /* aired 未知 */ }
            const total = subject.totalEpisodes ?? (epsTotal > 0 ? epsTotal : undefined)
            return sendJson(res, 200, {
              subject: bundle.subject,
              aliases: bundle.aliases,
              localEpisodes: lib.episodes,
              progress: {
                libraryCount: lib.count,
                downloaded: lib.count,
                total,
                aired,
                missing: total
                  ? Array.from({ length: total }, (_v, i) => i + 1).filter((n) => !lib.episodes.includes(n))
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
      description: '查一部番的完整资料卡（唯一返回）：自动收敛到最匹配的一部，含封面/平台/简介/总集数/已放送/本地已下载集数/缺集/订阅状态。返回的字符串是可直接渲染的 HTML 信息卡——把整个返回值原样抄进回复正文即可（不要改写、不要转义、不要去掉 HTML 标签），优先用这个而非 bangumi_search',
      parameters: {
        keyword: { type: 'string', required: true, description: '番名关键词（中日文皆可）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { keyword: string }) {
        const hit = await lookupSubject(args.keyword)
        if (!hit) return '未找到匹配的番剧: ' + args.keyword
        const bundle = await subjectBundle(hit.id)
        // 详情响应才带权威 total_episodes（搜索响应常缺失）；以 bundle.subject 为准
        const subject = bundle.subject
        const libSnap = await getLibrary()
        const lib = libSnap ? findEpisodesInLibrary(libSnap, bundle.aliases) : { episodes: [] as number[], count: 0 }
        const state = getState()
        const sub = state.subscriptions.find((x) => x.bangumiId === hit.id)
        // 已放送集数 = episodes 表有 airdate 且 ≤ 今日的主篇（6h 缓存；失败视为未知）
        let aired: number | undefined
        let epsTotal = 0
        try {
          const eps = await getEpisodesCached(hit.id)
          epsTotal = eps.length
          const today = new Date().toISOString().slice(0, 10)
          const dated = eps.filter((e) => e.airDate && e.airDate <= today)
          if (dated.length) aired = dated.length
        } catch { /* 网络/缓存失败：aired 保持未知 */ }
        let total = subject.totalEpisodes
        // total_episodes=0/缺省时以 episodes 表条数兜底（bgm 本篇常标 0 或特典混计）
        if (total === undefined && epsTotal > 0) total = epsTotal
        const missing = total
          ? Array.from({ length: total }, (_v, i) => i + 1).filter((n) => !lib.episodes.includes(n))
          : []
        return subjectCardHtml(subject, {
          localEpisodes: lib.episodes,
          total,
          downloaded: lib.count,
          missing,
          aired,
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
      description: '订阅番剧（nyaa/dmhy，默认 dmhy）：插件自动判新下载到 qBittorrent——已完结番优先一次拿全集资源，连载番只补最新缺集并持续轮询新集；自动套用保存目录/分类/标签',
      parameters: {
        bangumiId: { type: 'number', required: true, description: 'Bangumi 条目 ID（先用 bangumi_search 查）' },
        source: { type: 'string', description: 'rss 源：dmhy（默认）或 nyaa（不传默认 dmhy）' },
        group: { type: 'string', description: '限定发布组（可选）' },
        resolution: { type: 'string', description: '如 1080p（可选）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { bangumiId: number; source?: string; group?: string; resolution?: string }) {
        const sub = await subscribeBangumi(rt, args.bangumiId, { source: args.source === 'nyaa' ? 'nyaa' : 'dmhy', group: args.group, resolution: args.resolution }, logger)
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
        categoryRoot: { type: 'string', description: '番剧分类根（如「番」），番剧按 根/作品[/第N季] 归类' },
        baseDir: { type: 'string', description: '番剧保存根目录（如 /Volumes/一块硬盘/电影/番）' },
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
        if (args.categoryRoot) cur.qbCategoryRoot = args.categoryRoot
        if (args.baseDir) cur.qbBaseDir = args.baseDir
        if (args.tags) cur.qbTags = args.tags
        md(dirname(FILE_CONFIG), { recursive: true })
        wf(FILE_CONFIG, JSON.stringify(cur, null, 2), 'utf8')
        reloadRuntime()
        return '已保存并生效：qbUrl=' + rt.cfg.qbUrl + ' category=' + rt.cfg.qbCategory + ' root=' + rt.cfg.qbCategoryRoot + ' baseDir=' + (rt.cfg.qbBaseDir || '(未设)') + ' savePath=' + (rt.cfg.qbSavePath || '(qB 默认)')
      },
    })),

    ctx.tools.register(defineTool({
      name: 'qb_add_torrent',
      description: '手动加一个磁链到 qBittorrent（自动套用保存目录/分类/标签；可选 bangumiId 或 title 走番剧分类布局）',
      parameters: {
        magnet: { type: 'string', required: true, description: 'magnet:?xt=... 链接' },
        bangumiId: { type: 'number', description: '番剧 Bangumi ID（可选）：按 番/作品[/第N季] 归类' },
        title: { type: 'string', description: '作品名（可选，无 bangumiId 时按此归类）' },
      },
      output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => text(v) },
      async execute(args: { magnet: string; bangumiId?: number; title?: string }) {
        let cat = rt.cfg.qbCategory
        let sp = rt.cfg.qbSavePath
        let dtitle = args.title ?? ''
        if (args.bangumiId) {
          try {
            const { subject } = await subjectBundle(args.bangumiId)
            dtitle = subject.nameCn || subject.name || ''
            const season = seasonOf((subject.nameCn || '') + ' ' + (subject.name || ''))
            const lay = layoutFor(rt, { nameCn: subject.nameCn, name: subject.name, season })
            cat = lay.category; sp = lay.savePath || rt.cfg.qbSavePath
          } catch { /* 元数据失败：退回默认 */ }
        } else if (dtitle) {
          const lay = layoutForTitle(rt, dtitle)
          cat = lay.category; sp = lay.savePath || rt.cfg.qbSavePath
        }
        // 确保目标分类与磁盘目录存在
        if (cat !== rt.cfg.qbCategory) await ensureCategory(rt, cat, sp, logger)
        // 介入点2：手动加磁链也走 AI 审核（有番剧归属时；未配置/失败放行）
        if (args.bangumiId || dtitle) {
          let libEps: number[] = []
          try {
            const snap = await getLibrary()
            if (snap && dtitle) {
              const found = findEpisodesInLibrary(snap, [dtitle])
              libEps = found.episodes
            }
          } catch { /* 忽略 */ }
          const gated = await aiApproveDownload(rt, {
            subName: dtitle || '未知名',
            bangumiId: args.bangumiId,
            full: true,
            title: args.title ?? args.magnet.slice(0, 40),
            magnet: args.magnet,
            score: 0,
            haveEpisodes: libEps,
          }, logger)
          if (!gated.ok) return 'AI 审核未通过，已取消下载（详情见日志）。'
        }
        await rt.qb.addMagnet(args.magnet, { savePath: sp || undefined, category: cat, tags: rt.cfg.qbTags })
        const state = getState()
        state.downloads.push({ magnet: args.magnet, title: dtitle || args.magnet.slice(0, 40), origin: 'qb', at: Date.now() })
        saveState(state)
        return '已添加下载：分类 ' + cat + (sp ? '，目录 ' + sp : '')
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
          // 分类一致性巡检：核心名变更后把订阅/qB 任务迁到短名分类（幂等；失败留待下轮）
          dbg('sync-cat invoke from tick')
          try { await syncCategoryLayout(rt, logger) } catch (err) {
            logger.warn('bangumi category sync fail: %s', err instanceof Error ? err.message : String(err))
            dbg('sync-cat ERROR ' + (err instanceof Error ? err.message : String(err)))
          }
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