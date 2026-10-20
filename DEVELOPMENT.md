# oss-finder 开发文档

面向要改代码、排查问题或重新打包的人。使用说明见 [README.md](README.md)。

## 1. 项目定位

输入一句需求（中文/英文），把它拆成若干能力组件，在本地 GitHub 项目库里召回候选，
最后给出「直接用 / fork 改造 / 借鉴重写 / 自研」的结论和 Markdown 报告。

三个关键设计约束：

1. **运行时零依赖**：只用 Node 内置模块（`node:sqlite`、`node:sea`、`fetch`、`http`）。
   `esbuild` / `postject` 只在构建 exe 时用。
2. **能力匹配优先于星数**：排序里能力重合度权重最高，避免搜什么都返回几个巨无霸项目。
3. **决策由规则计算，LLM 只做拆解**：模型不参与打分，避免它对着候选名单编理由。
   LLM 不可用时自动退回本地能力词表，离线仍可用。

运行环境：

- Node.js **24**（构建 exe 必须；`node:sea`、`node:sqlite` 均为内置能力）
- `package.json` 声明 `engines.node >= 22.5`，但源码开发建议与打包版本保持一致
- Windows 为 exe 打包目标平台；CLI 与 Web 服务本身跨平台

## 2. 目录结构

```
oss.mjs                 CLI 入口：参数解析 + 子命令分发
src/
  taxonomy.mjs          能力词表（能力、GitHub topic、英文别名、中文说法、composes）
  search.mjs            需求解析 + FTS 召回 + 结构化重排
  decide.mjs            逐组件选型决策 + Markdown 报告渲染
  decompose.mjs         需求拆解（LLM 优先，词表兜底）
  plan.mjs              离线能力拆解（按 composes 展开）
  collect.mjs           harvest 建库 / retag 重新打标
  discover.mjs          每日更新：新项目扫荡 + HN 信号 + watchlist 热度刷新
  github.mjs            GitHub REST 客户端（搜索 / 单仓详情 / 限流处理）
  db.mjs                SQLite 打开、建表、增删查、快照与热度计算
  tag.mjs               仓库 → 能力标签 + 质量分
  llm.mjs               配置加载 + OpenAI 兼容 chat/completions 调用
  server.mjs            HTTP 服务、API 路由、静态资源、启动更新状态机
  lib.mjs               路径、时间、读写、日志等通用工具
web/
  index.html            单页骨架
  app.js                前端全部逻辑（hash 路由 + 四页渲染 + 事件委托）
  styles.css            设计令牌与组件样式（暗/亮双主题）
scripts/
  build-exe.mjs         Node SEA 打包流程
legacy/                 旧版日报脚本，不参与运行
```

运行期生成（均已 gitignore）：

```
data/oss.db            主库（WAL 模式）
reports/decide-*.md    选型报告
logs/run.log           更新日志（超过 4 MB 自动清空）
oss.config.json        项目画像 + 模型配置
build/ dist/           打包中间产物与 exe
```

## 3. 架构与主流程

### 检索

```
需求文本
  → parseNeed()        中文说法 / 英文别名 / 拉丁缩写 / 动作意图 → caps + terms
  → buildMatch()       拼 FTS5 MATCH 表达式
  → ftsCandidates()    bm25 召回候选（默认上限 500）
  → search()           能力重合度（IDF 加权）+ 文本命中 + 热度 + 质量分 + 星数重排
  → explain()          生成「为什么匹配」的一句话
```

排序权重（[search.mjs](src/search.mjs)）：

| 因子 | 权重 |
| --- | --- |
| 能力重合度 `capScore` | × 80 |
| 热度（日均涨星 × 0.7，上限 34；单日增量 × 0.3，上限 10） | 最高 +44 |
| 动作意图命中（提取/解析/生成…） | +14 |
| 名称命中 | 每个 +14，最多 2 个 |
| topic 命中 | 每个 +9，最多 3 个 |
| 描述命中 | 每个 +4，最多 3 个 |
| 中文片段命中 | 每个 +10，最多 2 个 |
| 质量分 | × 0.45 |
| 星数 | `log10(stars+1) × 4` |
| 近一年有提交 | +4 |
| FTS bm25 | × 1.5（封顶 12） |

