window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-bangumi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_dom_client = require("react-dom/client");
		//#region src/client/diag.ts
		function installDiag() {
			if (typeof window === "undefined" || typeof document === "undefined") return () => void 0;
			const post = (payload) => {
				try {
					fetch("/api/bangumi/dbg", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload),
						keepalive: true
					}).catch(() => void 0);
				} catch {}
			};
			let pendingAnchor = null;
			const onCap = (e) => {
				if (!(e instanceof MouseEvent)) return;
				const el = e.target;
				pendingAnchor = el && "closest" in el ? el.closest("a[href]") : null;
			};
			const onWin = (e) => {
				if (!pendingAnchor) return;
				const a = pendingAnchor;
				pendingAnchor = null;
				const r = a.getBoundingClientRect();
				const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
				post({
					type: "link-click",
					href: a.href,
					text: (a.textContent || "").slice(0, 60),
					defaultPrevented: e.defaultPrevented,
					targetAttr: a.getAttribute("target"),
					topmostAtCenter: at ? at.tagName + "." + String(at.className).slice(0, 80) : null,
					topIsSelf: at === a || at != null && a.contains(at),
					rect: [
						Math.round(r.left),
						Math.round(r.top),
						Math.round(r.width),
						Math.round(r.height)
					],
					inVcpRoot: !!a.closest("[id^=\"vcp-msg-\"], [id=\"vcp-root\"]")
				});
			};
			document.addEventListener("click", onCap, true);
			window.addEventListener("click", onWin);
			const seenImgs = /* @__PURE__ */ new WeakSet();
			let rounds = 0;
			const scan = () => {
				rounds += 1;
				const cardA = Array.from(document.querySelectorAll("a[href*=\"bgm.tv\"]"));
				const imgs = Array.from(document.querySelectorAll("img[src*=\"bangumi/cover\"]"));
				const containerOf = (el) => {
					const host = el.closest("[id^=\"vcp-msg-\"], [id=\"vcp-root\"], [class*=\"vcp\"]");
					return host ? host.tagName + "#" + host.id : "";
				};
				const imgInfo = imgs.map((im) => {
					const img = im;
					if (!seenImgs.has(img)) {
						seenImgs.add(img);
						img.addEventListener("load", () => post({
							type: "cover-img",
							ev: "load",
							src: img.src.slice(0, 100),
							naturalWidth: img.naturalWidth
						}), { once: true });
						img.addEventListener("error", () => post({
							type: "cover-img",
							ev: "error",
							src: img.src.slice(0, 100)
						}), { once: true });
					}
					return {
						src: img.src.slice(0, 110),
						complete: img.complete,
						naturalWidth: img.naturalWidth,
						rendered: img.offsetWidth + "x" + img.offsetHeight,
						display: getComputedStyle(img).display
					};
				});
				const winTyped = window;
				post({
					type: "scan",
					round: rounds,
					url: location.pathname,
					totalLinks: document.querySelectorAll("a[href]").length,
					cardLinks: cardA.length,
					cardLinkHrefs: cardA.slice(0, 5).map((a) => a.href),
					cardLinkContainers: cardA.slice(0, 5).map((a) => containerOf(a)),
					imgs: imgInfo,
					imgContainers: imgs.slice(0, 5).map((im) => containerOf(im)),
					dshInput: typeof winTyped.__dshInput
				});
				if (rounds >= 60) window.clearInterval(iv);
			};
			const iv = window.setInterval(scan, 4e3);
			window.setTimeout(scan, 1500);
			post({
				type: "diag-boot",
				ua: navigator.userAgent,
				vcpStable: typeof window.__vcpStable
			});
			return () => {
				window.clearInterval(iv);
				document.removeEventListener("click", onCap, true);
				window.removeEventListener("click", onWin);
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-bangumi — client：侧边栏「追番」入口 + 对话列整页视图（4 Tab）。
		* 交互模型仿 dsh-mnemon：入口按钮 DOM 自愈放置于侧边栏（记忆入口下方），
		* 点击后对话列切换为独立整页面板；与 mnemon / taskboard / ssh 面板互斥。
		* 数据通道：fetch("/api/bangumi/...") 直连 host REST（无需 RPC）。
		* React 来自客户端外部化模块（tsdown neverBundle react / react-dom）。
		*/
		const inject = ["slots"];
		const zh = {
			title: "追番",
			subscriptions: "订阅",
			calendar: "日历",
			search: "检索",
			library: "媒体库",
			settings: "设置",
			loading: "加载中…",
			refresh: "刷新",
			remove: "退订",
			confirmRemove: "确认退订？",
			total: "总集数",
			downloaded: "已下载",
			libraryHit: "本地已有",
			source: "来源",
			noSubs: "暂无订阅——到「检索」里搜索番剧并订阅",
			searchPlaceholder: "番名（中日文皆可）…",
			searchRun: "搜索",
			subscribeDmhy: "订阅(dmhy)",
			subscribeNyaa: "订阅(nyaa)",
			localEps: "本地已有集数",
			score: "匹配分",
			download: "下载",
			downloadedMark: "已入列",
			episodes: "集",
			firstAir: "首播",
			close: "关闭",
			save: "保存",
			saved: "已保存并生效",
			qbUrl: "qB WebUI 地址",
			qbUser: "用户名",
			qbPass: "密码",
			category: "分类",
			tags: "标签",
			categoryRoot: "分类根（番剧归到 根/作品[/第N季]）",
			baseDir: "番剧保存根目录",
			qbSavePathNote: "（旧默认保存目录，分类留空时兜底）",
			savePath: "保存目录",
			mediaDirs: "媒体库目录（每行一个）",
			pollMinutes: "轮询间隔(分钟)",
			qbStatus: "qB 状态",
			scan: "立即扫描媒体库",
			scanning: "扫描中…",
			testConn: "测试连接",
			mon: "一",
			tue: "二",
			wed: "三",
			thu: "四",
			fri: "五",
			sat: "六",
			sun: "日",
			prev: "‹",
			next: "›",
			localEpShort: "本地",
			aired: "已放送",
			matchedNone: "（库中作品，未匹配番剧条目）",
			clickForDetail: "点击查看详情",
			subscribe: "订阅",
			subscribeTo: "去检索订阅",
			inLibrary: "库中集数",
			noSummary: "暂无简介",
			aiBox: "AI 判新（强介入）",
			aiEnabled: "启用 AI 判新",
			aiProvider: "模型供应商",
			aiModel: "模型",
			aiNone: "（未启用）",
			aiLoadingModels: "加载模型…",
			aiNote: "每轮判新 / 下载 / 媒体库扫描由 AI 把关；调用失败自动回退纯脚本。",
			proxyBox: "网络代理（外网请求出口）",
			proxyType: "代理类型",
			proxyNone: "不使用（直连）",
			proxyHttp: "HTTP",
			proxyHttps: "HTTPS",
			proxySocks5: "SOCKS5",
			proxyHost: "代理主机",
			proxyPort: "代理端口",
			proxyUser: "用户名（可选）",
			proxyPass: "密码（可选）",
			proxyTest: "测试代理",
			proxyTesting: "测试中…",
			proxyOk: "代理可用",
			proxyBad: "代理不可用",
			proxyNote: "影响 RSS 抓取 / 番剧检索 / 封面拉取等外网请求；qBittorrent（本机）不受影响。",
			viewDetail: "查看",
			backToResults: "‹ 返回结果",
			curMonth: "本月",
			retry: "重试",
			subBadge: "已订阅",
			doneBadge: "已追平",
			filterPh: "筛选作品…",
			missing: "缺",
			weekly: "周更",
			diary: "日记",
			diaryEmpty: "还没有活动记录——订阅检索、下载推送、扫描/联网失败都会记在这里",
			clearLogs: "清空日记",
			clearConfirm: "确认清空全部日记？",
			levelInfo: "信息",
			levelWarn: "提醒",
			levelError: "错误"
		};
		const en = {
			title: "Bangumi",
			subscriptions: "Subscriptions",
			calendar: "Calendar",
			search: "Search",
			library: "Library",
			settings: "Settings",
			loading: "Loading…",
			refresh: "Refresh",
			remove: "Remove",
			confirmRemove: "Confirm remove?",
			total: "Total",
			downloaded: "Downloaded",
			libraryHit: "Already in library",
			source: "Source",
			noSubs: "No subscriptions yet — search a show in the Search tab and subscribe",
			searchPlaceholder: "Show name…",
			searchRun: "Search",
			subscribeDmhy: "Subscribe (dmhy)",
			subscribeNyaa: "Subscribe (nyaa)",
			localEps: "Episodes already in library",
			score: "score",
			download: "Download",
			downloadedMark: "Queued",
			episodes: "eps",
			firstAir: "First air",
			close: "Close",
			save: "Save",
			saved: "Saved",
			qbUrl: "qB WebUI URL",
			qbUser: "Username",
			qbPass: "Password",
			category: "Category",
			tags: "Tags",
			categoryRoot: "Category root (shows land under root/title[/Sx])",
			baseDir: "Anime save root dir",
			qbSavePathNote: "(legacy fallback save path when category empty)",
			savePath: "Save path",
			mediaDirs: "Media library dirs (one per line)",
			pollMinutes: "Poll interval (min)",
			qbStatus: "qB status",
			scan: "Scan library now",
			scanning: "Scanning…",
			testConn: "Test connection",
			mon: "Mo",
			tue: "Tu",
			wed: "We",
			th: "Thu",
			fri: "Fr",
			sat: "Sa",
			sun: "Su",
			prev: "‹",
			next: "›",
			localEpShort: "Local",
			aired: "Aired",
			matchedNone: "（in library, no bgm match yet）",
			clickForDetail: "Click for details",
			subscribe: "Subscribe",
			subscribeTo: "Subscribe via Search",
			inLibrary: "In library",
			noSummary: "No summary",
			aiBox: "AI gate (strong)",
			aiEnabled: "Enable AI judging",
			aiProvider: "Provider",
			aiModel: "Model",
			aiNone: "(disabled)",
			aiLoadingModels: "Loading models…",
			aiNote: "AI reviews each poll / download / library scan; falls back to script on failure.",
			proxyBox: "Network proxy (outbound requests)",
			proxyType: "Proxy type",
			proxyNone: "None (direct)",
			proxyHttp: "HTTP",
			proxyHttps: "HTTPS",
			proxySocks5: "SOCKS5",
			proxyHost: "Proxy host",
			proxyPort: "Proxy port",
			proxyUser: "Username (optional)",
			proxyPass: "Password (optional)",
			proxyTest: "Test proxy",
			proxyTesting: "Testing…",
			proxyOk: "Proxy OK",
			proxyBad: "Proxy failed",
			proxyNote: "Applies to RSS / search / covers etc. qBittorrent (local) is unaffected.",
			viewDetail: "View",
			backToResults: "‹ Back to results",
			curMonth: "This month",
			retry: "Retry",
			subBadge: "Subscribed",
			doneBadge: "Caught up",
			filterPh: "Filter works…",
			missing: "Missing",
			weekly: "weekly",
			diary: "Diary",
			diaryEmpty: "No activity yet — subscribes, downloads, scan/API failures land here",
			clearLogs: "Clear diary",
			clearConfirm: "Clear all diary entries?",
			levelInfo: "info",
			levelWarn: "warn",
			levelError: "error"
		};
		const isZh = typeof navigator !== "undefined" && (navigator.language || "").toLowerCase().startsWith("zh");
		const t = isZh ? zh : en;
		const api = {
			async get(path) {
				const res = await fetch("/api/bangumi" + path);
				const body = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
				return body;
			},
			async post(path, payload) {
				const res = await fetch("/api/bangumi" + path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload ?? {})
				});
				const body = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
				return body;
			}
		};
		const ENTRY_ICON_SVG = "<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"1.8\" y=\"2.6\" width=\"12.4\" height=\"8.2\" rx=\"1.6\"/><path d=\"M5.4 2.6 4.2 1M10.6 2.6l1.2-1.6M6.2 10.8v2.6M9.8 10.8v2.6M4 13.4h8\"/></svg>";
		var PanelController = class {
			snapshot = { open: false };
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.snapshot;
			subscribe = (l) => {
				this.listeners.add(l);
				return () => {
					this.listeners.delete(l);
				};
			};
			open = () => this.setOpen(true, true);
			close = () => this.setOpen(false);
			toggle = () => this.setOpen(!this.snapshot.open);
			setOpen(open, reassert = false) {
				if (this.snapshot.open === open && !reassert) return;
				this.snapshot = { open };
				for (const l of this.listeners) l();
			}
		};
		const SIDEBAR_SELECTOR = "[data-pane=\"sidebar\"], [class*=\"sidebarCol\"], .dshDesktopUpstreamSidebar";
		const CONVERSATION_SELECTOR = "[data-pane=\"conversation\"], [class*=\"centerCol\"], .dshDesktopConversationSurface";
		const SIDEBAR_CONTEXT_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const ENTRY_ATTR = "data-dsh-bangumi-entry";
		const ACTIVE_ATTR = "data-dsh-bangumi-active";
		const VIEW_ATTR = "data-dsh-bangumi-view";
		const OTHER_ACTIVES = [
			"data-dsh-taskboard-active",
			"data-dsh-ssh-active",
			"data-dsh-mnemon-active"
		];
		const FAMILY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [data-dsh-bangumi-entry]";
		function sidebarRoot() {
			const column = document.querySelector(SIDEBAR_SELECTOR);
			if (!(column instanceof HTMLElement)) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild ?? void 0;
		}
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested instanceof HTMLButtonElement) return nested;
			for (const child of root.children) if (child instanceof HTMLButtonElement) return child;
		}
		const CSS = [
			"[data-pane=\"conversation\"], [class*=\"centerCol\"], .dshDesktopConversationSurface{position:relative}",
			"[data-dsh-bangumi-view]{z-index:60;background:var(--dsw-alias-bg-base);min-width:0;min-height:0;display:none;position:absolute;inset:0;overflow:hidden;flex-direction:column}",
			"html[data-dsh-bangumi-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [data-dsh-bangumi-view]{display:flex}",
			"html[data-dsh-bangumi-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [data-pane=\"conversation\"]>:not([data-dsh-bangumi-view]),html[data-dsh-bangumi-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) [class*=\"centerCol\"]>:not([data-dsh-bangumi-view]),html[data-dsh-bangumi-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-mnemon-active]) .dshDesktopConversationSurface>:not([data-dsh-bangumi-view]){display:none!important}",
			".bg_entry{box-sizing:border-box;width:100%;min-height:36px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:none;border:none;border-radius:8px;align-items:center;gap:10px;padding:0 10px;font-size:13px;display:flex;font-family:inherit}",
			".bg_entry:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".bg_entry[data-dsh-bangumi-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);font-weight:600}",
			".bg_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex}",
			".bg_entryIcon svg{width:18px;height:18px;display:block}",
			".bg_entryLabel{text-overflow:ellipsis;overflow:hidden}",
			"[data-dsh-frame][data-sidebar-collapsed] .bg_entry{border-radius:50%;justify-content:center;width:36px;min-height:36px;margin:0 auto;padding:0}",
			"[data-dsh-frame][data-sidebar-collapsed] .bg_entryLabel{display:none}",
			".bg_page{flex:1;min-height:0;display:flex;flex-direction:column}",
			".bg_head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".bg_title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary)}",
			".bg_tabs{display:flex;gap:2px;flex:1}",
			".bg_tab{appearance:none;border:0;background:none;font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
			".bg_tabOn{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}",
			".bg_close{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
			".bg_view{flex:1;min-height:0;overflow:auto;padding:14px 16px}",
			".bg_rows{display:flex;flex-direction:column;gap:8px}",
			".bg_subToolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}",
			".bg_subCount{font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".bg_subToolbar .bg_btn{padding:3px 10px;font-size:11px}",
			".bg_row{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}",
			".bg_rowMain{flex:1;min-width:0}",
			".bg_rowTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".bg_rowSub{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
			".bg_hitRow{margin-top:5px}",
			".bg_prog{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
			".bg_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}",
			".bg_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".bg_btn.danger{border-color:#ef4444;color:#ef4444}",
			".bg_empty{font-size:13px;color:var(--dsw-alias-label-tertiary);padding:16px 4px}",
			".bg_err{margin:0 0 8px;font-size:12px;color:#ef4444;white-space:pre-wrap}",
			".bg_search{display:flex;gap:8px;margin-bottom:12px}",
			".bg_input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px}",
			".bg_subject{padding:10px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}",
			".bg_hit{display:inline-block;font-size:11px;color:#059669;background:rgba(5,150,105,.12);border-radius:6px;padding:2px 8px}",
			".bg_torrent{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-bottom:6px}",
			".bg_tTitle{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".bg_chip{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;white-space:nowrap}",
			".bg_chip.local{color:#059669;border-color:#059669}",
			".bg_field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}",
			".bg_label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".bg_textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px 10px;min-height:72px;resize:vertical}",
			".bg_grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}",
			".bg_select{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px}",
			".bg_aiBox{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:12px;margin-top:14px}",
			".bg_aiBox h4{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".bg_aiRow{display:flex;align-items:center;gap:10px;margin-bottom:10px}",
			".bg_aiRow .bg_label{flex:none;width:84px}",
			".bg_aiRow .bg_select{flex:1}",
			".bg_aiNote{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
			".bg_aiToggle{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".bg_aiToggle input{width:15px;height:15px;accent-color:#0e7490}",
			".bg_cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}",
			".bg_calHead{font-size:11px;text-align:center;color:var(--dsw-alias-label-tertiary);padding:4px 0}",
			".bg_cell{min-height:72px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 6px;overflow:hidden}",
			".bg_cellDim{opacity:.35}",
			".bg_cellToday{border-color:var(--dsw-alias-brand-primary)}",
			".bg_dayNum{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".bg_item{font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".bg_calBar{display:flex;align-items:center;gap:8px;margin-bottom:10px}",
			".bg_calLabel{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".bg_libToolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px}",
			".bg_libCount{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1}",
			".bg_posters{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:12px}",
			".bg_poster{display:flex;flex-direction:column;gap:6px;background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;min-width:0}",
			".bg_poster:hover .bg_posterImg{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.18)}",
			".bg_posterImg{aspect-ratio:2/3;width:100%;object-fit:cover;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 2px 6px rgba(0,0,0,.1);transition:transform .15s ease,box-shadow .15s ease}",
			".bg_posterPh{aspect-ratio:2/3;width:100%;display:flex;align-items:center;justify-content:center;border-radius:8px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:34px;font-weight:600}",
			".bg_posterName{font-size:12px;line-height:15px;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}",
			".bg_posterMeta{font-size:10px;color:var(--dsw-alias-label-tertiary);display:flex;gap:6px;align-items:center;flex-wrap:nowrap}",
			".bg_pdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}",
			".bg_pdot.sub{background:#059669}",
			".bg_badge{display:inline-block;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
			".bg_overlay{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}",
			".bg_modal{width:min(560px,94vw);max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:18px;display:flex;flex-direction:column;gap:12px}",
			".bg_mHead{display:flex;gap:14px}",
			".bg_mCover{width:120px;height:170px;object-fit:cover;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);flex:none}",
			".bg_mPh{width:120px;height:170px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:44px;font-weight:600;flex:none}",
			".bg_mTitle{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary);line-height:1.35}",
			".bg_mSub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px 10px}",
			".bg_mStats{display:flex;gap:8px;margin-top:10px}",
			".bg_mStat{flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;text-align:center;background:var(--dsw-alias-bg-layer-2)}",
			".bg_mStat b{display:block;font-size:15px;color:var(--dsw-alias-label-primary)}",
			".bg_mStat span{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
			".bg_mDesc{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:180px;overflow:auto}",
			".bg_mFoot{display:flex;gap:8px;justify-content:flex-end;align-items:center}",
			".bg_mSubBadge{font-size:11px;color:#059669;background:rgba(5,150,105,.12);border-radius:6px;padding:3px 8px;margin-right:auto}",
			".bg_mProgRow{display:flex;flex-direction:column;gap:5px;margin-top:2px}",
			".bg_mProg{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
			".bg_pTrack{display:block;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;position:relative;margin-top:2px}",
			".bg_pTrack .fa{position:absolute;left:0;top:0;bottom:0;background:#9a6700}",
			".bg_pTrack .fd{position:absolute;left:0;top:0;bottom:0;background:#0a7d33}",
			".bg_logRow{display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-line-normal,rgba(128,128,128,.14));font-size:12px;line-height:1.5}",
			".bg_logTs{flex:none;width:132px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".bg_logLvl{flex:none;width:44px;text-align:center;border-radius:6px;font-size:10px;padding:1px 0;margin-top:1px}",
			".bg_logLvl.info{background:rgba(59,130,246,.14);color:#3b82f6}",
			".bg_logLvl.warn{background:rgba(217,119,6,.15);color:#d97706}",
			".bg_logLvl.error{background:rgba(220,38,38,.14);color:#dc2626}",
			".bg_logMsg{flex:1;min-width:0;word-break:break-all;color:var(--dsw-alias-label-primary)}",
			".bg_mProg .lab{flex:none;width:40px;text-align:right;color:var(--dsw-alias-label-tertiary)}",
			".bg_mProg .tr{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}",
			".bg_mProg .tr .fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-accent,#3b82f6)}",
			".bg_mProg .tr .fill.air{background:#9a6700}",
			".bg_mProg .tr .fill.dl{background:#0a7d33}",
			".bg_mProg .n{flex:none;font-variant-numeric:tabular-nums}",
			".bg_row{transition:box-shadow .15s ease,transform .15s ease}",
			".bg_row:hover{box-shadow:0 4px 14px rgba(0,0,0,.08);transform:translateY(-1px)}",
			".bg_cardCover{width:54px;height:78px;object-fit:cover;border-radius:8px;flex:none;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}",
			".bg_cardCoverPh{width:54px;height:78px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:var(--dsw-alias-label-tertiary);background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px dashed var(--dsw-alias-border-l2)}",
			".bg_srcTag{font-size:10px;line-height:1;padding:3px 7px;border-radius:6px;font-weight:600;letter-spacing:.4px}",
			".bg_srcTag.dmhy{background:rgba(59,130,246,.13);color:#3b82f6}",
			".bg_srcTag.nyaa{background:rgba(139,92,246,.13);color:#8b5cf6}",
			".bg_wd{font-size:10px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 5px}",
			".bg_miss{display:inline-flex;gap:3px;flex-wrap:wrap;vertical-align:middle}",
			".bg_miss b{font-weight:600;font-size:10px;line-height:1;padding:2px 5px;border-radius:4px;background:rgba(220,38,38,.12);color:#dc2626}",
			".bg_subBar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;margin-top:6px;max-width:220px}",
			".bg_subBar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#34d399,#059669);transition:width .3s ease}",
			".bg_subPct{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}",
			".bg_tabs{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:2px}",
			".bg_tabOn{background:var(--dsw-alias-bg-base,rgba(255,255,255,.9));box-shadow:0 1px 3px rgba(0,0,0,.12)}",
			".bg_skel{border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1) 25%,var(--dsw-alias-bg-layer-2) 50%,var(--dsw-alias-bg-layer-1) 75%);background-size:200% 100%;animation:bgShine 1.2s linear infinite}",
			"@keyframes bgShine{0%{background-position:200% 0}100%{background-position:-200% 0}}",
			".bg_skelRow{height:96px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}",
			".bg_cellWknd{background:var(--dsw-alias-bg-layer-2)}",
			".bg_dotToday{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary,#0e7490);margin-left:4px;vertical-align:2px}",
			".bg_calItem{display:block;font-size:10.5px;line-height:14px;padding:1px 4px;border-radius:4px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:3px solid #3b82f6;background:rgba(59,130,246,.1);color:var(--dsw-alias-label-primary)}",
			".bg_calItem.nyaa{border-left-color:#8b5cf6;background:rgba(139,92,246,.1)}",
			".bg_poster{position:relative}",
			".bg_corner{position:absolute;z-index:2;font-size:10px;font-weight:700;line-height:1;padding:3px 6px;border-radius:6px;color:#fff;letter-spacing:.3px}",
			".bg_corner.sub{top:6px;left:6px;background:rgba(5,150,105,.92)}",
			".bg_corner.done{top:6px;right:6px;background:rgba(15,23,42,.82)}",
			".bg_mBannerWrap{position:relative;height:104px;margin:-18px -18px 12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border-radius:14px 14px 0 0;flex:none}",
			".bg_mBannerWrap img{position:absolute;inset:-14px;width:calc(100% + 28px);height:calc(100% + 28px);object-fit:cover;filter:blur(16px) saturate(1.15);opacity:.9}",
			".bg_mBannerWrap i{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.05),rgba(0,0,0,.38) 72%)}",
			".bg_mBannerWrap b{position:absolute;left:16px;bottom:10px;right:16px;font-size:16px;font-weight:700;color:#fff;line-height:1.3;text-shadow:0 1px 4px rgba(0,0,0,.45);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}"
		].join("\n");
		function useCss() {
			react.useEffect(() => {
				const style = document.createElement("style");
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, []);
		}
		const h = react.createElement;
		function CoverSm(props) {
			const [bad, setBad] = react.useState(false);
			if (!props.cover || bad) return h("div", { className: "bg_cardCoverPh" }, props.letter);
			return h("img", {
				className: "bg_cardCover",
				src: props.cover,
				alt: "",
				loading: "lazy",
				draggable: false,
				onError: () => setBad(true)
			});
		}
		function Skeleton(props) {
			return h("div", { className: "bg_rows" }, Array.from({ length: props.rows }, (_, i) => h("div", {
				key: i,
				className: "bg_skelRow bg_skel"
			})));
		}
		function ErrBox(props) {
			return h("div", { className: "bg_err" }, props.msg, props.retry ? h("button", {
				className: "bg_btn",
				style: { marginLeft: "8px" },
				onClick: props.retry
			}, t.retry) : null);
		}
		const WD = [
			t.sun,
			t.mon,
			t.tue,
			t.wed,
			t.thu,
			t.fri,
			t.sat
		];
		function Subscriptions() {
			const [rows, setRows] = react.useState(null);
			const [err, setErr] = react.useState("");
			const [confirming, setConfirming] = react.useState(null);
			const load = react.useCallback(async () => {
				try {
					setRows((await api.get("/subscriptions")).subscriptions);
				} catch (e) {
					setErr(String(e.message ?? e));
				}
			}, []);
			react.useEffect(() => {
				load();
			}, [load]);
			if (err) return ErrBox({
				msg: err,
				retry: () => {
					setErr("");
					load();
				}
			});
			if (!rows) return h(Skeleton, { rows: 3 });
			if (!rows.length) return h("div", { className: "bg_empty" }, t.noSubs);
			return h("div", { className: "bg_rows" }, h("div", { className: "bg_subToolbar" }, h("span", { className: "bg_subCount" }, String(rows.length) + " " + t.subscriptions), h("button", {
				className: "bg_btn",
				onClick: () => void load()
			}, t.refresh)), rows.map((r) => {
				const total = r.totalEpisodes;
				const dl = r.progress?.downloaded;
				const pct = total && dl !== void 0 ? Math.min(Math.round(dl / total * 100), 100) : null;
				const missing = r.progress?.missing ?? [];
				const libCount = r.progress?.library.length ?? 0;
				const unsub = () => {
					api.post("/subscriptions/delete", { id: r.id }).then(() => {
						setConfirming(null);
						return load();
					}).catch((e) => setErr(String(e)));
				};
				const askAgain = () => {
					setConfirming(r.id);
					setTimeout(() => setConfirming((c) => c === r.id ? null : c), 3e3);
				};
				return h("div", {
					key: r.id,
					className: "bg_row"
				}, h(CoverSm, {
					cover: r.cover,
					letter: (r.nameCn || r.name || "?").slice(0, 1).toUpperCase()
				}), h("div", { className: "bg_rowMain" }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "6px",
					minWidth: 0
				} }, h("span", {
					className: "bg_rowTitle",
					style: { flex: 1 }
				}, r.nameCn || r.name), h("span", { className: "bg_srcTag " + r.source }, r.source.toUpperCase()), r.weekday !== void 0 ? h("span", { className: "bg_wd" }, t.weekly + WD[r.weekday]) : null), h("div", { className: "bg_rowSub" }, t.firstAir + " " + (r.airDate ?? "?"), libCount > 0 ? " · " + t.libraryHit + " " + libCount + t.episodes : "", missing.length ? h("span", {
					className: "bg_miss",
					style: { marginLeft: "6px" }
				}, t.missing + " ", missing.slice(0, 12).map((ep) => h("b", { key: ep }, String(ep))), missing.length > 12 ? h("b", null, "…") : null) : null), pct !== null ? h("div", { className: "bg_subBar" }, h("i", { style: { width: pct + "%" } })) : null), h("div", {
					className: "bg_prog",
					style: { textAlign: "right" }
				}, String(dl ?? "?") + " / " + String(total ?? "?"), pct !== null ? h("div", { className: "bg_subPct" }, pct + "%") : null), confirming === r.id ? h("button", {
					className: "bg_btn danger",
					style: {
						background: "#ef4444",
						color: "#fff",
						borderColor: "#ef4444"
					},
					onClick: unsub
				}, t.confirmRemove) : h("button", {
					className: "bg_btn danger",
					onClick: askAgain
				}, t.remove));
			}));
		}
		function Calendar() {
			const now = /* @__PURE__ */ new Date();
			const [month, setMonth] = react.useState({
				y: now.getFullYear(),
				m: now.getMonth() + 1
			});
			const [data, setData] = react.useState(null);
			const [err, setErr] = react.useState("");
			react.useEffect(() => {
				setErr("");
				setData(null);
				api.get("/calendar?year=" + month.y + "&month=" + month.m).then((r) => {
					const map = {};
					for (const day of r.calendar ?? []) map[day.date] = day.items;
					setData(map);
				}).catch((e) => setErr(String(e.message ?? e)));
			}, [month]);
			const days = new Date(month.y, month.m, 0).getDate();
			const firstWeekday = new Date(month.y, month.m - 1, 1).getDay();
			const monthEmpty = data !== null && !Object.keys(data).length;
			const cells = [];
			const heads = [
				t.sun,
				t.mon,
				t.tue,
				t.wed,
				t.thu,
				t.fri,
				t.sat
			];
			for (let i = 0; i < firstWeekday; i += 1) cells.push(h("div", {
				key: "x" + i,
				className: "bg_cell bg_cellDim"
			}));
			for (let d = 1; d <= days; d += 1) {
				const iso = month.y + "-" + String(month.m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
				const items = data?.[iso] ?? [];
				const isToday = d === now.getDate() && month.m === now.getMonth() + 1 && month.y === now.getFullYear();
				const wknd = new Date(month.y, month.m - 1, d).getDay() % 6 === 0;
				cells.push(h("div", {
					key: iso,
					className: "bg_cell" + (isToday ? " bg_cellToday" : "") + (wknd ? " bg_cellWknd" : "")
				}, h("div", { className: "bg_dayNum" }, String(d), isToday ? h("span", { className: "bg_dotToday" }) : null), items.map((it, i) => h("div", {
					key: i,
					className: "bg_calItem" + (it.source === "nyaa" ? " nyaa" : ""),
					title: (it.nameCn || it.name) + (it.episode ? " EP" + it.episode : "")
				}, (it.nameCn || it.name) + (it.episode ? " EP" + it.episode : "")))));
			}
			return h("div", null, h("div", { className: "bg_calBar" }, h("button", {
				className: "bg_btn",
				onClick: () => setMonth((p) => {
					const d = new Date(p.y, p.m - 2, 1);
					return {
						y: d.getFullYear(),
						m: d.getMonth() + 1
					};
				})
			}, t.prev), h("div", { className: "bg_calLabel" }, month.y + "/" + String(month.m).padStart(2, "0")), h("button", {
				className: "bg_btn",
				onClick: () => setMonth((p) => {
					const d = new Date(p.y, p.m, 1);
					return {
						y: d.getFullYear(),
						m: d.getMonth() + 1
					};
				})
			}, t.next), h("button", {
				className: "bg_btn",
				onClick: () => setMonth({
					y: now.getFullYear(),
					m: now.getMonth() + 1
				})
			}, t.curMonth)), err ? ErrBox({
				msg: err,
				retry: () => setMonth((m0) => ({ ...m0 }))
			}) : null, data === null && !err ? h(Skeleton, { rows: 5 }) : null, monthEmpty ? h("div", {
				className: "bg_empty",
				style: { padding: "6px 2px 12px" }
			}, isZh ? "本月暂无放送安排——去「检索」订阅更多番剧" : "Nothing airs this month — subscribe more shows in Search") : null, data !== null ? h("div", { className: "bg_cal" }, heads.map((wd, i) => h("div", {
				key: i,
				className: "bg_calHead"
			}, wd)), cells) : null);
		}
		function SearchTab() {
			const [kw, setKw] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [results, setResults] = react.useState(null);
			const [subIds, setSubIds] = react.useState(null);
			const [detail, setDetail] = react.useState(null);
			const [err, setErr] = react.useState("");
			const [doneMagnet, setDoneMagnet] = react.useState({});
			const run = () => {
				if (!kw.trim()) return;
				setBusy(true);
				setErr("");
				setDetail(null);
				api.get("/bangumi-search?q=" + encodeURIComponent(kw)).then((r) => setResults(r.results ?? [])).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
				api.get("/subscriptions").then((r) => setSubIds(new Set((r.subscriptions ?? []).map((s) => s.bangumiId)))).catch(() => void 0);
			};
			const pick = (id) => {
				setBusy(true);
				setErr("");
				api.get("/search?bangumiId=" + id + "&source=both").then((r) => setDetail({
					subject: r.subject,
					localEpisodes: r.localEpisodes ?? [],
					items: r.items ?? []
				})).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
			};
			const subscribe = (source) => {
				if (!detail) return;
				setErr("");
				api.post("/subscriptions", {
					bangumiId: detail.subject.id,
					source
				}).then(() => {
					setDetail(null);
					setResults(null);
				}).catch((e) => setErr(String(e.message ?? e)));
			};
			const localSet = new Set(detail?.localEpisodes ?? []);
			return h("div", null, h("div", { className: "bg_search" }, h("input", {
				className: "bg_input",
				value: kw,
				placeholder: t.searchPlaceholder,
				onChange: (e) => setKw(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") run();
				}
			}), h("button", {
				className: "bg_btn",
				onClick: run,
				disabled: busy
			}, busy ? t.loading : t.searchRun)), err ? h("div", { className: "bg_err" }, err) : null, results && !detail ? h("div", { className: "bg_rows" }, results.map((s) => {
				const sImg = s.images?.common ?? s.images?.large;
				return h("div", {
					key: s.id,
					className: "bg_row"
				}, h(CoverSm, {
					cover: sImg ? "/api/bangumi/cover?u=" + encodeURIComponent(sImg) : void 0,
					letter: (s.nameCn || s.name || "?").slice(0, 1).toUpperCase()
				}), h("div", { className: "bg_rowMain" }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "6px"
				} }, h("span", {
					className: "bg_rowTitle",
					style: { flex: 1 }
				}, s.nameCn || s.name), subIds?.has(s.id) ? h("span", { className: "bg_hit" }, t.subBadge) : null), h("div", { className: "bg_rowSub" }, t.firstAir + " " + (s.airDate ?? "?") + " · " + (s.totalEpisodes ?? "?") + " " + t.episodes)), h("button", {
					className: "bg_btn",
					onClick: () => pick(s.id)
				}, t.viewDetail));
			})) : null, detail ? h("div", null, h("div", { style: { marginBottom: "10px" } }, h("button", {
				className: "bg_btn",
				onClick: () => setDetail(null)
			}, t.backToResults)), h("div", { className: "bg_subject" }, h("div", { className: "bg_rowTitle" }, detail.subject.nameCn || detail.subject.name), h("div", { className: "bg_rowSub" }, t.firstAir + " " + (detail.subject.airDate ?? "?") + " · " + (detail.subject.totalEpisodes ?? "?") + " " + t.episodes, detail.localEpisodes.length ? " · " + t.localEps + ": " + detail.localEpisodes.join(",") : " · " + t.localEps + ": —"), h("div", { style: {
				display: "flex",
				gap: "8px",
				marginTop: "8px"
			} }, h("button", {
				className: "bg_btn",
				onClick: () => subscribe("dmhy")
			}, t.subscribeDmhy), h("button", {
				className: "bg_btn",
				onClick: () => subscribe("nyaa")
			}, t.subscribeNyaa))), detail.items.slice(0, 40).map((it, i) => h("div", {
				key: i,
				className: "bg_torrent"
			}, h("div", {
				className: "bg_tTitle",
				title: it.title
			}, it.title), h("span", { className: "bg_chip" }, t.score + " " + it.score), it.resolution ? h("span", { className: "bg_chip" }, it.resolution) : null, it.group ? h("span", { className: "bg_chip" }, it.group) : null, it.episode !== void 0 && localSet.has(it.episode) ? h("span", { className: "bg_chip local" }, "⬇ " + t.libraryHit + " EP" + it.episode) : null, typeof it.seeders === "number" ? h("span", {
				className: "bg_chip",
				style: it.seeders >= 20 ? {
					color: "#059669",
					borderColor: "#059669"
				} : it.seeders >= 5 ? {
					color: "#b45309",
					borderColor: "#b45309"
				} : void 0
			}, "🌱" + it.seeders) : null, h("button", {
				className: "bg_btn",
				disabled: !it.magnet || !!doneMagnet[it.title],
				onClick: () => {
					if (!it.magnet) return;
					api.post("/download", {
						magnet: it.magnet,
						title: it.title,
						bangumiId: detail.subject.id
					}).then(() => setDoneMagnet((m) => ({
						...m,
						[it.title]: true
					}))).catch((e) => setErr(String(e.message ?? e)));
				}
			}, doneMagnet[it.title] ? t.downloadedMark : t.download)))) : null);
		}
		function SettingsTab() {
			const [cfg, setCfg] = react.useState(null);
			const [err, setErr] = react.useState("");
			const [saved, setSaved] = react.useState(false);
			const [scanning, setScanning] = react.useState(false);
			const [qb, setQb] = react.useState(null);
			const [dirsText, setDirsText] = react.useState("");
			const [proxyTest, setProxyTest] = react.useState(null);
			const [providers, setProviders] = react.useState(null);
			const [models, setModels] = react.useState([]);
			const [modelsProvider, setModelsProvider] = react.useState("");
			const [loadingModels, setLoadingModels] = react.useState(false);
			const loadModels = react.useCallback((provider) => {
				setLoadingModels(true);
				setModelsProvider(provider);
				api.get("/settings/models?provider=" + encodeURIComponent(provider)).then((r) => setModels(r.models?.models ?? [])).catch(() => setModels([])).finally(() => setLoadingModels(false));
			}, []);
			react.useEffect(() => {
				api.get("/settings?models=1").then((r) => {
					setCfg(r.settings);
					setDirsText((r.settings.mediaDirs ?? []).join("\n"));
					const pv = r.models?.providers ?? [];
					if (pv.length) {
						setProviders(pv);
						const cur = r.settings.aiProvider || pv[0].id;
						setModelsProvider(cur);
						loadModels(cur);
					} else {
						setProviders(null);
						setLoadingModels(false);
					}
				}).catch((e) => setErr(String(e.message ?? e)));
				api.get("/qb/status").then(setQb).catch((e) => setQb({
					ok: false,
					error: String(e?.message ?? e)
				}));
			}, [loadModels]);
			const update = (k, v) => setCfg((c) => ({
				...c,
				[k]: v
			}));
			const save = () => {
				setErr("");
				setSaved(false);
				const payload = {
					...cfg,
					mediaDirs: dirsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
				};
				api.post("/settings", payload).then((r) => {
					setCfg(r.settings);
					setDirsText((r.settings.mediaDirs ?? []).join("\n"));
					setSaved(true);
				}).catch((e) => setErr(String(e.message ?? e)));
			};
			if (!cfg) return h(Skeleton, { rows: 3 });
			const field = (label, key, type = "text") => h("label", {
				key,
				className: "bg_field"
			}, h("span", { className: "bg_label" }, label), h("input", {
				className: "bg_input",
				type,
				value: cfg[key] ?? "",
				onChange: (e) => update(key, e.target.value)
			}));
			return h("div", null, err ? h("div", { className: "bg_err" }, err) : null, h("div", { className: "bg_grid" }, field(t.qbUrl, "qbUrl"), field(t.qbUser, "qbUsername"), field(t.qbPass, "qbPassword", "password"), field(t.categoryRoot, "qbCategoryRoot"), field(t.baseDir, "qbBaseDir"), field(t.tags, "qbTags"), field(t.savePath, "qbSavePath"), field(t.pollMinutes, "pollIntervalMinutes", "number")), h("label", { className: "bg_field" }, h("span", { className: "bg_label" }, t.mediaDirs), h("textarea", {
				className: "bg_textarea",
				value: dirsText,
				rows: Math.max(3, dirsText.split("\n").length),
				onChange: (e) => setDirsText(e.target.value)
			})), h("div", { style: {
				display: "flex",
				gap: "8px",
				alignItems: "center"
			} }, h("button", {
				className: "bg_btn",
				onClick: save
			}, t.save), saved ? h("span", { className: "bg_chip local" }, t.saved) : null, h("button", {
				className: "bg_btn",
				disabled: scanning,
				onClick: () => {
					setScanning(true);
					api.post("/library/scan", {}).catch(() => void 0).finally(() => setScanning(false));
				}
			}, scanning ? t.scanning : t.scan), h("button", {
				className: "bg_btn",
				onClick: () => void api.get("/qb/status").then(setQb).catch((e) => setQb({
					ok: false,
					error: String(e?.message ?? e)
				}))
			}, t.testConn)), qb ? h("div", {
				className: "bg_rowSub",
				style: { marginTop: "10px" }
			}, t.qbStatus + ": " + (qb.ok ? "OK (" + (qb.version ?? "?") + ")" : "✕ " + (qb.error ?? "fail"))) : null, h("div", { className: "bg_aiBox" }, h("h4", null, t.proxyBox), h("div", { className: "bg_aiRow" }, h("span", { className: "bg_label" }, t.proxyType), h("select", {
				className: "bg_select",
				value: cfg.proxyType || "none",
				onChange: (e) => update("proxyType", e.target.value)
			}, [
				"none",
				"http",
				"https",
				"socks5"
			].map((v) => h("option", {
				key: v,
				value: v
			}, v === "none" ? t.proxyNone : v === "http" ? t.proxyHttp : v === "https" ? t.proxyHttps : t.proxySocks5)))), cfg.proxyType && cfg.proxyType !== "none" ? h("div", { className: "bg_grid" }, field(t.proxyHost, "proxyHost"), field(t.proxyPort, "proxyPort", "number"), field(t.proxyUser, "proxyUsername"), field(t.proxyPass, "proxyPassword", "password")) : null, h("div", { style: {
				display: "flex",
				gap: "8px",
				alignItems: "center"
			} }, h("button", {
				className: "bg_btn",
				disabled: !!proxyTest?.running || (cfg.proxyType || "none") === "none",
				onClick: () => {
					setProxyTest({ running: true });
					api.get("/proxy/test").then((r) => {
						setProxyTest({
							ok: r.ok,
							ms: r.ms,
							status: r.status,
							error: r.error
						});
					}).catch((e) => setProxyTest({
						ok: false,
						error: String(e.message ?? e)
					}));
				}
			}, proxyTest?.running ? t.proxyTesting : t.proxyTest), proxyTest && !proxyTest.running ? h("span", {
				className: proxyTest.ok ? "bg_chip local" : "bg_chip",
				style: proxyTest.ok ? void 0 : { color: "#b00020" }
			}, proxyTest.ok ? t.proxyOk + (proxyTest.ms != null ? " (" + proxyTest.ms + "ms)" : "") : t.proxyBad + (proxyTest.error ? ": " + proxyTest.error : "")) : null), h("div", { className: "bg_aiNote" }, t.proxyNote)), providers === null ? null : h("div", { className: "bg_aiBox" }, h("h4", null, t.aiBox), h("label", { className: "bg_aiToggle" }, h("input", {
				type: "checkbox",
				checked: !!cfg.aiEnabled,
				onChange: (e) => update("aiEnabled", e.target.checked)
			}), t.aiEnabled), h("div", { className: "bg_aiRow" }, h("span", { className: "bg_label" }, t.aiProvider), h("select", {
				className: "bg_select",
				value: cfg.aiProvider || modelsProvider || "",
				onChange: (e) => {
					const p = e.target.value;
					update("aiProvider", p);
					setModelsProvider(p);
					loadModels(p);
					update("aiModel", "");
				}
			}, providers.map((p) => h("option", {
				key: p.id,
				value: p.id
			}, p.name || p.id)))), h("div", { className: "bg_aiRow" }, h("span", { className: "bg_label" }, t.aiModel), loadingModels ? h("span", { className: "bg_rowSub" }, t.aiLoadingModels) : h("select", {
				className: "bg_select",
				value: cfg.aiModel || "",
				onChange: (e) => update("aiModel", e.target.value)
			}, models.length ? models.map((m) => h("option", {
				key: m.id,
				value: m.id
			}, m.name || m.id)) : [h("option", {
				key: "__none",
				value: ""
			}, t.aiNone)])), h("div", { className: "bg_aiNote" }, t.aiNote)), h("div", { style: {
				display: "flex",
				gap: "8px",
				alignItems: "center",
				marginTop: "16px",
				paddingTop: "12px",
				borderTop: "1px solid var(--dsw-alias-border-l2)"
			} }, h("button", {
				className: "bg_btn",
				onClick: save
			}, t.save), saved ? h("span", { className: "bg_chip local" }, t.saved) : null));
		}
		/** 媒体库 Tab：海报墙（目录聚合卡片）+ 点击弹详情层（简介/放送/下载进度） */
		function LibraryTab() {
			const [posters, setPosters] = react.useState(null);
			const [sel, setSel] = react.useState(null);
			const [filter, setFilter] = react.useState("");
			const [scanning, setScanning] = react.useState(false);
			const [err, setErr] = react.useState("");
			const load = () => {
				setErr("");
				api.get("/library/posters").then((r) => setPosters(r.posters ?? [])).catch((e) => setErr(String(e.message ?? e)));
			};
			react.useEffect(load, []);
			react.useEffect(() => {
				if (!sel) return;
				const onKey = (e) => {
					if (e.key === "Escape") setSel(null);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [sel]);
			const scan = () => {
				setScanning(true);
				setErr("");
				api.post("/library/scan", {}).then(load).catch((e) => setErr(String(e.message ?? e))).finally(() => setScanning(false));
			};
			const name = (p) => p.nameCn || p.name || p.displayName;
			const shown = (posters ?? []).filter((p) => !filter.trim() || name(p).toLowerCase().includes(filter.trim().toLowerCase()));
			const coverEl = (p, clsImg, clsPh, big = false) => p.cover ? h("img", {
				key: p.key,
				className: clsImg,
				src: p.cover,
				alt: "",
				loading: "lazy",
				draggable: false,
				onError: (e) => {
					const el = e.currentTarget;
					el.style.display = "none";
					el.nextElementSibling?.removeAttribute("style");
				}
			}) : h("div", {
				className: clsPh,
				style: { fontSize: big ? void 0 : void 0 }
			}, (name(p) || "?").slice(0, 1).toUpperCase());
			const barRow = (label, n, tot, cls) => {
				if (tot === void 0 || tot <= 0) return null;
				const v = Math.min(Math.max(n ?? 0, 0), tot);
				const pct = Math.round(v / tot * 100);
				return h("div", { className: "bg_mProg" }, h("span", { className: "lab" }, label), h("span", { className: "tr" }, h("span", {
					className: "fill " + cls,
					style: { width: pct + "%" }
				})), h("span", { className: "n" }, String(v) + " / " + tot));
			};
			return h("div", null, err ? ErrBox({
				msg: err,
				retry: () => {
					setErr("");
					load();
				}
			}) : null, h("div", { className: "bg_libToolbar" }, h("span", { className: "bg_libCount" }, posters === null ? "" : isZh ? posters.length + " 部作品" : posters.length + " works"), h("input", {
				className: "bg_input",
				style: {
					flex: "0 1 200px",
					padding: "5px 10px",
					fontSize: "12px"
				},
				value: filter,
				placeholder: t.filterPh,
				onChange: (e) => setFilter(e.target.value)
			}), h("button", {
				className: "bg_btn",
				disabled: scanning,
				onClick: scan
			}, scanning ? t.scanning : t.scan), h("button", {
				className: "bg_btn",
				onClick: load
			}, t.refresh)), posters === null ? h(Skeleton, { rows: 2 }) : shown.length === 0 ? h("div", { className: "bg_empty" }, filter.trim() ? isZh ? "无匹配作品" : "No match" : t.noSubs) : h("div", { className: "bg_posters" }, shown.map((p) => h("button", {
				key: p.key,
				className: "bg_poster",
				title: name(p),
				onClick: () => setSel(p)
			}, p.subscribed ? h("span", { className: "bg_corner sub" }, "✓") : null, p.totalEpisodes !== void 0 && p.episodes.length >= p.totalEpisodes ? h("span", { className: "bg_corner done" }, t.doneBadge) : null, coverEl(p, "bg_posterImg", "bg_posterPh"), h("span", { className: "bg_posterName" }, name(p)), h("span", { className: "bg_posterMeta" }, p.episodes.length ? h("span", { className: "bg_badge" }, t.localEpShort + " " + p.episodes.length + t.episodes) : null, p.totalEpisodes !== void 0 ? h("span", { className: "bg_badge" }, t.total + " " + p.totalEpisodes) : null), p.totalEpisodes ? h("span", {
				className: "bg_pTrack",
				title: t.aired + " " + (p.aired ?? 0) + " / " + t.downloaded + " " + p.episodes.length + " / " + p.totalEpisodes
			}, h("span", {
				className: "fa",
				style: { width: Math.min(100, Math.round((p.aired ?? 0) / p.totalEpisodes * 100)) + "%" }
			}), h("span", {
				className: "fd",
				style: { width: Math.min(100, Math.round(p.episodes.length / p.totalEpisodes * 100)) + "%" }
			})) : null))), sel ? h("div", {
				className: "bg_overlay",
				onClick: (e) => {
					if (e.target === e.currentTarget) setSel(null);
				}
			}, h("div", { className: "bg_modal" }, sel.cover ? h("div", { className: "bg_mBannerWrap" }, h("img", {
				src: sel.cover,
				alt: ""
			}), h("i", null), h("b", null, name(sel))) : null, h("div", { className: "bg_mHead" }, sel.cover ? null : h("div", { className: "bg_mPh" }, name(sel).slice(0, 1).toUpperCase()), h("div", { style: {
				flex: 1,
				minWidth: 0
			} }, sel.cover ? null : h("div", { className: "bg_mTitle" }, name(sel)), h("div", { className: "bg_mSub" }, sel.airDate ? h("span", null, t.firstAir + " " + sel.airDate) : null, sel.platform ? h("span", null, sel.platform) : null, sel.id ? h("span", null, "bgm.tv #" + sel.id) : null), h("div", { className: "bg_mStats" }, h("div", { className: "bg_mStat" }, h("b", null, sel.totalEpisodes !== void 0 ? String(sel.totalEpisodes) : "?"), h("span", null, t.total)), h("div", { className: "bg_mStat" }, h("b", null, sel.aired !== void 0 ? String(sel.aired) : "?"), h("span", null, t.aired)), h("div", { className: "bg_mStat" }, h("b", null, String(sel.episodes.length)), h("span", null, t.localEpShort))), h("div", { className: "bg_mProgRow" }, barRow(t.aired, sel.aired, sel.totalEpisodes, "air"), barRow(t.downloaded, sel.episodes.length, sel.totalEpisodes, "dl")))), h("div", {
				className: "bg_mDesc",
				style: { whiteSpace: "normal" }
			}, sel.summary || t.noSummary), h("div", { className: "bg_mFoot" }, sel.subscribed ? h("span", { className: "bg_mSubBadge" }, t.subscribe + ": " + String(sel.source ?? "").toUpperCase()) : sel.id ? h("span", { className: "bg_mSubBadge" }, t.subscribeTo) : h("span", { className: "bg_mSubBadge" }, t.matchedNone), h("button", {
				className: "bg_btn",
				onClick: () => setSel(null)
			}, t.close)))) : null);
		}
		/** 日记 Tab：插件活动日志（订阅/下载/扫描/API 错误），落 sqlite 持久化 */
		function DiaryTab() {
			const [logs, setLogs] = react.useState(null);
			const [err, setErr] = react.useState("");
			const load = () => {
				setErr("");
				api.get("/logs").then((d) => setLogs(d.logs ?? [])).catch((e) => setErr(String(e?.message ?? e)));
			};
			react.useEffect(load, []);
			const clear = () => {
				if (!window.confirm(t.clearConfirm)) return;
				api.post("/logs/clear").then(() => setLogs([])).catch((e) => setErr(String(e?.message ?? e)));
			};
			const fmt = (ts) => {
				const d = new Date(ts);
				return d.getMonth() + 1 + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
			};
			const lvlLabel = (lv) => lv === "error" ? t.levelError : lv === "warn" ? t.levelWarn : t.levelInfo;
			return h("div", null, err ? ErrBox({
				msg: err,
				retry: load
			}) : null, h("div", { className: "bg_libToolbar" }, h("span", { className: "bg_libCount" }, logs === null ? "" : logs.length + " " + (isZh ? "条" : "entries")), h("button", {
				className: "bg_btn",
				onClick: load
			}, t.refresh), h("button", {
				className: "bg_btn",
				onClick: clear
			}, t.clearLogs)), logs === null ? h(Skeleton, { rows: 4 }) : logs.length === 0 ? h("div", { className: "bg_empty" }, t.diaryEmpty) : h("div", null, logs.map((l) => h("div", {
				key: l.id,
				className: "bg_logRow"
			}, h("span", { className: "bg_logTs" }, fmt(l.ts)), h("span", { className: "bg_logLvl " + l.level }, lvlLabel(l.level)), h("span", { className: "bg_logMsg" }, "[" + l.tag + "] " + l.message)))));
		}
		const TABS = [
			"subscriptions",
			"calendar",
			"library",
			"search",
			"diary",
			"settings"
		];
		/** 整页视图：页头（标题 + Tab + 关闭） + 滚动内容区 */
		function BangumiPage(props) {
			useCss();
			const [tab, setTab] = react.useState("subscriptions");
			const body = tab === "subscriptions" ? h(Subscriptions) : tab === "calendar" ? h(Calendar) : tab === "library" ? h(LibraryTab) : tab === "search" ? h(SearchTab) : tab === "diary" ? h(DiaryTab) : h(SettingsTab);
			return h("div", { className: "bg_page" }, h("div", { className: "bg_head" }, h("div", { className: "bg_title" }, "📺 " + t.title), h("div", { className: "bg_tabs" }, TABS.map((k) => h("button", {
				key: k,
				className: "bg_tab" + (tab === k ? " bg_tabOn" : ""),
				onClick: () => setTab(k)
			}, t[k]))), h("button", {
				className: "bg_close",
				onClick: props.onClose
			}, t.close)), h("div", { className: "bg_view" }, body));
		}
		function createEntry(controller) {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.setAttribute(ENTRY_ATTR, "");
			entry.className = "bg_entry";
			const icon = document.createElement("span");
			icon.className = "bg_entryIcon";
			icon.innerHTML = ENTRY_ICON_SVG;
			const label = document.createElement("span");
			label.className = "bg_entryLabel";
			label.textContent = t.title;
			entry.append(icon, label);
			entry.addEventListener("click", () => controller.open());
			return {
				entry,
				label
			};
		}
		/** 把入口插到既有面板族（taskboard/ssh/mnemon/自己）之后；无族员时插在新建会话行下。 */
		function placeEntry(root, entry) {
			if (entry.parentElement === root) return true;
			const button = newSessionButton(root);
			if (!button) return false;
			const row = button.closest("[class*=\"logoRow\"]");
			const base = row && row.parentElement === root ? row : button;
			const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(FAMILY_SELECTOR));
			const anchor = family.length ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
			root.insertBefore(entry, anchor);
			return true;
		}
		function mountSidebarEntry(controller) {
			const { entry, label } = createEntry(controller);
			const syncActive = () => {
				if (controller.getSnapshot().open) entry.setAttribute(ACTIVE_ATTR, "");
				else entry.removeAttribute(ACTIVE_ATTR);
			};
			const syncLabel = () => {
				if (entry.getAttribute("aria-label") !== t.title) entry.setAttribute("aria-label", t.title);
				if (entry.title !== t.title) entry.title = t.title;
				if (label.textContent !== t.title) label.textContent = t.title;
			};
			let root;
			let placed = false;
			const tryPlace = () => {
				syncLabel();
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed) {
					if (document.body.contains(entry)) return;
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (!root) return;
				placed = placeEntry(root, entry);
				if (placed) rootObserver.observe(root, {
					childList: true,
					subtree: true
				});
			};
			const rootObserver = new MutationObserver(tryPlace);
			const waitObserver = new MutationObserver(tryPlace);
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const unsubscribe = controller.subscribe(syncActive);
			syncActive();
			tryPlace();
			return () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribe();
				entry.remove();
			};
		}
		function conversationColumn() {
			const col = document.querySelector(CONVERSATION_SELECTOR);
			return col instanceof HTMLElement ? col : void 0;
		}
		function mountPage(controller) {
			let root;
			let container;
			let suppressCompatibilityClose = false;
			const ensure = () => {
				if (container !== void 0 && container.isConnected) return;
				if (container !== void 0) {
					root?.unmount();
					root = void 0;
					container = void 0;
				}
				const column = conversationColumn();
				if (!column) return;
				container = document.createElement("div");
				container.setAttribute(VIEW_ATTR, "");
				container.className = "bg_viewport";
				column.append(container);
				root = (0, react_dom_client.createRoot)(container);
				root.render(h(BangumiPage, { onClose: () => controller.close() }));
			};
			const waitObserver = new MutationObserver(ensure);
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const applyActive = () => {
				if (!controller.getSnapshot().open) {
					document.documentElement.removeAttribute(ACTIVE_ATTR);
					root?.unmount();
					root = void 0;
					container?.remove();
					container = void 0;
					return;
				}
				suppressCompatibilityClose = true;
				try {
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "ssh" }));
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "taskboard" }));
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "mnemon" }));
				} finally {
					suppressCompatibilityClose = false;
				}
				for (const attr of OTHER_ACTIVES) document.documentElement.removeAttribute(attr);
				document.documentElement.setAttribute(ACTIVE_ATTR, "");
				document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "bangumi" }));
			};
			const onOtherPanelActivate = (event) => {
				if (suppressCompatibilityClose || !controller.getSnapshot().open) return;
				const detail = event.detail;
				if (detail === "taskboard" || detail === "ssh" || detail === "mnemon") controller.close();
			};
			const onSidebarContextClick = (event) => {
				if (!controller.getSnapshot().open) return;
				const target = event.target;
				if (target instanceof Element && target.closest(SIDEBAR_CONTEXT_SELECTOR) !== null) controller.close();
			};
			const activeObserver = new MutationObserver(() => {
				if (!controller.getSnapshot().open) return;
				const html = document.documentElement;
				if (!html.hasAttribute(ACTIVE_ATTR) || OTHER_ACTIVES.some((a) => html.hasAttribute(a))) controller.close();
			});
			activeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: [ACTIVE_ATTR, ...OTHER_ACTIVES]
			});
			const unsubscribe = controller.subscribe(applyActive);
			applyActive();
			ensure();
			return () => {
				document.removeEventListener("click", onSidebarContextClick, true);
				document.removeEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
				activeObserver.disconnect();
				waitObserver.disconnect();
				unsubscribe();
				document.documentElement.removeAttribute(ACTIVE_ATTR);
				root?.unmount();
				root = void 0;
				container?.remove();
				container = void 0;
			};
		}
		function apply(ctx) {
			ctx.effect(() => {
				if (typeof document === "undefined" || typeof window === "undefined") return () => {};
				const disposeDiag = installDiag();
				const controller = new PanelController();
				const disposeEntry = mountSidebarEntry(controller);
				const disposePage = mountPage(controller);
				return () => {
					disposeDiag();
					disposePage();
					disposeEntry();
				};
			}, "@dsh-external/dsh-bangumi: workspace");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map