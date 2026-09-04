/**
 * @dsh-external/dsh-bangumi — 状态仓库（SQLite 之上的一层内存镜像）。
 * 对外保持 getState()/saveState() 原 API；底层数据在 ~/.dsh/dsh-bangumi/bangumi.db。
 * 跨 fiber 一致性：每次 getState 比对 PRAGMA data_version，他人写入自动重载。
 */
import { getDb } from './db.js'

export interface Subscription {
  id: string            // sub-<bangumiId>-<ts36>
  bangumiId: number
  name: string
  nameCn: string
  aliases: string[]
  totalEpisodes?: number
  /** 订阅季号（由订阅时番名推断；1=第一季） */
  season?: number
  airDate?: string      // first air date YYYY-MM-DD
  weekday?: number      // 0=日 ... 6=六（本地历）
  source: 'nyaa' | 'dmhy'
  group?: string
  resolution?: string
  query: string
  rssRuleName: string
  feedUrl: string
  rssItemPath?: string
  savePath: string
  category: string
  tags: string
  seenEpisodes: number[]
  /** 上次轮询 feed 时刻 ms（判新游标：只收游标后的文章，防订阅即拉历史全集） */
  lastCheckAt: number
  /** 最后判新下载的集发布时间 ms（无新集则不动作） */
  lastEpisodeAt?: number
  /** 完结态缓存：airing（连载中，episodes 端点有未来日期）/ finished（已完结）/ unknown */
  status: 'airing' | 'finished' | 'unknown'
  /** 本地齐集自动停订阅时间戳（此后不再判新下载） */
  completedAt?: number
  createdAt: number
}

export interface DownloadRecord {
  magnet: string
  hash?: string
  title: string
  bangumiId?: number
  episode?: number
  group?: string
  resolution?: string
  origin: 'qb' | 'rss'
  /** 是否整包下载（全集/合集/区间包） */
  full?: boolean
  /** 整包区间（起止集号，下载全集时记录用于防重复） */
  rangeFrom?: number
  rangeTo?: number
  at: number
}

export interface BangumiState {
  subscriptions: Subscription[]
  downloads: DownloadRecord[]
}

let mem: BangumiState | null = null
let lastVersion = -1

/** 返回当前状态（他人写入自动重载，本 fiber 改动优先于未落库镜像） */
export function getState(): BangumiState {
  const db = getDb()
  const ver = db.dataVersion()
  if (!mem || ver !== lastVersion) {
    mem = { subscriptions: db.listSubscriptions(), downloads: db.listDownloads() }
    lastVersion = ver
  }
  return mem
}

/** 把内存状态全量落库（内部事务），并刷新版本基准 */
export function saveState(state: BangumiState): void {
  const db = getDb()
  db.replaceAll(state)
  mem = state
  lastVersion = db.dataVersion()
}

export { DB_DIR, DB_PATH } from './db.js'