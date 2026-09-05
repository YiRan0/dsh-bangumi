/**
 * @dsh-external/dsh-bangumi — AI 审核层（强介入）。
 * 宿主 ctx.llm (LlmRuntime) 每轮轮询/下载/媒体库扫描前做 AI 判断，输出严格 JSON；
 * 失败或未配置 → 回退脚本原逻辑（AI 只做建议，失败不阻塞下载）。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'

/** 与宿主 LlmRuntime.stream 兼容的最小子集（便于测试注入） */
export interface LlmStreamLike {
  stream(options: {
    provider: string
    model: string
    messages: readonly Message[]
    system?: string
    maxTokens?: number
    temperature?: number
  }): AsyncIterable<{ type?: string; text?: string; block?: { type?: string; text?: string } }>
}

export interface AiRoute {
  provider: string
  model: string
}

export interface AiReviewConfig {
  enabled: boolean
  route?: AiRoute
}

/** AI 审核层实例：持有 llm + 路由，提供三个介入点的判断 */
export class AiReviewer {
  constructor(
    private readonly llm: LlmStreamLike,
    private readonly cfg: () => AiReviewConfig,
    private readonly log: (msg: string) => void,
  ) {}

  get enabled(): boolean {
    return this.cfg().enabled && !!this.cfg().route?.provider && !!this.cfg().route?.model
  }

