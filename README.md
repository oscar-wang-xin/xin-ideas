# xin-ideas · 灵感体检与可落地拆解

> 把想法抛进来，先体检、后动手。一个开源中文 skill：对每个灵感做「**十维评分** + 可行性专项评估 + 可落地拆解」，产出精美、纯静态、完全离线的 HTML 明细页与可检索的灵感卡片墙，并附**可直接复制的参考提示词**。

本仓库只包含 skill 本体、模板与脚本，**不包含任何灵感数据**——你的想法只保存在本地目录。

## ✨ 特性

- **十维评分（1–10）**：解决的问题 / 实用性 / 市场价值 / 目标用户 / 竞品分析 / 变现可能 / 技术方案 / 可扩展性 / 实现计划 / **实现可行性**，按均值评级（S/A/B/C/D）。「解决的问题」须区分真实痛点与想象问题；「市场价值」须论述推广可行性与获客代价
- **实现可行性专项评估**：结构化输出「所需技术能力 / 配套资源 / 可行性结论 / 成本与代价依据」，把「想做」和「能做」分开
- **参考提示词**：每个灵感附 3–4 条可直接复制的优化提示词（需求拆解 / 竞品调研 / 技术选型 / 低成本验证），明细页带一键复制按钮
- **可落地拆解**：好处与代价、问题与应对、分阶段路线图、要避免的坑、量化成功/失败判据、成本投入（精力/时间/金钱）
- **构思原话留痕**：一字不差记录你抛出灵感时的原话；明细页引用卡，列表卡片「原话」角标悬停/点击查看
- **双主题**：AURORA 蓝紫极光（默认）/ ROBOT 冷白机甲，右上角一键切换、跨页面生效并记住偏好
- **精美自包含页面**：雷达图（内联 SVG）、分项打分条、时间线路线图、判据表、成本卡；零 CDN、零外部请求，纯静态离线可用
- **灵感卡片墙**：实时搜索、多维度排序、新标签页打开明细
- **绝不丢内容**：增量写入合并器（`upsert-idea.js`）保证已有灵感只增不删，索引损坏也能从明细页重建
- **移动端优先**：单栏布局、大触控目标、安全区适配，浮动按钮可拖动不遮内容
- **隐私友好**：灵感数据为本地产物，默认被 `.gitignore` 排除

## 📁 目录结构

```
xin-ideas/                      # skill 本体（整体复制到 skills 目录即可安装）
├── SKILL.md                    # skill 定义与完整工作流
├── config.json                 # 灵感墙位置（baseDir）与默认主题
├── assets/templates/           # 渲染模板
│   ├── detail.html             # 明细页模板（十维雷达 + 可行性 + 参考提示词）
│   └── index.html              # 列表页模板（卡片墙）
└── scripts/                    # 功能脚本（Node.js，无第三方依赖）
    ├── upsert-idea.js          # 增量写入合并器（防覆盖核心）
    ├── health-check.js         # 只读体检：条数/引用/原话同步/字段完整性
    ├── smoke-test.js           # 模板回归（字段缺失不崩）
    └── test-upsert.js          # 合并器回归（34 项不丢内容断言）
```

## 🚀 安装

**方式一：zip 直接导入（推荐，无需克隆仓库）**

1. 下载仓库根目录的 `xin-ideas.zip`
2. 直接导入到支持 skill 的 agent 工具即可使用

**方式二：skills.sh 一键安装（需 Node.js/npx）**

```bash
npx skills add oscar-wang-xin/xin-ideas
```

**方式三：复制到 skills 目录**

1. 克隆或下载本仓库
2. 将 `xin-ideas/` 整个目录复制到你所用工具的 skills 目录，例如：
   - Claude Code：`~/.claude/skills/`
   - Codex：`~/.codex/skills/`
   - 或你所用 agent 工具约定的 skills 目录
3. 在对话中触发：「收集灵感」「记个想法」「灵感库」「记一笔」「做个灵感评估」，或直接 `xin-ideas`

> 依赖：Node.js（运行 `scripts/` 下的脚本）；类 Unix shell 环境（`date +%Y%m%d_%H%M%S` 生成时间戳）。输出页面为标准 HTML，无需构建工具。

