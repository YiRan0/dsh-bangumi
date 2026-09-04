/**
 * @dsh-external/dsh-bangumi — qBittorrent WebUI API 客户端（Cookie 认证）。
 * 覆盖：登录 / torrents.info / add / rss feed+rule / app preferences。
 */
export interface QbConfig {
  url: string        // 如 http://127.0.0.1:8080（末尾无 /）
  username?: string
  password?: string
}

export interface QbTorrent {
  hash: string
  name: string
  progress: number   // 0..1
  state: string
  savePath?: string
  category?: string
  tags?: string
}

export class QbClient {
  private cookie: string | null = null

  constructor(private cfg: QbConfig) {}

  private async req(path: string, body?: Record<string, string>, method = 'POST'): Promise<any> {
    const headers: Record<string, string> = {}
    if (this.cookie) headers.Cookie = this.cookie
    let payload: string | undefined
    if (body !== undefined) {
      const form = new URLSearchParams(body)
      payload = form.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    const res = await fetch(this.cfg.url + path, { method: body ? 'POST' : method, headers, body: payload })
    // 401/403 时重新登录一次
    if ((res.status === 401 || res.status === 403) && this.cookie) {
      this.cookie = null
      this.authTried = false
      await this.login()
      const retry = await fetch(this.cfg.url + path, {
        method: body ? 'POST' : method,
        headers: { ...headers, Cookie: this.cookie ?? '' },
        body: payload,
      })
      return retry
    }
    return res
  }

  private authTried = false

  /** 登录一次；失败则保持匿名（依赖 WebUI AuthSubnetWhitelist/LocalHostAuth 免登） */
  async login(): Promise<boolean> {
    if (this.authTried) return this.cookie !== null
    this.authTried = true
    try {
      const res = await fetch(new URL('/api/v2/auth/login', this.cfg.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: this.cfg.username ?? '',
          password: this.cfg.password ?? '',
        }).toString(),
      })
      const text = await res.text()
      const setCookie = res.headers.get('set-cookie')
      if (res.ok && text.trim() === 'Ok.' && setCookie) {
        this.cookie = setCookie.split(';')[0]
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /** 测试连通与认证 */
  async test(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      if (!this.cookie) await this.login()
      const res = await this.req('/api/v2/app/version', undefined, 'GET')
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
      return { ok: true, version: await res.text() }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  /** 按分类+标签拉取种子 */
  async torrents(options: { category?: string; tag?: string } = {}): Promise<QbTorrent[]> {
    if (!this.cookie) await this.login()
    const qs = new URLSearchParams()
    if (options.category) qs.set('category', options.category)
    if (options.tag) qs.set('tag', options.tag)
    const res = await this.req('/api/v2/torrents/info?' + qs.toString(), undefined, 'GET')
    if (!res.ok) throw new Error('qB torrents/info HTTP ' + res.status)
    const data: any[] = (await res.json()) as any[]
    return data.map((t) => ({
      hash: t.hash,
      name: t.name,
      progress: t.progress,
      state: t.state,
      savePath: t.save_path,
      category: t.category,
      tags: t.tags,
    }))
  }

  /** 添加 magnet */
  async addMagnet(magnet: string, opts: { savePath?: string; category?: string; tags?: string; paused?: boolean } = {}): Promise<void> {
    if (!this.cookie) await this.login()
    const body: Record<string, string> = { urls: magnet }
    if (opts.savePath) body.savepath = opts.savePath
    if (opts.category) body.category = opts.category
    if (opts.tags) body.tags = opts.tags
    if (opts.paused) body.paused = 'true'
    const res = await this.req('/api/v2/torrents/add', body)
    if (!res.ok) throw new Error('qB add HTTP ' + res.status + ' ' + (await res.text()))
  }

  /** 添加 RSS 订阅源（409 = 已存在，幂等成功） */
  async addRssFeed(url: string, path = ''): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/rss/addFeed', { url, path })
    if (!res.ok && res.status !== 409) throw new Error('qB rss addFeed HTTP ' + res.status + ' ' + (await res.text()))
  }

  /** 移除 RSS 订阅源（qB v5 用 path 参数，值为 feed 条目的面板路径） */
  async removeRssFeed(itemPath: string): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/rss/removeItem', { path: itemPath })
    // 404/409 = 项目不存在/无法移除，视为已清理
    if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error('qB rss removeItem HTTP ' + res.status)
  }

  /** 增/改一条 RSS 下载规则 */
  async setRssRule(name: string, def: Record<string, unknown>): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/rss/setRule', { ruleName: name, ruleDef: JSON.stringify(def) })
    if (!res.ok) throw new Error('qB rss setRule HTTP ' + res.status + ' ' + (await res.text()))
  }

  /** 删除 RSS 规则 */
  async removeRssRule(name: string): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/rss/removeRule', { ruleName: name })
    // 404 = 已不存在，视为成功
    if (!res.ok && res.status !== 404) throw new Error('qB rss removeRule HTTP ' + res.status)
  }

  /** 创建分类（含 savePath）；已存在时幂等（qB 自动建中间层级） */
  async createCategory(category: string, savePath?: string): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/torrents/createCategory', { category, ...(savePath ? { savePath } : {}) })
    if (!res.ok && res.status !== 409) throw new Error('qB createCategory HTTP ' + res.status)
  }

  /** 修改单个任务分类 */
  async setTorrentCategory(hashes: string, category: string): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/torrents/setCategory', { hashes, category })
    if (!res.ok && res.status !== 409) throw new Error('qB setCategory HTTP ' + res.status)
  }

  /** 修改任务保存路径（contentLayout=Original 保留结构） */
  async setTorrentSavePath(hashes: string, savePath: string): Promise<void> {
    if (!this.cookie) await this.login()
    const res = await this.req('/api/v2/torrents/setSavePath', { hashes, savePath })
    if (!res.ok && res.status !== 409) throw new Error('qB setSavePath HTTP ' + res.status)
  }
}