  /** 通用单轮调用：组装 system+user，流式收全文，剥 ```json 围栏后 JSON.parse。失败返回 null。 */
  private async ask(
    system: string,
    user: string,
    maxTokens = 800,
  ): Promise<unknown | null> {
    if (!this.enabled) return null
    const cfg = this.cfg()
    const route = cfg.route!
    let output = ''
    try {
      const message = createUserMessage({
        content: [{ type: 'text', text: user }],
        source: { kind: 'user' },
      })
      for await (const chunk of this.llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [message],
        system,
        maxTokens,
        temperature: 0.2,
      })) {
        // text-delta = 分片累加；block-end 常携带整段全文——若 delta 已覆盖则忽略，避免全文二次拼接
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
        else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
          if (!output) output = chunk.block.text
        }
      }
    } catch (err) {
      this.log('bangumi ai-review fail: ' + (err instanceof Error ? err.message : String(err)))
      return null
    }
    const fence = String.fromCharCode(96).repeat(3)
    const cleaned = output.trim().replace(new RegExp('^' + fence + '(?:json)?|' + fence + '$', 'g'), '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    const candidates = start >= 0 && end > start ? [cleaned.slice(start, end + 1)] : [cleaned]
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate)
      } catch {
        // 下一候选
      }
    }
    this.log('bangumi ai-review bad-json: ' + output.slice(0, 200))
    return null
  }

  /** 介入点1 — 每轮轮询：审核候选清单，决定该下/该搜/该跳过。 */
  async reviewCandidates(input: {
    subName: string
    bangumiId: number
    totalEpisodes?: number
    finished: boolean
    haveEpisodes: number[]
    candidates: Array<{ episode?: number; full: boolean; range?: string; title: string; score: number; pubDate?: string; group?: string }>
    missingAired: number[]
  }): Promise<{ decision: 'download-all' | 'download-selected' | 'hold' | 'search-backfill'; selectedEpisodes: number[]; backfillEpisodes: number[]; reason: string } | null> {
    const list = input.candidates.map((c, i) =>
      '#' + (i + 1) + ' ' + (c.full ? '[全集' + (c.range ?? '') + ']' : '[EP' + c.episode + ']') + ' score=' + c.score + ' ' + (c.group ? c.group + ' ' : '') + (c.pubDate ? c.pubDate + ' ' : '') + c.title
    ).join('\n')
    const system = [
      '你是番剧追更下载决策助手。用户订阅了番剧，系统把 RSS 抓到的候选种子列给你，',
      '你判断这轮该下载哪些。严格只输出 JSON，不要 Markdown，不要解释。',
      'JSON 字段：',
      '  decision: "download-all" | "download-selected" | "hold" | "search-backfill"',
      '    download-all = 候选里的缺集都下（完结番全集候选优先）',
      '    download-selected = 只下 selectedEpisodes 指出的集（连载番：只补到最新，别灌历史全集）',
      '    hold = 这轮不下（缺集还没放送 / 候选可疑）',
      '    search-backfill = 有已放送但候选里没有的历史缺集，需要另行搜索补档（填 backfillEpisodes）',
      '  selectedEpisodes: 要下载的单集号数组（decision=download-selected 时）',
      '  backfillEpisodes: 已放送但缺、需要补搜的历史集号数组（decision=search-backfill 时）',
      '  reason: 一句话中文理由',
      '判断原则：',
      '- 已完结番：优先下全集（候选里 [全集] 项），没有全集才逐集补。',
      '- 连载番：只补「已放送且本地没有」的集，绝不主动灌 EP1 历史全集；新集没放送就 hold。',
      '- 注意候选中若全集与已拥有的集重叠，别重复下。',
    ].join('\n')
    const user = [
      '番剧：' + input.subName + ' (bgm ' + input.bangumiId + ')',
      '总集数：' + (input.totalEpisodes ?? '未知') + '；完结：' + (input.finished ? '是' : '否'),
      '本地已有集：' + (input.haveEpisodes.length ? input.haveEpisodes.join(',') : '无'),
      '已放送但本地缺：' + (input.missingAired.length ? input.missingAired.join(',') : '无'),
      '',
      '候选种子：',
      list || '(无)',
    ].join('\n')
    const raw = await this.ask(system, user)
    if (!raw) return null
    const r = raw as Record<string, unknown>
    const decision = r.decision
    if (decision !== 'download-all' && decision !== 'download-selected' && decision !== 'hold' && decision !== 'search-backfill') {
      this.log('bangumi ai-review candidates bad-decision: ' + String(decision))
      return null
    }
    const num = (v: unknown): number[] => Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
    return {
      decision,
      selectedEpisodes: num(r.selectedEpisodes),
      backfillEpisodes: num(r.backfillEpisodes),
      reason: typeof r.reason === 'string' ? r.reason : '',
    }
  }

  /** 介入点2 — 每次下载前审核（单条种子是否真的该下/该换更好源）。 */
  async reviewDownload(input: {
    subName: string
    episode?: number
    full: boolean
    title: string
    magnet: string
    group?: string
    resolution?: string
    score: number
    haveEpisodes: number[]
    totalEpisodes?: number
  }): Promise<{ approve: boolean; alternativeMagnet?: string; reason: string } | null> {
    const system = [
      '你是番剧下载审核助手。系统准备把一个种子加入下载队列，你判断是否放行。',
      '严格只输出 JSON，不要 Markdown，不要解释。',
      'JSON：{"approve": boolean, "alternativeMagnet": string|空, "reason": string}',
      'approve=false 时给 reason；若你认为候选不对但有更合适的替代磁力链接，填 alternativeMagnet（很少见）。',
    ].join('\n')
    const user = [
      '番剧：' + input.subName,
      input.full ? '下载：全集 ' + input.title : '下载：EP' + input.episode + ' — ' + input.title,
      '来源组：' + (input.group ?? '未知') + '；分辨率：' + (input.resolution ?? '未知') + '；打分：' + input.score,
      '本地已有：' + (input.haveEpisodes.length ? input.haveEpisodes.join(',') : '无') + (input.totalEpisodes ? ' / 总' + input.totalEpisodes : ''),
      '磁力：' + input.magnet.slice(0, 80) + '…',
      '',
      '放行标准：标题与番剧匹配、集号无重复、画质合理（别下错组/错集/广告假种）。',
    ].join('\n')
    const raw = await this.ask(system, user)
    if (!raw) return null
    const r = raw as Record<string, unknown>
    return {
      approve: r.approve === true,
      alternativeMagnet: typeof r.alternativeMagnet === 'string' ? r.alternativeMagnet : undefined,
      reason: typeof r.reason === 'string' ? r.reason : '',
    }
  }

  /** 介入点3 — 媒体库扫描后：判断新增文件是否异常/值得关注（如重复、缺集被补、新作品）。 */
  async reviewLibrary(input: {
    addedFiles: number
    changedWorks: Array<{ name: string; episodes: number[]; missing?: number[] }>
    subscribedMissing: Array<{ name: string; missing: number[] }>
  }): Promise<{ note: string; notifyMissing: boolean } | null> {
    const system = [
      '你是番剧媒体库助手。媒体库刚扫描完，你判断有没有值得用户知道的事。',
      '严格只输出 JSON：{"note": string, "notifyMissing": boolean}',
      'note 一句话中文说明（无异常就写"无异常"）；notifyMissing=true 表示有订阅番剧缺失集需要补（会触发下载判新）。',
    ].join('\n')
    const user = [
      '本次新增文件：' + input.addedFiles + ' 个',
      '变化的作品：',
      input.changedWorks.map((w) => '  ' + w.name + ': 现有 ' + w.episodes.join(',') + (w.missing?.length ? ' 缺 ' + w.missing.join(',') : '')).join('\n') || '  (无)',
      '订阅中但有缺集的番：',
      input.subscribedMissing.map((s) => '  ' + s.name + ': 缺 ' + s.missing.join(',')).join('\n') || '  (无)',
    ].join('\n')
    const raw = await this.ask(system, user)
    if (!raw) return null
    const r = raw as Record<string, unknown>
    return {
      note: typeof r.note === 'string' ? r.note : '',
      notifyMissing: r.notifyMissing === true,
    }
  }
}
