# oss · 开源能力库

不是日报。目标是：**你说一句「我要做 X」，它能告诉你 X 可以拆成哪几块，每块有哪些现成开源项目能直接用。**

```bash
node oss.mjs decide "把 PDF 里的表格提取成 Excel"
```

输出不是一串搜索结果，而是逐项结论：**直接用 / fork 改造 / 借鉴重写 / 自研**，附理由、风险和下一步。

## 命令

| 命令 | 什么时候用 |
| --- | --- |
| `oss decide "需求"` | 想知道每块该直接用、fork、借鉴还是自研 |
| `oss ui` | 打开图形化选型台（启动即在后台更新库） |
| `oss find "需求"` | 已经有明确功能点，想直接找现成项目 |
| `oss plan "需求"` | 功能还挺大，先看该拆成哪些子能力，再逐个选型 |
| `oss rising` | 看最近几天突然冒头/爆火的项目（不按能力，按增速） |
| `oss daily` | 更新库：扫新项目 + 补社区信号 + 刷新增速 |

常用参数：`--limit 20`、`--lang Rust`、`--min-stars 500`、`--json`（给程序用）。

实际跑出来是这样：

```
$ node oss.mjs find "把 PDF 里的表格提取成 Excel"
识别到能力：Office 文档处理(1)  文档解析 / 表格提取(0.9)  PDF 处理(0.8)  表格处理(0.7)

 1. opendatalab/MinerU          82,099★  Python   能力：Office / PDF / 文档解析
 2. docling-project/docling     69,165★  Python   能力：Office / PDF / 文档解析
 3. Unstructured-IO/unstructured 15,579★ HTML     能力：Office / PDF / 文档解析
 6. jsvine/pdfplumber           10,830★  Python   能力：PDF / 文档解析 / 表格提取
```

## 图形界面

不想在终端里翻输出，可以开选型台：

```bash
node oss.mjs ui                        # 默认 http://127.0.0.1:7788，自动打开浏览器
node oss.mjs ui --port 8000 --no-open  # 换端口 / 不自动开浏览器
node oss.mjs ui --no-update            # 不更新，直接用现有库
```

打开后会先在后台更新一次数据库（发现新项目 + 刷新热度，约 4–5 分钟），顶栏显示当前阶段；
更新完成前「开始拆解 / 检索」保持禁用，保证结果基于更新后的库。等不及可以点「先用现有库」
绕过。30 分钟内重复打开会跳过更新，避免打满 GitHub 匿名额度；设置页有「立即更新」可强制跑一次。

拆解默认**离线**：用本地能力词表识别需求，不联网也能用。在设置里填好 OpenAI 兼容 API 后，
选型页的「AI 拆解」开关会亮起，打开即改用模型拆解。

四个页面：

- **选型** — 输入需求 → 左侧组件列表、右侧结论与候选对比，可下载同一份 Markdown 报告
- **检索** — 关键词 + 语言 / 星数 / 条数筛选，按能力标签与检索词重排
- **能力库** — 62 个能力标签及覆盖数量，点卡片直接带着能力名去检索
- **设置** — 项目画像、模型连接与数据库更新，保存即写回 `oss.config.json`（Key 留空不覆盖）；
  模型连接内置 16 家厂商预设（点选即填 Base URL、模型与 Key / 文档入口），模型 UID 可自由输入，
  也可选「自定义」手填任意 OpenAI 兼容端点

界面是原生 HTML/CSS/JS，无构建、无第三方依赖，由 `src/server.mjs` 托管，只监听
`127.0.0.1`。改完前端文件刷新页面即可，不用重启。

视觉基准是 Raycast（中性灰底、1px 描边、无阴影、紧凑高密度），局部借用 Linear 的
单一强调色与负字距；默认暗色，另有一套同层级的亮色主题。

## 它怎么工作

