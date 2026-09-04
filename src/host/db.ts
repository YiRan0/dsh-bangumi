/**
 * @dsh-external/dsh-bangumi — SQLite 持久化层（node:sqlite，Node >= 22.5）。
 * 表：subscriptions / downloads / library_files / library_meta / subject_cache / episodes_cache。
 * 取代 state.json：首启自动一次性迁移并备份为 state.json.bak-v1。
 * 热重载多 fiber：WAL + busy_timeout + 每连接独立句柄，天然免锁。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { Subscription, DownloadRecord } from './store.js'
import type { BangumiSubject, BangumiEpisode } from './bangumi.js'
import type { LibraryFile } from './library.js'

export const DB_DIR = join(homedir(), '.dsh', 'dsh-bangumi')
export const DB_PATH = join(DB_DIR, 'bangumi.db')
const LEGACY_PATH = join(DB_DIR, 'state.json')

/** 缓存有效期：bgm 主体信息 7 天；放送列表 6 小时（连载番每周变化） */
const SUBJECT_TTL_MS = 7 * 86400_000
const EPISODES_TTL_MS = 6 * 3600_000

const SUB_SCHEMA = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  bangumi_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_cn TEXT,
  aliases TEXT NOT NULL,
  total_episodes INTEGER,
  season INTEGER,
  air_date TEXT,
  weekday INTEGER,
  source TEXT NOT NULL,
  group_name TEXT,
  resolution TEXT,
  query TEXT,
  rss_rule_name TEXT,
  feed_url TEXT,
  rss_item_path TEXT,
  save_path TEXT,
  category TEXT,
  tags TEXT,
  seen_episodes TEXT NOT NULL,
  last_check_at INTEGER NOT NULL DEFAULT 0,
  last_episode_at INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown',
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);`
const DL_SCHEMA = `
CREATE TABLE IF NOT EXISTS downloads (
  magnet TEXT PRIMARY KEY,
  hash TEXT,
  title TEXT,
  bangumi_id INTEGER,
  episode INTEGER,
  group_name TEXT,
  resolution TEXT,
  origin TEXT,
  full INTEGER,
  range_from INTEGER,
  range_to INTEGER,
  at INTEGER
);`
const LIB_SCHEMA = `
CREATE TABLE IF NOT EXISTS library_files (
  path TEXT PRIMARY KEY,
  root TEXT,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  norm_title TEXT NOT NULL,
  parsed_episode REAL,
  parsed_group TEXT,
  parsed_resolution TEXT,
  parsed_title TEXT,
  parsed_season INTEGER
);
CREATE TABLE IF NOT EXISTS library_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);`
const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS subject_cache (
  id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes_cache (
  subject_id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cover_cache (
  subject_id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  bytes BLOB NOT NULL,
  content_type TEXT,
  saved_at INTEGER NOT NULL
);`

type Row = Record<string, any>

