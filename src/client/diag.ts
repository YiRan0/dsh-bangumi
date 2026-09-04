/* 临时诊断模块：查番剧卡封面图/链接不可点根因。定位后删除。
 * ① 点击链路：捕获相标记疑似锚点点击，冒泡结束后上报 defaultPrevented 与
 *    链接中点处 hit-test 命中的真实元素（判断是否有透明覆盖层截胡）。
 * ② DOM 扫描：统计 vcp-root 内 <a>/<img> 实况（naturalWidth/渲染尺寸/load/error）。 */
export function installDiag(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined
  const post = (payload: unknown): void => {
    try {
      void fetch('/api/bangumi/dbg', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined)
    } catch {
      /* noop */
    }
  }
  let pendingAnchor: HTMLAnchorElement | null = null
  const onCap = (e: Event): void => {
    if (!(e instanceof MouseEvent)) return
    const el = e.target
    const a = el && 'closest' in el ? (el as HTMLElement).closest('a[href]') : null
    pendingAnchor = a as HTMLAnchorElement | null
  }
  const onWin = (e: Event): void => {
    if (!pendingAnchor) return
    const a = pendingAnchor
    pendingAnchor = null
    const r = a.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12))
    post({
      type: 'link-click',
      href: a.href,
      text: (a.textContent || '').slice(0, 60),
      defaultPrevented: e.defaultPrevented,
      targetAttr: a.getAttribute('target'),
      topmostAtCenter: at ? at.tagName + '.' + String(at.className).slice(0, 80) : null,
      topIsSelf: at === a || (at != null && a.contains(at)),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      inVcpRoot: !!a.closest('[id^="vcp-msg-"], [id="vcp-root"]'),
    })
  }
  document.addEventListener('click', onCap, true)
  window.addEventListener('click', onWin)

  const seenImgs = new WeakSet<HTMLImageElement>()
  let rounds = 0
  const scan = (): void => {
    rounds += 1
    // 渲染层把 #vcp-root 作用域化改写为 #vcp-msg-N：按特征全局扫（假阴性已核实）
    const cardA = Array.from(document.querySelectorAll('a[href*="bgm.tv"]'))
    const imgs = Array.from(document.querySelectorAll('img[src*="bangumi/cover"]'))
    const containerOf = (el: Element): string => {
      const host = el.closest('[id^="vcp-msg-"], [id="vcp-root"], [class*="vcp"]')
      return host ? host.tagName + '#' + host.id : ''
    }
    const imgInfo = imgs.map((im) => {
      const img = im as HTMLImageElement
      if (!seenImgs.has(img)) {
        seenImgs.add(img)
        img.addEventListener('load', () => post({ type: 'cover-img', ev: 'load', src: img.src.slice(0, 100), naturalWidth: img.naturalWidth }), { once: true })
        img.addEventListener('error', () => post({ type: 'cover-img', ev: 'error', src: img.src.slice(0, 100) }), { once: true })
      }
      return {
        src: img.src.slice(0, 110),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        rendered: img.offsetWidth + 'x' + img.offsetHeight,
        display: getComputedStyle(img).display,
      }
    })
    const winTyped = window as unknown as { __dshInput?: unknown }
    post({
      type: 'scan',
      round: rounds,
      url: location.pathname,
      totalLinks: document.querySelectorAll('a[href]').length,
      cardLinks: cardA.length,
      cardLinkHrefs: cardA.slice(0, 5).map((a) => (a as HTMLAnchorElement).href),
      cardLinkContainers: cardA.slice(0, 5).map((a) => containerOf(a)),
      imgs: imgInfo,
      imgContainers: imgs.slice(0, 5).map((im) => containerOf(im)),
      dshInput: typeof winTyped.__dshInput,
    })
    if (rounds >= 60) window.clearInterval(iv)
  }
  const iv = window.setInterval(scan, 4000)
  window.setTimeout(scan, 1500)
  post({ type: 'diag-boot', ua: navigator.userAgent, vcpStable: typeof (window as unknown as { __vcpStable?: unknown }).__vcpStable })
  return () => {
    window.clearInterval(iv)
    document.removeEventListener('click', onCap, true)
    window.removeEventListener('click', onWin)
  }
}