```
需求（中文）
   │  ① 能力识别：中文说法 / 英文别名 → 能力标签
   ▼
能力（PDF 处理 + 表格处理）
   │  ② FTS5 召回：能力别名扩展 + 关键词
   ▼
候选（几百条）
   │  ③ 重排：能力重合度 ×45，名称命中 ×14，质量分，星数，活跃度
   ▼
结果（带「为什么匹配」）
```

关键取舍：**能力匹配的权重压过星数**。否则搜什么都会返回那几个巨无霸项目，
而你真正要的是「这块轮子已经有人造好了」。

拆解关系存在能力表的 `composes` 字段里：做视频剪辑 → 编解码/图像/音频；
做 RAG → 文档解析/向量化/向量库/检索。

## 选型：直接用 / fork / 借鉴 / 自研

`find` 解决「有哪些项目」，`decide` 解决「我到底该不该用」。它会先把需求拆成 3–6 个组件，
逐个检索候选，再按固定规则给出结论，写成 Markdown 报告。

```
$ node oss.mjs decide "把 PDF 里的表格提取成 Excel"

需求：把 PDF 里的表格提取成 Excel
拆解：LLM 拆解 · 5 个组件

 1. PDF 表格结构识别 核心 → 借鉴重写
    首选 docling-project/docling · 这是核心差异化组件，直接依赖等于把关键路径交给外部维护
 2. Excel 导出     支撑 → 直接使用
    首选 SheetJS/sheetjs · 覆盖度 88%、成熟度 82/100，属于边界清晰的通用能力
...
报告已写入 reports\decide-2026-10-20-1730.md
```

拆解可以走 AI（OpenAI 兼容接口），也可以完全离线用能力词表；界面默认离线，配好 API 后
再打开「AI 拆解」开关。CLI 配了 Key 时默认走 AI，`--no-llm` 可强制词表。
AI 失败或没配 Key 时自动退回词表，所以不联网也能用，只是换个说法可能识别不到。
决策本身**永远由规则计算**，AI 不参与打分——避免模型对着候选名单编理由。

### 项目画像（决定结论的关键）

结论高度依赖你的场景，写在 `oss.config.json` 里，不用每次传参：

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

- `stack`：语言/框架。不匹配的候选会被降权并标注风险。
- `commercial`：商用且闭源时，强 copyleft（GPL/AGPL/SSPL）和无 license 的项目直接判为不可用。
- `licensePolicy`：填了就按白名单走，比如 `["MIT", "Apache-2.0", "BSD-3-Clause"]`。
- `timeline`：出现「两周 / 紧急 / MVP」时放宽复用门槛，优先接现成的。
- API Key 优先读 `apiKeyEnv` 指向的环境变量，其次 `OPENAI_API_KEY`，最后才是配置文件里的 `apiKey`。

### 决策规则

| 情况 | 结论 |
| --- | --- |
| 核心组件，覆盖度 ≥85% 且成熟度 ≥80 | 直接使用（但业务逻辑仍自己握） |
| 核心组件，覆盖度 ≥45% | 借鉴重写——关键路径不交给外部维护 |
| 支撑组件，覆盖度 ≥70%（紧急时 62%）且成熟度 ≥50（紧急时 42） | 直接使用 |
| 支撑组件，覆盖度 ≥45% | fork 改造，只补缺口 |
| 覆盖度 <45%，或候选都因 license 不可用 | 自研 / 只借鉴思路 |

覆盖度 = 能力标签重合度 ×70% + 检索词命中率 ×30%；成熟度 = 质量分 35 + 星数 20 +
活跃度 15 + 增速 10 + license 20。完整口径和风险提示写在报告末尾。

常用参数：`--limit 8`（每个组件看几个候选）、`--no-llm`（强制词表拆解）、
`--config other.json`、`--out path.md`、`--json`。

## 实时性：怎么不被「突然爆火」的项目漏掉

按 topic 搜星数榜，永远只能捞到已经成名的项目——冷门项目突然起量时，它还没进榜。
所以每天跑三条独立通道：