class BangumiDb {
  private db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA busy_timeout = 8000;')
    for (const s of [SUB_SCHEMA, DL_SCHEMA, LIB_SCHEMA, CACHE_SCHEMA]) this.db.exec(s)
    // 已有库（旧 schema 无游标列）就地补列
    for (const c of ['last_check_at', 'last_episode_at', 'status']) {
      try { this.db.exec('ALTER TABLE subscriptions ADD COLUMN ' + c + ' ' + (c === 'last_check_at' ? 'INTEGER NOT NULL DEFAULT 0' : c === 'status' ? 'TEXT NOT NULL DEFAULT \'unknown\'' : 'INTEGER')) } catch { /* 已存在 */ }
    }
    try { this.db.exec("ALTER TABLE downloads ADD COLUMN full INTEGER") } catch { /* 已存在 */ }
    try { this.db.exec("ALTER TABLE downloads ADD COLUMN range_from INTEGER") } catch { /* 已存在 */ }
    try { this.db.exec("ALTER TABLE downloads ADD COLUMN range_to INTEGER") } catch { /* 已存在 */ }
    try { this.db.exec('ALTER TABLE subscriptions ADD COLUMN completed_at INTEGER') } catch { /* 已存在 */ }
    try { this.db.exec('ALTER TABLE subscriptions ADD COLUMN season INTEGER') } catch { /* 已存在 */ }
  }

  // ---------- 订阅 ----------
  listSubscriptions(): Subscription[] {
    const rows = this.db.prepare('SELECT * FROM subscriptions ORDER BY created_at').all() as Row[]
    return rows.map(rowToSub)
  }
  insertSubscription(sub: Subscription): void {
    const st = this.db.prepare(`INSERT OR REPLACE INTO subscriptions
      (id,bangumi_id,name,name_cn,aliases,total_episodes,season,air_date,weekday,source,group_name,resolution,query,rss_rule_name,feed_url,rss_item_path,save_path,category,tags,seen_episodes,last_check_at,last_episode_at,status,completed_at,created_at)
      VALUES (@id,@bangumi_id,@name,@name_cn,@aliases,@total_episodes,@season,@air_date,@weekday,@source,@group_name,@resolution,@query,@rss_rule_name,@feed_url,@rss_item_path,@save_path,@category,@tags,@seen_episodes,@last_check_at,@last_episode_at,@status,@completed_at,@created_at)`)
    st.run(subToRow(sub))
  }
  updateSubscription(id: string, patch: Partial<Subscription>): void {
    const cur = this.getSubscription(id)
    if (!cur) return
    this.insertSubscription({ ...cur, ...patch, id })
  }
  getSubscription(id: string): Subscription | undefined {
    const row = this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as Row | undefined
    return row ? rowToSub(row) : undefined
  }
  removeSubscription(id: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
  }

  // ---------- 下载记录 ----------
  addDownload(rec: DownloadRecord): void {
    const st = this.db.prepare(`INSERT OR IGNORE INTO downloads (magnet,hash,title,bangumi_id,episode,group_name,resolution,origin,full,range_from,range_to,at) VALUES (@magnet,@hash,@title,@bangumi_id,@episode,@group_name,@resolution,@origin,@full,@range_from,@range_to,@at)`)
    st.run({
      magnet: rec.magnet, hash: rec.hash ?? null, title: rec.title ?? null,
      bangumi_id: rec.bangumiId ?? null, episode: rec.episode ?? null,
      group_name: rec.group ?? null, resolution: rec.resolution ?? null,
      origin: rec.origin, full: rec.full ? 1 : null,
      range_from: rec.rangeFrom ?? null, range_to: rec.rangeTo ?? null, at: rec.at,
    })
  }
  listDownloads(): DownloadRecord[] {
    const rows = this.db.prepare('SELECT * FROM downloads ORDER BY at DESC').all() as Row[]
    return rows.map((r) => ({
      magnet: r.magnet, hash: r.hash ?? undefined, title: r.title ?? '',
      bangumiId: r.bangumi_id ?? undefined, episode: r.episode ?? undefined,
      group: r.group_name ?? undefined, resolution: r.resolution ?? undefined,
      origin: r.origin, full: !!r.full,
      rangeFrom: r.range_from ?? undefined, rangeTo: r.range_to ?? undefined, at: r.at,
    }))
  }

  // ---------- 媒体库快照（整表替换式持久化；内存 snapshot 仍由 host 持有） ----------
  replaceLibrary(files: LibraryFile[], roots: string[], scannedAt: number): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM library_files')
      const st = this.db.prepare(`INSERT OR REPLACE INTO library_files (path,root,size,mtime_ms,norm_title,parsed_episode,parsed_group,parsed_resolution,parsed_title,parsed_season) VALUES (@path,@root,@size,@mtime_ms,@norm_title,@parsed_episode,@parsed_group,@parsed_resolution,@parsed_title,@parsed_season)`)
      for (const f of files) {
        st.run({
          path: f.path, root: f.root ?? null, size: f.size, mtime_ms: f.mtimeMs,
          norm_title: f.normTitle, parsed_episode: f.parsed.episode ?? null,
          parsed_group: f.parsed.group ?? null, parsed_resolution: f.parsed.resolution ?? null,
          parsed_title: f.parsed.title ?? null, parsed_season: f.parsed.season ?? null,
        })
      }
      this.setMeta('scannedAt', String(scannedAt))
      this.setMeta('roots', JSON.stringify(roots))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  loadLibraryFiles(): LibraryFile[] {
    const rows = this.db.prepare('SELECT * FROM library_files').all() as Row[]
    return rows.map((r) => ({
      path: r.path, dir: dirname(r.path), name: basename2(r.path),
      size: r.size, mtimeMs: r.mtime_ms, normTitle: r.norm_title,
      root: r.root ?? undefined,
      parsed: {
        episode: r.parsed_episode ?? undefined,
        group: r.parsed_group ?? undefined,
        resolution: r.parsed_resolution ?? undefined,
        title: r.parsed_title ?? undefined,
        season: r.parsed_season ?? undefined,
      },
    }))
  }
  getLibraryMeta(): { scannedAt: number; roots: string[] } {
    const at = Number(this.getMeta('scannedAt') ?? 0)
    let roots: string[] = []
    try { roots = JSON.parse(this.getMeta('roots') ?? '[]') } catch { /* 默认空 */ }
    return { scannedAt: at, roots: Array.isArray(roots) ? roots : [] }
  }

  // ---------- bgm 元数据缓存 ----------
  getSubjectCache(id: number): { subject: BangumiSubject; aliases: string[]; savedAt: number } | null {
    const row = this.db.prepare('SELECT payload, saved_at FROM subject_cache WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    if (Date.now() - Number(row.saved_at) > SUBJECT_TTL_MS) return null
    try {
      const p = JSON.parse(row.payload)
      return { subject: p.subject, aliases: p.aliases ?? [], savedAt: Number(row.saved_at) }
    } catch { return null }
  }
  setSubjectCache(id: number, subject: BangumiSubject, aliases: string[]): void {
    this.db.prepare('INSERT OR REPLACE INTO subject_cache (id,payload,saved_at) VALUES (?,?,?)').run(id, JSON.stringify({ subject, aliases }), Date.now())
  }
  /** 枚举全部缓存条目（含过期）——海报墙把本地标题匹配到条目拿封面用 */
  listSubjectCacheAll(): Array<{ id: number; subject: BangumiSubject; aliases: string[] }> {
    const rows = this.db.prepare('SELECT id, payload FROM subject_cache').all() as Row[]
    const out: Array<{ id: number; subject: BangumiSubject; aliases: string[] }> = []
    for (const row of rows) {
      try {
        const p = JSON.parse(String(row.payload))
        if (p && typeof p.subject === 'object' && p.subject !== null) {
          out.push({ id: Number(row.id), subject: p.subject as BangumiSubject, aliases: Array.isArray(p.aliases) ? p.aliases as string[] : [] })
        }
      } catch { /* 单条损坏跳过 */ }
    }
    return out
  }
  getEpisodesCache(subjectId: number): { episodes: BangumiEpisode[]; savedAt: number } | null {
    const row = this.db.prepare('SELECT payload, saved_at FROM episodes_cache WHERE subject_id = ?').get(subjectId) as Row | undefined
    if (!row) return null
    if (Date.now() - Number(row.saved_at) > EPISODES_TTL_MS) return null
    try {
      return { episodes: JSON.parse(row.payload), savedAt: Number(row.saved_at) }
    } catch { return null }
  }
  setEpisodesCache(subjectId: number, episodes: BangumiEpisode[]): void {
    this.db.prepare('INSERT OR REPLACE INTO episodes_cache (subject_id,payload,saved_at) VALUES (?,?,?)').run(subjectId, JSON.stringify(episodes), Date.now())
  }

  // ---------- 封面图本地缓存（BLOB；URL 变化即视为过期，重拉后刷新） ----------
  getSubjectCover(subjectId: number, url: string): { bytes: Uint8Array; contentType: string } | null {
    const row = this.db.prepare('SELECT url, bytes, content_type FROM cover_cache WHERE subject_id = ?').get(subjectId) as Row | undefined
    if (!row || row.url !== url) return null
    return { bytes: row.bytes as Uint8Array, contentType: String(row.content_type ?? 'image/jpeg') }
  }
  putSubjectCover(subjectId: number, url: string, bytes: Uint8Array, contentType: string): void {
    this.db.prepare('INSERT OR REPLACE INTO cover_cache (subject_id,url,bytes,content_type,saved_at) VALUES (?,?,?,?,?)')
      .run(subjectId, url, bytes, contentType, Date.now())
  }

  // ---------- 元数据 ----------
  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO library_meta (key,value) VALUES (?,?)').run(key, value)
  }
  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM library_meta WHERE key = ?').get(key) as Row | undefined
    return row ? String(row.value) : null
  }
  /** 跨连接提交版本：热重载多 fiber 靠它侦测他人写入（本连接提交后也自增） */
  dataVersion(): number {
    try {
      const row = this.db.prepare('PRAGMA data_version').get() as Row | undefined
      return row ? Number(row.data_version) : 0
    } catch {
      return 0
    }
  }

  /** 全量替换订阅 + 下载（store.ts 内存镜像的落库入口，事务内完成） */
  replaceAll(state: { subscriptions: Subscription[]; downloads: DownloadRecord[] }): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM subscriptions')
      this.db.exec('DELETE FROM downloads')
      for (const s of state.subscriptions) this.insertSubscription(s)
      for (const d of state.downloads) this.addDownload(d)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  get tableStats(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const t of ['subscriptions', 'downloads', 'library_files', 'subject_cache', 'episodes_cache']) {
      const row = this.db.prepare(`SELECT count(*) c FROM ${t}`).get() as Row
      out[t] = Number(row.c)
    }
    return out
  }
}