过滤条件：归档仓库、噪声仓库（描述过短或命中噪音词）、`minStars`、`language`。

### 选型

```
decide()
  → decomposeNeed()        LLM 拆 3–6 个组件；失败/未配置 → taxonomyFallback()
  → 每个组件 search()
  → buildCandidate()       coverage / evidence / 风险 / license 判定
  → decideComponent()      规则决策
  → renderReport()         Markdown 报告
```

候选覆盖率与成熟度：

- `coverage = 0.7 × 能力重合度 + 0.3 × 检索词覆盖率`（无能力命中时只看词覆盖率）
- `evidence` 由星数、活跃度、license、质量分等加权得到（0–100）
- 综合分 `total = coverage × 55 + evidence × 0.45`，技术栈不匹配 −6，完整应用 −5

决策阈值（[decide.mjs](src/decide.mjs)）：

| 条件 | 结论 |
| --- | --- |
| 核心组件，coverage ≥ 0.85 且 evidence ≥ 80 | 直接使用 |
| 核心组件，coverage ≥ 0.45 | 借鉴重写 |
| 支撑组件，coverage ≥ 0.70（紧急 0.62）且 evidence ≥ 50（紧急 42） | 直接使用 |
| 支撑组件，coverage ≥ 0.45 | fork 改造 |
| 其余 / 候选均因 license 不可用 | 自研 |

license 判定优先于打分：不可用候选直接排除，只有 coverage ≥ 0.45 时才降级为「借鉴」。

### 每日更新

`dailyUpdate()` 分三段，`onProgress` 把阶段推给界面：

1. `discover` — 6 组「新项目」搜索（`created:>3d stars:>15` 等）
2. `signal` — Hacker News 近 36 小时、>15 分的 story 中提取 GitHub 链接，新仓库才补查元数据
3. `refresh` — 按 watchlist 轮询真实星数（默认 38 个/天），写入快照并更新 `heat` / `burst`

热度口径：`heat` = 近 14 天日均涨星，`burst` = 单日增量。

## 4. 数据模型

数据库：`data/oss.db`，`node:sqlite` 的 `DatabaseSync`，WAL + `synchronous=NORMAL`。

`repos`（核心表，节选）：

| 字段 | 说明 |
| --- | --- |
| `full_name` | `owner/repo`，唯一键 |
| `description` / `language` / `topics` / `topics_json` | 仓库元数据 |
| `stars` / `forks` / `license` / `created_at` / `pushed_at` / `archived` / `fork` | GitHub 字段 |
| `caps` / `cap_scores` | 能力标签（空格分隔）与打分 JSON |
| `quality` | 质量分（0–100），见 tag.mjs |
| `source` | 入库来源：`seed` / `rising:*` / `hn:*` / `topic:*` |
| `first_seen` / `last_seen` / `prev_stars` | 入库时间与上次星数 |
| `heat` / `burst` / `heat_at` | 日均涨星 / 单日增量 / 计算时间 |

其他表：

- `repo_fts` — FTS5 虚表（`full_name`、`description`、`topics`、`caps`），tokenizer `unicode61`
- `snapshots(repo_id, day, stars)` — 每日星数快照，热度靠它做差
- `meta(key, value)` — 上次更新时间和结果等

老库通过 `PRAGMA table_info` 检查后 `ALTER TABLE` 补列，不做版本号迁移。

## 5. HTTP API

服务只监听 `127.0.0.1`，默认端口 `7788`，无 CORS、无鉴权（本机单用户）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 启动数据：统计、能力、热度榜、更新状态、配置视图 |
| GET | `/api/find?q=&limit=&minStars=&lang=` | 检索；`q` 必填，`limit` 收敛到 1–60 |
| POST | `/api/decide` | `{ need, useLlm?, limit? }`，`limit` 收敛到 1–10；返回结果与报告链接 |
| GET | `/api/caps?q=` | 能力清单及覆盖数量，`q` 为子串过滤 |
| GET | `/api/rising?limit=` | 涨星榜（1–50） |
| GET | `/api/update` | 更新状态（状态机 + 上次结果） |
| POST | `/api/update` | 触发更新，`force !== false`；立即返回，前端轮询 GET |
| GET | `/api/config` | 配置视图，Key 只给 `apiKeySet / apiKeyMasked / apiKeySource` |
| GET | `/api/config/key` | 按需返回明文 Key（设置页「查看已保存」） |
| POST | `/api/config` | 保存画像与模型配置；Key 留空不覆盖 |
| GET | `/api/report?name=decide-*.md` | 下载报告，文件名白名单校验 + 目录逃逸校验 |
| POST | `/api/quit` | 150 ms 后退出进程（图形模式没有控制台可关） |

