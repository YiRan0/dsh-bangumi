/**
 * @dsh-external/dsh-bangumi — nyaa / 动漫花园 RSS 抓取与解析。
 * 无第三方依赖：手写轻量 XML/RSS 解析，容忍两个站的真实 RSS 变体。
 */
import { parseEpisode, type ParsedEpisode } from './parse.js'
import { netFetchText } from './net.js'

export interface RssItem {
  /** 种子发布组标题（含 [组][番][集][画质]） */
  title: string
  /** magnet:?xt=... 链接（dmhy enclosure / nyaa 由 infoHash 合成） */
  magnet?: string
  /** 种子详情页 */
  page?: string
  /** 发布时间 ISO */
  pubDate?: string
  /** nyaa 专属 */
  seeders?: number
  size?: string
  infoHash?: string
  /** dmhy 专属：发布字幕组 */
  author?: string
  /** parseEpisode 缓存 */
  parsed?: ParsedEpisode
}

/** 简单实体解码 */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

/** 取一个 <item> 片段里的首个标签内容（tag 可带命名空间前缀） */
function pick(xml: string, tag: string): string | undefined {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i')
  const m = re.exec(xml)
  return m ? decodeEntities(m[1].trim()) : undefined
}

/** 取 <enclosure ... url="..."> 的 url 属性 */
function enclosureUrl(xml: string): string | undefined {
  const m = /<enclosure\s[^>]*\burl\s*=\s*"([^"]*)"/i.exec(xml)
  return m ? decodeEntities(m[1]) : undefined
}

/** 解析 RSS 全文 -> items */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const frag = m[0]
    const title = pick(frag, 'title')
    if (!title) continue
    const link = pick(frag, 'link')
    const guid = pick(frag, 'guid')
    const infoHash = pick(frag, 'nyaa:infoHash') ?? pick(frag, 'infoHash')
    const seedersRaw = pick(frag, 'nyaa:seeders') ?? pick(frag, 'seeders')
    const size = pick(frag, 'nyaa:size') ?? pick(frag, 'size')
    const author = pick(frag, 'author')
    const pubDate = pick(frag, 'pubDate')
    let magnet = enclosureUrl(frag)
    if (!magnet && infoHash) {
      magnet = 'magnet:?xt=urn:btih:' + infoHash.toLowerCase() + '&dn=' + encodeURIComponent(title)
    }
    if (magnet && !magnet.startsWith('magnet:')) {
      if (link?.startsWith('magnet:')) magnet = link
      else if (guid?.startsWith('magnet:')) magnet = guid
    }
    const item: RssItem = {
      title,
      magnet,
      page: link && !link.startsWith('magnet:') ? link : undefined,
      pubDate: pubDate ? new Date(pubDate).toISOString() : undefined,
      seeders: seedersRaw !== undefined ? Number(seedersRaw) : undefined,
      size,
      infoHash,
      author,
    }
    item.parsed = parseEpisode(title)
    items.push(item)
  }
  return items
}

/** 通用 fetch（UA + 超时） */
/** 通用文本拉取（UA + 超时；外网走可配置代理出口 net.ts，qB 等本机服务不受影响） */
export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  return netFetchText(url, {
    timeoutMs,
    headers: {
      'User-Agent': 'dsh-bangumi/0.1 (+https://github.com/dsh-external/dsh-bangumi)',
      'Accept': 'application/rss+xml, text/xml, text/html;q=0.8',
    },
  })
}

/** nyaa 搜索 RSS */
export function nyaaSearchUrl(query: string): string {
  return 'https://nyaa.si/?page=rss&f=0&c=1_4&q=' + encodeURIComponent(query)
}

/** 动漫花园搜索 RSS */
export function dmhySearchUrl(query: string): string {
  return 'https://share.dmhy.org/topics/rss/rss.xml?keyword=' + encodeURIComponent(query)
}

export async function searchNyaa(query: string): Promise<RssItem[]> {
  return parseRss(await fetchText(nyaaSearchUrl(query)))
}

export async function searchDmhy(query: string): Promise<RssItem[]> {
  return parseRss(await fetchText(dmhySearchUrl(query)))
}

/** 通用 RSS 订阅源（订阅的 feedUrl 全量拉取） */
export async function fetchFeed(url: string): Promise<RssItem[]> {
  return parseRss(await fetchText(url))
}
