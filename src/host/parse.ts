/**
 * @dsh-external/dsh-bangumi — 番剧文件名/种子标题解析。
 * 从发布组不规范的命名里提取：发布组 / 分辨率 / 集号 / 季，并给出归一化标题用于匹配。
 */
export interface ParsedEpisode {
  /** 发布组，如 VCB-Studio / ANi / 桜都字幕组 */
  group?: string
  /** 分辨率，如 1080p / 720p / 2160p */
  resolution?: string
  /** 集号（含 .5），无剧集含义时 undefined */
  episode?: number
  /** 季号（S02/Season 2），默认 1 */
  season?: number
  /** 抽取出的作品标题部分（去标签后） */
  title?: string
}

/** 归一化标题：小写、去空白隔断、全角转半角常用符号、剥离标点，供包含匹配。 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u3000\s_\-\.]+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .normalize('NFKC')
}

const RES_RE = /\b(2160|1440|1080|810|720|576|480)\s*[pP]\b|\b([48])[kK]\b/
const SQUARE = /\[([^\[\]]*)\]/g

/** 常见尾部标签（编码/音轨/格式），判断「该数字是否其实是集号」时用。 */
const TAG_RE = /^(?:x26[45]|avc|hevc|av1|10bit|8bit|h264|h265|aac|flac|mp4|mkv|webm|ass|chs|cht|jpsc|gb|big5|简繁|繁简|简日|繁日|内封|内嵌|外挂|度盘|bd|bdrip|hdtv|web-dl|webrip|web|rmvb|mp3|fin)$/i

/** 从发布文件名解析集号信息。tolernat：解析不出时返回尽量多的字段。 */
export function parseEpisode(filename: string): ParsedEpisode {
  const out: ParsedEpisode = {}
  if (!filename) return out

  let name = filename.replace(/\.\w{2,4}$/, '') // 去扩展名

  // 发布组：首个方括号段
  const firstBracket = /^\s*\[([^\[\]]{1,40})\]/.exec(name)
  if (firstBracket && !RES_RE.test(firstBracket[1]) && !TAG_RE.test(firstBracket[1].trim())) {
    out.group = firstBracket[1].trim()
  }

  // 分辨率（4K/8K 归一成 2160p 描述不动）
  const res = RES_RE.exec(name)
  if (res) out.resolution = res[0].toLowerCase().includes('k') ? res[0].toUpperCase() : res[0].toLowerCase()

  // 季号
  const season = /\b(?:s|season\s*)(\d{1,2})\b/i.exec(name)
  if (season) out.season = Number(season[1])

  // 集号候选：方括号内/独立数字段（1-3 位、允许 .5、可带 v2/v3）
  const candidates: Array<{ value: number; index: number }> = []
  for (const re of [
    /[\[\s\-_【](?:ep|e|第)?\s*(\d{1,3}(?:\.5)?)(?:\s*[vV]\d)?\s*[\]\s\-_】話话集]/gi,
    /\bEP(\d{1,3}(?:\.5)?)/gi,
    /第\s*(\d{1,3})\s*[話话集]/gi,
    // S01E11 式命名（smzase 等组）；必须紧邻 E 且前面是 S<季>，避免误抓孤立 E 字母
    /\bS\d{1,2}E(\d{1,3}(?:\.5)?)/gi,
  ]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(name)) !== null) {
      const v = parseFloat(m[1])
      if (v >= 0 && v <= 999) candidates.push({ value: v, index: m.index })
    }
  }
  // 排除明显是年份 / 分辨率 / 音轨的数字
  const filtered = candidates.filter((c) => {
    if ([1080, 720, 480, 2160, 3840].includes(c.value)) return false
    if (c.value >= 1990 && c.value <= 2100) return false
    return true
  })
  // 排除紧邻 Season/第 声明的孤立数字（Season 2 的 2 / 第 2 季的 2 不是集号）
  const seasonAware = filtered.filter((c) => {
    const before = name.slice(Math.max(0, c.index - 16), c.index)
    if (/(?:season|\bS)\s*$/i.test(before)) return false
    if (/第\s*$/.test(before)) return false
    return true
  })
  // 按出现位置取最后（标题在前的常规命名）；seasonAware 为空（全部被剔）则视为无集号
  if (seasonAware.length) {
    seasonAware.sort((a, b) => a.index - b.index)
    out.episode = seasonAware[seasonAware.length - 1].value
  }

  // 标题部分：第 2 个方括号段，或去掉全部标签后的残片
  const brackets: string[] = []
  name.replace(SQUARE, (_m, inner: string) => {
    brackets.push(inner)
    return ''
  })
  const titleSeg = brackets.find((seg, i) => {
    if (i === 0 && out.group) return false
    if (RES_RE.test(seg)) return false
    if (/^\d{1,3}(\.5)?(v\d)?$/i.test(seg.trim())) return false
    return seg.trim().length > 0
  })
  out.title = (titleSeg ?? name).trim()

  // 区间包（01-28 / 01-10 / 13-18TV 等）：不当作单集号（由 detectPack 表达区间语义）
  const pk = detectPack(filename)
  if (pk && pk.isPack && pk.from !== undefined && pk.to !== undefined && pk.to > pk.from) {
    delete out.episode
  }
  return out
}