更新状态机：

```
idle → running → done | error
             ↘ skipped（30 分钟内已更新且未 force）
```

`POST /api/update` 不 `await` 更新，避免请求挂几分钟；前端靠 `updateView()` 的
`status / phase / durationMs / lastUpdate` 渲染进度。

## 6. 配置

`oss.config.json` 查找顺序：`--config` 指定文件 > 环境变量 `OSS_CONFIG` > 程序根目录。

Key 优先级：`llm.apiKeyEnv` 指向的环境变量 > `OPENAI_API_KEY` > 配置文件 `llm.apiKey`。
`llmReady()` 对 `localhost` / `127.0.0.1` / `[::1]` 端点不要求 Key（Ollama、LM Studio 等）。

```json
{
  "profile": {
    "name": "我的产品",
    "stack": ["TypeScript", "Node.js"],
    "commercial": false,
    "licensePolicy": [],
    "timeline": "3 个月上线 MVP",
    "teamSize": 2,
    "notes": ""
  },
  "llm": {
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "apiKeyEnv": "OSS_LLM_API_KEY",
    "apiKey": "",
    "timeoutMs": 60000
  }
}
```

`chatJson()` 默认带 `response_format: { type: 'json_object' }`，遇到 4xx 自动去掉重试；
返回值用 `parseJsonLoose()` 兼容 ```json 围栏与前后夹带文字。

## 7. 前端

单页、原生 HTML/CSS/JS、无构建、无第三方依赖。修改 `web/` 下文件后刷新即可，无需重启。

- **路由**：hash 路由 `#/decide`、`#/find`、`#/caps`、`#/settings`，`renderPage()` 整体重绘
- **状态**：模块级 `state` 保存 bootstrap 数据、检索结果、选中组件、主题等
- **请求**：统一 `api(path, { method, body })`，非 2xx 抛错并交给 `toast()`
- **安全**：所有插值经 `esc()` 转义；不使用 `innerHTML` 拼接未转义数据
- **事件**：容器级事件委托 + `data-action`，避免重绘后重复绑定
- **主题**：暗色默认，亮色同层级；选择写入 `localStorage`
- **候选数**：输入框，`clampLimit()` 把空值/非法值收敛为 5，范围 1–10

前端只用 `bootstrap` 一次拉全量，之后按需调用各 API；`settings` 页保存后重绘该页。

## 8. 开发工作流

```bash
# 首次
npm install

# 源码运行
node oss.mjs find "把 PDF 表格提取成 Excel"
node oss.mjs ui                 # 默认 7788，自动开浏览器
node oss.mjs ui --no-update     # 跳过启动更新

# 数据
node oss.mjs harvest --full     # 首次建库（约 7 分钟）
node oss.mjs daily              # 日常更新
node oss.mjs retag              # 改完 taxonomy 后重新打标（不联网）

# 语法检查
node --check oss.mjs
node --check src/server.mjs
node --check web/app.js         # 前端是普通脚本，可直接 check
```

### 新增/调整能力

只改 [taxonomy.mjs](src/taxonomy.mjs)：

```js
cap('pdf', 'PDF 处理', 'PDF processing',
  ['pdf', 'pdf-generation'],                  // GitHub topic：采集用
  ['pdf', 'pdf parser', 'pdf rendering'],     // 英文别名：打标 + 查询扩展
  ['PDF', 'PDF 解析', 'PDF 生成'],             // 中文说法：需求识别
  ['ocr'])                                    // composes：拆解关系
```

然后 `node oss.mjs retag` 重新打标；需要新方向的数据再跑 `harvest`。

### 新增 API