function rowToSub(r: Row): Subscription {
  return {
    id: r.id, bangumiId: Number(r.bangumi_id), name: r.name, nameCn: r.name_cn ?? '',
    aliases: JSON.parse(r.aliases ?? '[]'),
    totalEpisodes: r.total_episodes ?? undefined, season: r.season ?? undefined, airDate: r.air_date ?? undefined,
    weekday: r.weekday ?? undefined, source: r.source, group: r.group_name ?? undefined,
    resolution: r.resolution ?? undefined, query: r.query ?? '',
    rssRuleName: r.rss_rule_name, feedUrl: r.feed_url, rssItemPath: r.rss_item_path ?? undefined,
    savePath: r.save_path ?? '', category: r.category ?? '', tags: r.tags ?? '',
    seenEpisodes: JSON.parse(r.seen_episodes ?? '[]'), lastCheckAt: Number(r.last_check_at ?? 0),
    lastEpisodeAt: r.last_episode_at ?? undefined, status: r.status ?? 'unknown',
    completedAt: r.completed_at ?? undefined, createdAt: Number(r.created_at),
  }
}
function subToRow(sub: Subscription): Row {
  return {
    id: sub.id, bangumi_id: sub.bangumiId, name: sub.name, name_cn: sub.nameCn ?? null,
    aliases: JSON.stringify(sub.aliases ?? []),
    total_episodes: sub.totalEpisodes ?? null, season: sub.season ?? null, air_date: sub.airDate ?? null,
    weekday: sub.weekday ?? null, source: sub.source, group_name: sub.group ?? null,
    resolution: sub.resolution ?? null, query: sub.query ?? '',
    rss_rule_name: sub.rssRuleName, feed_url: sub.feedUrl, rss_item_path: sub.rssItemPath ?? null,
    save_path: sub.savePath ?? '', category: sub.category ?? '', tags: sub.tags ?? '',
    seen_episodes: JSON.stringify(sub.seenEpisodes ?? []), last_check_at: sub.lastCheckAt ?? 0,
    last_episode_at: sub.lastEpisodeAt ?? null, status: sub.status ?? 'unknown',
    completed_at: sub.completedAt ?? null, created_at: sub.createdAt,
  }
}