/** 整包/合集识别结果：true=该种子是「一次含多集」的打包资源。 */
export interface PackInfo {
  isPack: boolean
  /** 起止集号（含端点），单文件无此语义时 undefined */
  from?: number
  to?: number
  /** 单季覆盖（seasonFull=true 表示完全包含季号对应全部集） */
  seasonFull?: boolean
  /** 文案特征：full/box/sp/fin/end 等（调试与展示） */
  flags: string[]
  /** 是否为跨季合集（S1+S2 / S01+S02，订阅单季时必须排除） */
  multiSeason?: boolean
  /** 去掉跨季合并符后的子季列表（如 [1,2]） */
  seasons?: number[]
  /** 区间字符串（原始形态，如 01-28+SPx11 / 25-48） */
  rangeRaw?: string
}

/**
 * 标题里常见的打包/区间形态（真实样本归纳）：
 *  1. 「01-28」/「01-28+SPx11」/「[25-48 修正合集]」/「01-24TV全集+SP」 显式区间
 *  2. 标记词：全集 / 合集 / 修正合集 / Fin / END / BOX / TV全集 等
 *  3. 跨季合集：S1+S2 / S01+S02（订阅单季时必须排除）
 * 返回 null = 无打包特征（普通单集或不可判定）。
 */
export function detectPack(raw: string): PackInfo | null {
  const t = raw
  const flags: string[] = []
  if (!t) return null

  // 跨季合集：S1+S2 / S01+S02 / Season 1+2
  let multiSeason = false
  let seasons: number[] | undefined
  const multiRe = /\b(?:S\s*(\d{1,2})\s*(?:\+|\/|\-|\s|&)\s*S\s*(\d{1,2})|Season\s*(\d{1,2})\s*(?:\+|\/|\-|\s|&)\s*Season\s*(\d{1,2}))\b/i
  const mm = multiRe.exec(t)
  if (mm) {
    multiSeason = true
    flags.push('multi-season:' + (mm[1] ?? mm[3]) + '+' + (mm[2] ?? mm[4]))
    const sa = Number(mm[1] ?? mm[3] ?? 0)
    const sb = Number(mm[2] ?? mm[4] ?? 0)
    if (sa && sb) seasons = sa < sb ? [sa, sb] : [sb, sa]
  }

  // 显式区间：NN-MM（含 +SPxN 后缀）
  const rangeRe = /(?:^|[^0-9])(\d{1,2}(?:\.5)?)\s*[-~～]\s*(\d{1,3}(?:\.5)?)(?=[^0-9]|$)/
  let rangeRaw: string | undefined
  let from: number | undefined
  let to: number | undefined
  let seasonFull = false
  const rm = multiSeason ? null : rangeRe.exec(t)
  if (rm && !multiSeason) {
    // 季号守卫：S3 - 07 / Season 2 - 05 / S1 - 08 是「季号 + 单集号」，不是区间包 3-07。
    // rangeRe 的 [^0-9] 前导会吃掉季号字母 S，把季号数字当区间起点（真实样本 LoliHouse「S3 - 07」被误判 3-07）。
    const seasonLead = /^S\s*\d{1,2}/i.test(rm[0]) || /^Season\s*\d{1,2}/i.test(rm[0])
    if (!seasonLead) {
      const f = parseFloat(rm[1]); const e = parseFloat(rm[2])
      if (f <= e) {
        from = f; to = e
        rangeRaw = rm[0].trim()
        const after = t.slice(rm.index + rm[0].length, rm.index + rm[0].length + 24)
        if (/SP|特典|OVA|总集编/i.test(after)) flags.push('range-with-sp')
        flags.push('range:' + rm[0].trim())
        if (spanCount(from, to) >= 8) flags.push('wide-range:' + spanCount(from, to))
      }
    }
  }

  // 标记词
  const wordRe = /(?:全集|全\s*\d+\s*[集話话]|合集|总集编|总集編|修正合集|\bFIN\b|\bEND\b|BOX\s*\d*|BD(?:rip)?\s*BOX|TV全集|第[一二三四五六七八九十]+卷|Vol(?:ume)?\.?\s*\d+\s*-\s*\d+)/i
  const wm = wordRe.exec(t)
  if (wm) flags.push(wm[0].toLowerCase())

  // rm 仅在真正解析出区间（from/to 有值）时才算 pack；季号守卫跳过时 rm 不生效
  if (multiSeason || (rm && from !== undefined) || wm) {
    let season: number | undefined
    const sRe = /\bS(\d{1,2})\b(?!E\d)/i
    const sm = sRe.exec(t)
    if (sm) season = Number(sm[1])
    // 只有标记词而无区间：带季 + Fin/END/BOX/全集类词 -> 视为整季
    if (from === undefined && /(?:全集|合集|修正合集|\bFin\b|\bEND\b|BOX)/i.test(t)) {
      seasonFull = season !== undefined || /(?:全集|合集|修正合集)/.test(t)
    }
    return {
      isPack: true,
      from, to, seasonFull, flags, multiSeason, seasons, rangeRaw,
    }
  }
  return null
}

/** 闭区间集数（含端点） */
function spanCount(a: number, b: number): number {
  const s = Math.min(a, b); const e = Math.max(a, b)
  let n = 0
  for (let x = s; x <= e; x += 1) n += 1
  return n
}