| 通道 | 做法 | 抓什么 |
| --- | --- | --- |
| 新项目扫荡 | `created:>3d stars:>15`、`created:>7d stars:>60` 等 6 组查询，不按 topic 过滤 | 刚上线就开始起量的 |
| 社区信号 | Hacker News 近 36 小时、分数 > 15 的 story 里扒 GitHub 链接 | 有人开始讨论的 |
| 增速追踪 | 每天重新查一批仓库的真实星数，和昨天的快照做差 | 已经有一阵子、突然加速的 |

第三条是关键：**绝对星数看不出变化，增量才看得出来**。`snapshots` 表每天记一次星数，
`heat` = 近 14 天日均涨星，`burst` = 单日增量。这两个值直接参与检索排序，
所以一个 800 星但每天涨 150 的项目，能排在 8 万星但半年没动的项目前面。

```
$ node oss.mjs rising
 1. storytold/photocraft   +3480/天  68974★  🆕  Rust   图像处理 / 编辑
 2. Gathin23/cleanyourtv   +2586/天   7878★  🆕  Java   （未识别能力）
```

每天重新查星数是有配额的：GitHub 匿名核心接口 60 次/小时，所以 watchlist 每天只挑
~38 个仓库轮询，优先给最近 30 天新出现的小项目——惊喜基本都在那里。

## 库的构成

- `data/oss.db` — SQLite（启用 FTS5）。
  - `repos` 存项目、能力标签、质量分、`heat`（日均涨星）、`burst`（单日增量）
  - `repo_fts` 全文索引
  - `snapshots` 每天一条 star 快照，热度就是靠它做差算出来的

```bash
node oss.mjs stats        # 库有多大、覆盖哪些能力
node oss.mjs caps         # 能力清单（含拆解关系）
node oss.mjs show pdf     # 看某个项目的详情
```

## 建库 / 更新

```bash
node oss.mjs harvest --full   # 首次建库：61 组能力 topic，约 7 分钟，~2900 个项目
node oss.mjs daily            # 日常更新：抓新项目 + 刷新热度
node oss.mjs retag            # 改了 taxonomy 之后重新打标，不用联网
```

`oss ui` 启动时会自动跑一次 `daily`（30 分钟内重复打开则跳过，`--no-update` 可关闭）。

GitHub 匿名接口限流 10 次/分钟（搜索）、60 次/小时（核心接口），采集器内部已排队。
配了 `GITHUB_TOKEN` / `GH_TOKEN` 会用认证额度，更新更稳。别并发跑。

Windows 计划任务 `OSS Library Daily` 每天 08:00 自动跑 `daily`（`oss-daily.cmd`）。

## 扩充能力表

只改 `src/taxonomy.mjs`：

```js
cap('pdf', 'PDF 处理', 'PDF processing',
  ['pdf', 'pdf-generation'],                  // GitHub topic：采集用
  ['pdf', 'pdf parser', 'pdf rendering'],     // 英文别名：打标 + 查询扩展
  ['PDF', 'PDF 解析', 'PDF 生成'],             // 中文说法：需求识别
  ['ocr'])                                    // composes：拆解关系
```

改完 `node oss.mjs retag`，再 `harvest` 补新方向的数据。

## 已知局限

- 中文描述的项目主要靠能力映射命中，纯中文关键词召回弱。
- 没配 LLM Key 时，`decide` 的拆解退回固定词表，换个说法可能识别不到；配置后更稳。
- 覆盖度和「库 vs 完整应用」都是基于标签、描述和关键词的粗估，不等于真实 API 能力。
- 覆盖广度取决于 topic 选得准不准；很冷门的方向可能一条都没有。
- 没有语义向量检索，同义改写要靠别名词表兜住——这也是为什么 `zhAliases` 值得持续补。
- 热度不是秒级：每天一次，且 watchlist 每天只轮询 ~38 个仓库。刚爆火当天可能还没进库，
  第二天才会体现在 `rising` 和排序里。
- 第一次抓到的新项目只有「建仓以来日均」这一个热度值，要等第二次快照才有真实增量。