## 📝 使用

所有产物集中在一个 `.xin-ideas/` 目录内（位置由 `config.json` 的 `baseDir` 决定，首次使用会弹窗询问，默认为 skill 安装目录）：

| 产物 | 位置 | 说明 |
|------|------|------|
| 卡片列表页 | `<baseDir>/.xin-ideas/index.html` | 唯一入口，卡片墙 + 搜索/排序 |
| 灵感明细页 | `<baseDir>/.xin-ideas/ideas/idea_<时间戳>.html` | 十维评分 + 完整拆解 |

> 复制整个 `.xin-ideas/` 目录即可完成备份或迁移。**重复使用同一目录时按增量更新**：已有灵感只增不删；索引结构不一致会先备份 `index.html.bak`，再从 `ideas/` 重建，绝不丢失历史内容。

每个灵感包含：构思原话、一句话结论、十维分数与评价、可行性专项评估、收益 vs 代价、问题与应对、落地路线图、要避的坑、量化判据、成本量级、参考提示词。

**写入与巡检脚本**

```bash
node scripts/upsert-idea.js --base "<baseDir>" --detail <idea.json>   # 生成明细页 + 合并索引
node scripts/upsert-idea.js --base "<baseDir>" --rebuild             # 扫描 ideas/ 重建索引
node scripts/upsert-idea.js --base "<baseDir>" --sync-pages          # 存量明细页对齐当前模板
node scripts/health-check.js --baseline                              # 只读体检
node scripts/smoke-test.js                                           # 模板回归（改模板后必跑）
node scripts/test-upsert.js                                          # 合并器回归（改合并器后必跑）
```

**效果预览**

`.xin-ideas/index.html` 卡片列表页：

<img src="docs/screenshots/index.png" alt="灵感库列表页（.xin-ideas/index.html）" width="720">

`.xin-ideas/ideas/idea_<时间戳>.html` 灵感明细页（十维雷达、可行性评估、参考提示词）：

<img src="docs/screenshots/detail.png" alt="灵感明细页（.xin-ideas/ideas/idea_时间戳.html）" width="720">

> 截图为模板示例数据，非真实灵感。

## 🔒 隐私说明

- **灵感数据（`.xin-ideas/` 目录）是你的运行时产物，可能包含个人想法与敏感信息**，已写入 `.gitignore`，不会被提交。
- `config.json` 中的 `baseDir` 是你本机的灵感墙位置，**请勿把含个人路径的配置提交到公共仓库**。
- 本仓库仅含 skill 指令、模板与脚本，不含任何真实灵感数据，可放心开源。
- 所有页面均为纯静态、零外部网络请求，数据只存于你的本地目录。

## 📄 许可证

[MIT](LICENSE) © 2026 xin-ideas contributors

---

# xin-ideas · Idea Health Check & Actionable Breakdown (English)

> Toss an idea in — examine it first, build later. An open-source skill that scores every idea across **10 dimensions**, adds a feasibility assessment and an actionable breakdown, and produces beautiful, fully static, offline HTML detail pages plus a searchable idea wall — with **copy-paste AI prompts** for each idea.

This repository contains only the skill itself, its templates and scripts — **no idea data**. Your ideas live exclusively in your local folder.

## ✨ Features

- **10-dimension scoring (1–10)**：Problem solved / Practicality / Market value / Target users / Competitive analysis / Monetization / Technical approach / Scalability / Implementation plan / **Feasibility**, graded S/A/B/C/D by average
- **Feasibility assessment**：structured output for required skills, resources, a feasibility verdict, and the cost basis behind every estimate
- **Reference prompts**：3–4 ready-to-copy prompts per idea (requirement breakdown / competitor research / tech selection / low-cost validation), each with a copy button
- **Actionable breakdown**：benefits & costs, risks & mitigations, phased roadmap, pitfalls, quantified success/failure criteria, cost estimates
- **Raw idea capture**：keeps your original words verbatim; a quote card on the detail page and an "原话" badge on cards
- **Dual themes**：AURORA (purple-teal, default) / ROBOT (cold white mech), one-tap switch that persists across pages
- **Beautiful self-contained pages**：radar chart (inline SVG), score bars, roadmap timeline, criteria table, cost cards; zero CDN, zero external requests
- **Idea wall**：real-time search, multiple sort orders, opens details in a new tab
- **Nothing gets lost**：an incremental writer (`upsert-idea.js`) only ever appends; the index can be rebuilt from detail pages
- **Mobile-first**：single-column layout, large touch targets, draggable floating buttons
- **Privacy-friendly**：idea data is local and excluded by default via `.gitignore`