function basename2(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 一次性迁移旧 state.json -> sqlite（成功后备份原名，不再触碰 JSON） */
function migrateLegacy(db: BangumiDb): void {
  if (!existsSync(LEGACY_PATH)) return
  let parsed: { subscriptions?: unknown; downloads?: unknown } | null = null
  try { parsed = JSON.parse(readFileSync(LEGACY_PATH, 'utf8')) } catch { /* 损坏则跳过 */ }
  const subs = parsed && Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []
  const dls = parsed && Array.isArray(parsed.downloads) ? parsed.downloads : []
  for (const s of subs as Subscription[]) {
    try { db.insertSubscription(s) } catch { /* 行级失败忽略 */ }
  }
  for (const d of dls as DownloadRecord[]) {
    try { db.addDownload(d) } catch { /* ignore */ }
  }
  try { renameSync(LEGACY_PATH, LEGACY_PATH + '.bak-v1') } catch { /* 无碍 */ }
}

let instance: BangumiDb | null = null
/** 惰性单例：热重载后新 fiber 各开各的句柄，WAL 保证并发安全 */
export function getDb(): BangumiDb {
  if (!instance) {
    instance = new BangumiDb(DB_PATH)
    migrateLegacy(instance)
  }
  return instance
}
export type { BangumiDb }