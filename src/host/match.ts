/**
 * @dsh-external/dsh-bangumi — 种子候选匹配打分。
 * 多维校验：别名命中 / 集数有效 / 分辨率期望 / 发布组识别 / 种子热度。
 */
import { detectPack, normalizeTitle } from './parse.js'
import type { PackInfo, ParsedEpisode } from './parse.js'
import type { RssItem } from './rss.js'

export interface MatchInput {
  /** Bangumi 别名集合（name, nameCn, infobox 别名） */
  aliases: string[]
  /** 期望分辨率（可选） */
  preferResolution?: string
  /** 期望发布组（可选） */
  preferGroup?: string
  /** 订阅季号：1=第一季。命中该季的标题才算数（异季条目如「第二季」在搜第一季时需剔除） */
  seasonOnly?: number
  /** 是否接受整包资源（完结全集/合集等无单集号的种子） */
  wantFull?: boolean
}

export interface ScoredItem {
  item: RssItem
  score: number       // 0..100
  reasons: string[]
  parsed: ParsedEpisode | undefined
  pack?: PackInfo
}

export function scoreItem(item: RssItem, input: MatchInput): ScoredItem {
  const parsed = item.parsed
  const pack = detectPack(item.title)
  let score = 0
  const reasons: string[] = []
  const norm = normalizeTitle(item.title)

  // 0) 季归属：标题必须属于订阅季（跨季合集对单季订阅不算命中）
  if (input.seasonOnly && pack?.multiSeason) {
    // S1+S2 全集：不在订阅季范围内 -> 排除（下方整体过滤），score 不参与
    if (!pack.seasons?.includes(input.seasonOnly)) reasons.push('跨季合集非本季')
  }

  // 1) 别名命中（取最严的：完整别名被标题包含 +40）
  const aliases = input.aliases.map(normalizeTitle).filter((s) => s.length > 0)
  const hit = aliases.find((a) => norm.includes(a))
  if (hit) {
    score += 40
    reasons.push('别名命中:' + hit)
  }

  // 2) 集号有效
  if (parsed?.episode !== undefined) {
    score += 12
    reasons.push('集号=' + parsed.episode)
  }

  // 3) 分辨率
  if (parsed?.resolution) {
    score += 10
    reasons.push(parsed.resolution)
    if (input.preferResolution && parsed.resolution.toLowerCase() === input.preferResolution.toLowerCase()) {
      score += 8
      reasons.push('分辨率匹配')
    }
  }

  // 4) 发布组
  if (parsed?.group) {
    score += 8
    reasons.push('组=' + parsed.group)
    if (input.preferGroup && normalizeTitle(parsed.group) === normalizeTitle(input.preferGroup)) {
      score += 8
      reasons.push('组匹配')
    }
  }

  // 5) 种子热度（nyaa 种子数平滑加分，最多 10）
  if (typeof item.seeders === 'number' && item.seeders > 0) {
    const bonus = Math.min(10, Math.round(Math.log10(1 + item.seeders) * 5))
    score += bonus
    reasons.push('seeders=' + item.seeders)
  }

  // 6) magnet 可用
  if (item.magnet) score += 4

  // 7) 整包加分：全集/合集/区间包（完成度倾向）
  if (pack?.isPack) {
    score += 10
    reasons.push('全集包')
  }

  return { item, score: Math.min(100, score), reasons, parsed, pack: pack ?? undefined }
}

/** 对一组 RssItem 评分并按分降序 */
export function rankItems(items: RssItem[], input: MatchInput): ScoredItem[] {
  const scored = items.map((i) => scoreItem(i, input))
  // 季归属过滤：明确非订阅季的条目剔除
  //  - 跨季合集（S1+S2）：含订阅季才保留
  //  - 单季整包（S01 | 01-28）：标题明示季号 ≠ 订阅季则剔除
  const season = input.seasonOnly
  const kept = season === undefined
    ? scored
    : scored.filter((s) => {
        const pk = s.pack
        if (pk?.multiSeason) return !!pk.seasons?.includes(season)
        if (pk?.isPack) {
          const rawSeason = /\bS(\d{1,2})\b(?!E\d)/i.exec(s.item.title)?.[1]
          if (rawSeason) {
            const tSeason = Number(rawSeason)
            if (tSeason !== season) return false
          }
        }
        return true
      })
  return kept.sort((a, b) => b.score - a.score)
}