## 📁 Directory Structure

```
xin-ideas/                      # The skill itself (copy the whole folder into your skills dir)
├── SKILL.md                    # Skill definition & full workflow
├── config.json                 # Idea-wall location (baseDir) and default theme
├── assets/templates/           # Render templates
│   ├── detail.html             # Detail page (10-dim radar + feasibility + prompts)
│   └── index.html              # Index page (card wall)
└── scripts/                    # Functional scripts (Node.js, no dependencies)
    ├── upsert-idea.js          # Incremental writer (never overwrites)
    ├── health-check.js         # Read-only audit
    ├── smoke-test.js           # Template regression
    └── test-upsert.js          # Writer regression (34 no-data-loss assertions)
```

## 🚀 Installation

**Option 1: Import the zip (recommended — no cloning needed)**

1. Download `xin-ideas.zip` from the repo root
2. Import it directly into any skill-supporting agent tool

**Option 2: Install via skills.sh (requires Node.js/npx)**

```bash
npx skills add oscar-wang-xin/xin-ideas
```

**Option 3: Copy into your skills directory**

1. Clone or download this repository
2. Copy the `xin-ideas/` folder into your agent's skills directory, e.g.：
   - Claude Code：`~/.claude/skills/`
   - Codex：`~/.codex/skills/`
   - or wherever your agent expects skills
3. Trigger it with phrases like "collect an idea", "rate this idea", or simply `` `xin-ideas` ``

> Requirements: Node.js (for the `scripts/` folder); a Unix-like shell for `date +%Y%m%d_%H%M%S`. Output is plain HTML, no build tooling needed.

## 📝 Usage

Everything lives inside a single `.xin-ideas/` folder (its location comes from `config.json` → `baseDir`; the first run asks where to create it, defaulting to the skill install directory):

| Artifact | Location | Description |
|----------|----------|-------------|
| Idea index page | `<baseDir>/.xin-ideas/index.html` | Single entry point: card wall with search / sort |
| Idea detail page | `<baseDir>/.xin-ideas/ideas/idea_<timestamp>.html` | 10-dimension scores + full breakdown |

> Copy the whole `.xin-ideas/` folder to back up or migrate. **Updates to an existing folder are incremental**: existing ideas are only appended to, and a mismatched `index.html` is backed up to `index.html.bak` before rebuilding from the `ideas/` folder.

Every idea includes: the original raw words, a one-line takeaway, 10-dimension scores and reviews, a feasibility assessment, benefits vs. costs, risks & mitigations, a phased roadmap, pitfalls, quantified criteria, cost magnitude, and reference prompts.

**Writer & audit scripts**

```bash
node scripts/upsert-idea.js --base "<baseDir>" --detail <idea.json>   # detail page + index merge
node scripts/upsert-idea.js --base "<baseDir>" --rebuild             # rebuild index from ideas/
node scripts/upsert-idea.js --base "<baseDir>" --sync-pages          # align existing pages to template
node scripts/health-check.js --baseline                              # read-only audit
node scripts/smoke-test.js                                           # template regression
node scripts/test-upsert.js                                          # writer regression (no data loss)
```

## 🔒 Privacy

- **Your idea data (the `.xin-ideas/` folder) is a local artifact and may contain personal or sensitive thoughts** — it is covered by `.gitignore` and will never be committed.
- `baseDir` in `config.json` is your machine-local path; **do not commit a config with personal paths to a public repository**.
- This repository contains only skill instructions, templates and scripts — no real idea data, safe to open-source.
- All pages are fully static with zero external network requests; data stays in your local folder.

## 📄 License

[MIT](LICENSE) © 2026 xin-ideas contributors
