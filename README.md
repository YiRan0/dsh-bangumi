# @dsh-external/dsh-bangumi

追番订阅插件（DSH hybrid：host + client）：Bangumi 元数据、nyaa/dmhy 搜种、qBittorrent RSS 判新下载、本地媒体库查重、日历与进度 GUI。侧边栏上方「追番」独立页入口（仿记忆系统交互），点击进入全功能面板。

## 功能总览

- **追番搜索与订阅**：Bangumi 条目收敛（季词/续作归一，宁缺毋滥），一键订阅（dmhy 默认 / nyaa 可选、限定发布组/分辨率）
- **自动下载决策树 v3**：RSS 轮询判新（订阅回看窗内新集）→ 完结番优先整包、连载番只补缺集；三层查重（本地媒体库 ∪ qB 已下载标签 ∪ downloads 记录区间）防重复下载
- **qBittorrent 集成**：自动套分类（默认 `bangumi`）/标签/保存目录，番剧按「分类根/作品[/第N季]」分层归类；整包下载后自动停止订阅跟踪
- **本地媒体库**：目录扫描建索引，按标题别名 + 目录名双向匹配集数，进度聚合（已下载/总集数/缺集）
- **封面本地缓存**：sqlite cover_cache 落库（URL 变更自动过期、404 自愈重取），断网可显、零重复外网拉取
- **LLM 工具集**：`bangumi_lookup`（唯一 HTML 资料卡）/ `bangumi_search` / `bangumi_subscribe` / `bangumi_unsubscribe` / `bangumi_list` / `bangumi_progress` / `bangumi_calendar` / `qb_status` / `qb_configure` / `qb_add_torrent` / `library_scan`
- **侧边栏独立页 GUI**：订阅列表（进度条+缺集）、追番日历（哪天更新哪集）、搜索页（候选+种子标注本地集数）、设置页——仿记忆系统侧栏入口 + 整页切换（`data-dsh-bangumi-entry` DOM 面板形态，与 taskboard/ssh/mnemon 互斥激活）

## 架构

```
src/
├── index.ts          host 入口：配置/运行时、REST /api/bangumi/*、定时轮询、LLM 工具
├── host/
│   ├── bangumi.ts    bgm.tv API（7 天主体 / 6h 剧集缓存）
│   ├── rss.ts        RSS 解析（手写正则）、magnet 合成、nyaa/dmhy 搜索
│   ├── parse.ts      标题归一 / 集号解析 / 整包识别（multiSeason/seasonFull/rangeRaw）
│   ├── match.ts      种子打分排序（别名/集号/分辨率/组/seeders/整包）
│   ├── decision.ts   下载决策纯函数（finished→全集优先，airing→只补缺集）
│   ├── qb.ts          qBittorrent 客户端（401 重登 cookie、RSS 规则、分类）
│   ├── library.ts     媒体库扫描 + byTitle/byDir 索引
│   ├── store.ts       内存镜像 state（含 data_version 侦测）
│   ├── db.ts          SQLite WAL（订阅/下载/媒体库/封面缓存 schema）
│   └── card.ts        HTML 资料卡统一模板
├── client/
│   ├── index.ts      侧栏入口 + 独立页（React，无 JSX 手写 h()）
│   └── diag.ts       浏览器端诊断探针（开发用）
└── test/             决策矩阵真实样本测试
```

## 配置

优先级：环境变量 `DSH_BANGUMI_*` → `~/.dsh/dsh-bangumi.json` → 默认值。设置页写入后 `reloadRuntime` 立即生效，无需重启。

| 键 | 默认 | 说明 |
|---|---|---|
| qbUrl | `http://127.0.0.1:8080` | qBittorrent WebUI |
| qbCategory / qbTags | `bangumi` | 下载分类 / 标签 |
| qbCategoryRoot | `番` | 番剧分类根 |
| qbBaseDir | `/Volumes/一块硬盘/电影/番` | 番剧保存根目录 |
| pollIntervalMinutes | 30 | 判新轮询间隔 |
| minMatchScore | 60 | 种子最低匹配分 |
| rssIgnoreDays | 3 | 判新回看窗（天），0=不限（慎用） |

## 构建与注入

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh   # host：tsc 编译 src → lib
npm run build:client                            # client：tsdown 打包 lib/client.js
# 注入器环境内：
dev_inject_plugin <本目录>    # 运行时注入（host+UI 同通道）
dev_reload_package dsh-bangumi # 热重载（确认输出「清缓存 N 模块 重建 1 fiber」才真正换新）
```

状态持久化：`~/.dsh/dsh-bangumi/state.json`（旧版）+ `~/.dsh/dsh-bangumi/bangumi.db`（SQLite，启动自动迁移）。配置文件：`~/.dsh/dsh-bangumi.json`。

> hybrid 面板注意：client 为纯 DOM 面板形态（无 `slots.register`），依赖注入器 `looksPanelForm` 豁免放行；卸载需同时 `dev_uninject_plugin`。