1. 在 `server.mjs` 的 `handleApi()` 按「路径 + 方法」加分支
2. 入参统一做 `String/Number` 转换与 `clamp`，空值返回 400 + `{ error }`
3. 前端在 `app.js` 里用 `api()` 调用，错误交给 `toast()`，不要静默失败

## 9. 打包 exe

```bash
npm run build:exe     # 产物 dist/oss-finder.exe
```

[build-exe.mjs](scripts/build-exe.mjs) 的五个步骤：

1. **esbuild** 把 `oss.mjs` 打成单文件 CJS（SEA 主脚本只支持 CJS）；
   `import.meta.url` 用 banner 注入的 `importMetaUrl` 顶替
2. **准备示例库**：`PRAGMA wal_checkpoint(TRUNCATE)` 后复制 `data/oss.db`
3. **SEA 配置**：内嵌 `web/index.html`、`web/app.js`、`web/styles.css`、`seed/oss.db`；
   `useCodeCache: true`（冷启动约 70 ms），`useSnapshot: false`
4. **注入**：复制当前 `node.exe`，用 `postject` 写入 `NODE_SEA_BLOB`
5. **PE 子系统补丁**：定位 `e_lfanew(0x3C) → PE 签名 → 可选头 +68`，写 `2`
   （`IMAGE_SUBSYSTEM_WINDOWS_GUI`），双击不再弹黑窗

运行时判定与路径：

- `isSea()` 为真时，资源走 `getAsset('web/...')`，根目录取 exe 所在目录
- 首次运行 `ensureSeedDb()` 把内置库释放到 `data/oss.db`
- 打包后 `data/`、`reports/`、`logs/`、`oss.config.json` 都在 exe 同级，可整目录拷贝

打包注意：

- 构建前先结束正在运行的 exe，否则覆盖会 `EPERM`
- 必须用 Node 24 执行构建；esbuild `target: node24`
- `seed/oss.db` 中的示例库会显著影响 exe 体积
- 图形模式下未捕获异常用 `powershell + MessageBox` 兜底提示，否则程序会一闪而过

## 10. 代码约定

- **语言**：界面文案、注释、报告用中文；日志行用简短英文/ASCII（避免 Windows 代码页乱码）
- **时间**：面向用户的日期统一用 `dateKey()`（`Asia/Shanghai`），不要直接用 `toISOString().slice(0,10)`
- **路径**：一律从 `PATHS` 取，不要在业务模块里自己拼 `process.cwd()`
- **错误**：CLI 顶层捕获后设置 `process.exitCode = 1`；HTTP 层统一转 500 JSON
- **依赖**：新增运行时依赖前先确认内置模块能否满足
- **前端**：继续用 `esc()` + 事件委托，不引入框架和构建链
- **数值**：CLI 用 `num()`、服务端用 `clamp()` 收敛，禁止把 `NaN` 传到下游

## 11. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 端口被占用 | 若占用者是本程序，`ui` 会自动识别并直接打开；否则换 `--port` |
| exe 无法访问 GitHub | `fetch` 不读系统代理，需 `HTTPS_PROXY` + `NODE_OPTIONS=--use-env-proxy` |
| 更新只刷新少量仓库 | GitHub 匿名核心接口 60 次/小时，watchlist 默认只轮 38 个；配 `GITHUB_TOKEN` 提升额度 |
| 构建 `EPERM` | 旧 exe 仍在运行，先结束进程 |
| 更新一直是 `running` | 看 `logs/run.log`；GitHub 搜索限流 10 次/分钟，采集器内部有排队 |
| 双击 exe 没反应 | 检查是否被 PE 子系统补丁改成 GUI；异常会弹 MessageBox |
| 能力库过滤出现误命中 | 当前按 `zh/en/id` 子串匹配（如 `rag` 命中 `storage`），属已知问题 |

## 12. 已知局限

- 无向量检索，同义改写依赖 `zhAliases` 词表覆盖
- 中文描述项目的召回弱于英文
- 覆盖度、成熟度是基于标签/描述/关键词的粗估，不等于真实 API 能力
- 热度为天级：新项目第一次入库只有「建仓以来日均」，第二次快照才有真实增量
- 检索质量受能力词表与 topic 选取影响，冷门方向可能零召回
- 未做鉴权与多用户隔离，仅适合本机单用户使用
