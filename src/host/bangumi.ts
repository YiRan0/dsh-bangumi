/**
 * @dsh-external/dsh-bangumi — Bangumi(bgm.tv) API 客户端。
 * 仅匿名低并发读取（subject search / info / episodes），无需 token。
 */
export interface BangumiSubject {
  id: number
  name: string
  nameCn: string
  airDate?: string   // YYYY-MM-DD
  totalEpisodes?: number
  images?: { large?: string; common?: string; grid?: string }
  summary?: string
  /** 衍生别名集合（搜索匹配用） */
  aliases?: string[]
  /** 放送平台：TV / 剧场版 / WEB / OVA 等 */
  platform?: string
  /** 热门标签（前几个） */
  tags?: string[]
}

export interface BangumiEpisode {
  ep: number
  airDate?: string
  name?: string
  nameCn?: string
}

const BASE = 'https://api.bgm.tv'

async function apiGet(path: string): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'dsh-bangumi/0.1 (+https://github.com/dsh-external/dsh-bangumi)' },
    })
    if (!res.ok) throw new Error('bangumi ' + res.status + ' ' + res.statusText)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function toSubject(raw: any): BangumiSubject {
  const infobox: Array<{ key: string; value: any }> = raw.infobox ?? []
  const aliases = new Set<string>()
  for (const row of infobox) {
    if (row.key === '别名') {
      const values = Array.isArray(row.value) ? row.value : [row.value]
      for (const v of values) {
        const text = typeof v === 'string' ? v : typeof v === 'object' && v ? (v.v ?? v.k ?? '') : ''
        if (typeof text === 'string' && text.trim()) aliases.add(text.trim())
      }
    }
  }
  for (const n of [raw.name, raw.name_cn].filter(Boolean)) aliases.add(String(n))
  return {
    id: raw.id,
    name: raw.name ?? '',
    nameCn: raw.name_cn ?? '',
    // /v0/subjects 用 date 字段，/v0/search 结果同；air_date 是旧字段堡垒
    airDate: (raw.date || (raw.air_date && raw.air_date !== '0000-00-00' ? raw.air_date : '') || undefined) as string | undefined,
    // eps=本篇集数；total_episodes 含特典，优先 eps
    totalEpisodes: typeof raw.eps === 'number' && raw.eps > 0 ? raw.eps : typeof raw.total_episodes === 'number' && raw.total_episodes > 0 ? raw.total_episodes : undefined,
    images: raw.images ?? undefined,
    summary: raw.summary ?? undefined,
    platform: typeof raw.platform === 'string' ? raw.platform : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tg: any) => (typeof tg === 'string' ? tg : tg?.name)).filter(Boolean).slice(0, 8) : undefined,
    aliases: [...aliases],
  }
}

/** 番剧搜索：POST /search/subjects，type=2（动画） */
export async function searchSubjects(keyword: string, limit = 10): Promise<BangumiSubject[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(BASE + '/v0/search/subjects?limit=' + limit, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'dsh-bangumi/0.1 (+https://github.com/dsh-external/dsh-bangumi)',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keyword, filter: { type: [2] } }),
    })
    if (!res.ok) throw new Error('bangumi search ' + res.status)
    const data: any = await res.json()
    const list: any[] = data?.data ?? data?.list ?? []
    return list.map(toSubject)
  } finally {
    clearTimeout(timer)
  }
}

/** 番剧详情 */
export async function getSubject(id: number): Promise<BangumiSubject> {
  return toSubject(await apiGet('/v0/subjects/' + id))
}

/** 剧集列表（放送日期 —> 对应周几） */
export async function getEpisodes(subjectId: number): Promise<BangumiEpisode[]> {
  const data = await apiGet('/v0/episodes?subject_id=' + subjectId + '&limit=200&offset=0')
  const list: any[] = data?.data ?? []
  return list
    .filter((e) => (e.type === undefined || e.type === 0)) // 0=本篇正片
    .map((e) => ({
      ep: typeof e.ep === 'number' ? e.ep : e.sort ?? e.sort_raw ?? 0,
      airDate: typeof e.airdate === 'string' && e.airdate && e.airdate !== '0000-00-00' ? e.airdate : undefined,
      name: e.name,
      nameCn: e.name_cn,
    }))
    .filter((e) => e.ep > 0)
}
/** 取番详情（7 天缓存），附别名集合；miss 时打 API 并回填 */
export async function getSubjectCached(id: number): Promise<{ subject: BangumiSubject; aliases: string[]; fromCache: boolean }> {
  const { getDb } = await import('./db.js')
  const hit = getDb().getSubjectCache(id)
  if (hit) return { subject: hit.subject, aliases: hit.aliases, fromCache: true }
  const subject = await getSubject(id)
  const aliases = subject.aliases ?? [subject.name, subject.nameCn].filter(Boolean)
  getDb().setSubjectCache(id, subject, aliases)
  return { subject, aliases, fromCache: false }
}

/** 取本篇剧集列表（6 小时缓存） */
export async function getEpisodesCached(subjectId: number): Promise<BangumiEpisode[]> {
  const { getDb } = await import('./db.js')
  const hit = getDb().getEpisodesCache(subjectId)
  if (hit) return hit.episodes
  const episodes = await getEpisodes(subjectId)
  getDb().setEpisodesCache(subjectId, episodes)
  return episodes
}
