/**
 * @dsh-external/dsh-bangumi — 本地媒体库扫描。
 * 递归扫描用户配置的媒体目录，用 parseEpisode 解析每个视频文件的番/集/组/分辨率，
 * 产出「bangumi 归一化标题 -> 已存在的集号集合」。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEpisode, normalizeTitle } from './parse.js'
import type { ParsedEpisode } from './parse.js'

const VIDEO_EXT = new Set(['mkv', 'mp4', 'm2ts', 'ts', 'avi', 'mov', 'flv', 'wmv', 'webm', 'rmvb', 'mpg', 'mpeg'])

export interface LibraryFile {
  path: string        // 绝对路径
  dir: string         // 所在目录
  name: string        // 文件名
  size: number        // 字节
  mtimeMs: number
  parsed: ParsedEpisode
  /** 归一化标题（normalizeTitle(parsed.title ?? name)） */
  normTitle: string
  /** 扫描时的根目录（持久化行标记用） */
  root?: string
}

export interface LibrarySnapshot {
  /** 全部扫描到的文件 */
  files: LibraryFile[]
  /** normTitle -> 集号 -> 最佳文件 */
  byTitle: Record<string, Record<string, LibraryFile>>
  /** 扫描时间戳 ms */
  scannedAt: number
  /** 扫描的目录列表 */
  roots: string[]
}

async function walk(dir: string, depth: number, out: LibraryFile[]): Promise<void> {
  if (depth > 10) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true }) as import('node:fs').Dirent[]
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(abs, depth + 1, out)
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.')
      if (dot < 0) continue
      const ext = e.name.slice(dot + 1).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      let st
      try {
        st = await stat(abs)
      } catch {
        continue
      }
      const parsed = parseEpisode(e.name)
      const base = parsed.title && parsed.title.length > 1 ? parsed.title : e.name.replace(/\.\w+$/, '')
      out.push({
        path: abs,
        dir,
        name: e.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        parsed,
        normTitle: normalizeTitle(base),
      })
    }
  }
}

/** 由平铺文件列表聚合 normTitle -> 集号 -> 最优文件（同集保留更大的） */
export function buildByTitle(files: LibraryFile[]): Record<string, Record<string, LibraryFile>> {
  const byTitle: Record<string, Record<string, LibraryFile>> = {}
  for (const f of files) {
    if (f.parsed.episode === undefined) continue
    const epKey = String(f.parsed.episode)
    const bucket = byTitle[f.normTitle] ?? (byTitle[f.normTitle] = {})
    const prev = bucket[epKey]
    if (!prev || prev.size < f.size) bucket[epKey] = f
  }
  return byTitle
}

/** 全量扫描媒体库目录 */
export async function scanLibrary(roots: string[]): Promise<LibrarySnapshot> {
  const files: LibraryFile[] = []
  for (const root of roots) {
    const r = root.trim()
    if (!r) continue
    await walk(r, 0, files)
  }
  return { files, byTitle: buildByTitle(files), scannedAt: Date.now(), roots }
}

/**
 * 一个订阅（含别名）在库里已拥有的集号集合。
 * 匹配维度：别名归一后被库 normTitle 包含 / 或库 normTitle 被别名包含。
 */
export function findEpisodesInLibrary(snapshot: LibrarySnapshot | null, aliases: string[]): { episodes: number[]; matchedTitle?: string; count: number } {
  if (!snapshot || aliases.length === 0) return { episodes: [], count: 0 }
  const norms = aliases.map(normalizeTitle).filter((s) => s.length > 0)
  let best: { title: string; episodes: number[] } | undefined
  for (const [normTitle, eps] of Object.entries(snapshot.byTitle)) {
    const hit = norms.some((n) => normTitle.includes(n) || n.includes(normTitle))
    if (!hit) continue
    const episodes = Object.keys(eps).map((k) => parseFloat(k)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    if (!best || episodes.length > best.episodes.length) best = { title: normTitle, episodes }
  }
  if (!best) return { episodes: [], count: 0 }
  return { episodes: best.episodes, matchedTitle: best.title, count: best.episodes.length }
}
