# AGENTS.md

本仓库是信奥互动课件的生产工作流（Spec Kit preset + workflow + Node 门禁）。Claude Code、Codex 或 ZCode 在本仓库工作时，先读本文件，再按任务读 `工作流说明.md` 与 `workflow/README.md`。

## 运行模型

- 工作流引擎是 Spec Kit，不绑定单一 harness。按项目 integration 安装：Claude Code（`.claude/skills`）、Codex（`.agents/skills`）或 ZCode（`.zcode/skills`）。
- Claude Code 调用命令用 `/speckit-*`；Codex 用 `$speckit-*`；ZCode 用 `$speckit-*` 或 `/skill <name>`。不要手动编辑这些技能目录里的 `SKILL.md`，它们由 `specify preset add` / `specify integration use` 生成。
- 工作流的 `integration` 输入默认 `auto`（跟随 `.specify/integration.json` 的项目默认）。运行完整流程时显式传 `-i integration=codex` 或 `-i integration=zcode`，不要修改默认集成。ZCode 的 AI 步骤由 `zcode -p` 执行，Codex 由 `codex exec` 执行。
- 一个项目可放多个课件：运行时状态按 `lesson_slug` 隔离到 `review/<slug>/`、`screenshots/<slug>/`、`review/<slug>/gui-gates/`；每次 workflow 运行必须传 `-i lesson_slug=<slug>`。`specs/<lesson>/`、`shells/`、`registry/`、`workflow/` 共享。
- 非交互/脚本化运行必须通过 `node workflow/tools/run-workflow.mjs`，不要直接调用 `specify workflow run`。包装器会忽略非 TTY stdin，把 Spec Kit 的 `paused` 变成退出码 3，并打印 gate 的审核请求（逐页 gate 含课件 URL）与审核文件路径；直接调用 `specify workflow run` 在 gate 处会以退出码 0 返回 `paused`，容易被误判为成功。
- 看到退出码 3 表示工作流停在人工审核闸门。包装器会打印 `Review file:`（绝对路径）、`Review links:`（课件/预览 URL）、gate options，以及 `gate-review.mjs show/decide` 与 `run-workflow.mjs resume` 命令。
- 每次人工 gate 都按同一顺序处理：
  1. 运行 `node workflow/tools/gate-review.mjs show <run_id>`（或直接读包装器输出）拿到待审 gate 与审核文件。
  2. 用通俗中文告诉老师这次看什么，并给**可点击的预览链接或文件链接**（不要给仓库路径、`show_file` 原文、哈希或技术字段）。
  3. 用原生提问 UI 让老师直接点：ZCode / Claude Code 用 `AskUserQuestion`，Codex 用其原生 user-input / approval 提示。选项标签只用中文 **“通过，继续”** / **“不通过，需要改”**；内部再映射到 `approve` / `reject`，不要把英文选项给老师看。不要用普通聊天消息代替原生选择；如果原生 UI 不可用或报错，停下并报告，不要退回文字提问。
  4. **只有老师明确回答后**，才运行 `node workflow/tools/gate-review.mjs decide <run_id> --step <step> --choice <approve|reject> --by teacher`。不要在老师回答前调用 `decide`，不要替老师选择。
  5. 运行 `node workflow/tools/run-workflow.mjs resume <run_id>`，把输出继续处理到下一个 gate 或完成。不要直接调用 `specify workflow resume`，不要传 `-i`。
- 内置 gate（输出里没有 `Review file:` / `Gate options:`）或老师显式在交互式终端运行时，才走终端回答；`node workflow/tools/run-workflow.mjs resume <run_id>` 仍是统一恢复入口。
- 非交互运行不需要额外加 `</dev/null`；包装器已把 stdin 置空。交互式恢复时保留 TTY，gate 才会显示选项。

### 对老师说话（硬要求）

- **默认老师不懂英语、不懂工作流/编程术语。** 老师看到的每一句话都必须是通俗中文。
- 禁止对老师使用：`approve`、`reject`、`gate`、`verdict`、`digest`、`nonce`、`hash`、`run id`、`content-pack`、`lesson_slug`、`site_dir`、`storyboard`、`deck`、`self-review`、`JSON`、`Markdown`、`pipeline`、`workflow`、`repository`、`branch`、`commit`、`配置`、`部署`、`命令`、`终端`、`路径`。
- 需要老师选择时，必须调用原生选择框，选项只用中文：**“通过，继续”** / **“不通过，需要改”**。不要出现 `approve` / `reject`；不要在聊天里让老师打字选择。
- **只有主聊天会话可以调用 `AskUserQuestion`。** 不要把 gate 问题交给子 agent，也不要在 `zcode -p` 子会话里调用；这些会话没有 UI 权限，会返回 `No permission client configured for AskUserQuestion`。遇到这个错误就停下，明确告诉老师“原生选择框不可用”，不要退回文字提问，也不要继续往下走。
- **不要要求老师做任何技术动作**：不要运行命令、不要改文件、不要打开仓库里的路径、不要提供 JSON、不要安装软件、不要配置环境。技术动作 agent 自己做；做不到就说明“我需要先处理一个技术问题”，不要让老师代做。
- 需要课程资料时，只问：**“您有没有这门课的教案、讲义、网页、Word、PDF 或图片？放到项目文件夹里，或者告诉我文件叫什么、在哪里就行。”** 不要提 `content-pack.json`、路径格式、JSON。
- 审核时用老师能理解的说法：
  - 壳：**“这是课件的整体外观和操作方式。您点开链接翻几页、点一下按钮、听一下声音，看看是否正常。”**
  - 内容：**“这是每页要讲的内容和旁白。您看看知识点、例子、练习对不对。”**
  - 页面：**“这是第 X 页。您点开链接操作一下，看看这一页的内容和互动。”**
  - 不要说“自审报告”“哈希绑定”“证据文件”“gate”“verdict”。
- 文件只给**可点击的链接或预览地址**，不要给需要老师自己去文件夹里找的路径；如果必须给文件，给一个可点击的链接并说明“点开就能看”。
- 壳审核与具体课程内容无关：可以先审壳；内容不对时再换课程重新跑，不要用错误课件的草稿内容继续。

### 人工审核闸门（文件地址 + 原生选择）

- 工作流里只有 **3 个人工 gate**：`review-shell`（`courseware-shell`）、`review-script`、`review-page`（`courseware-production`），都是 `gui-gate`（类型名保留，定义在 `workflow/steps/gui-gate/`）。非 TTY 运行时它把审核请求写到 `review/gui-gates/`（无 `lesson_slug` 的壳工作流）或 `review/<lesson>/gui-gates/`（内容工作流），并停在 `paused`。
- 安装 `workflow/install.mjs` 会把 step 包复制到 `.specify/workflows/steps/gui-gate/`。旧版本安装的 `courseware-approval` MCP server 条目会被移除；审核不再依赖 MCP 面板。
- verdict 绑定 `runId` / `stepId` / `gateKey` / `digest` / `nonce`，一次性消费。`review/<lesson>/gui-gates/` 是运行时状态，不要提交。
- agent 不得手写 `review/<lesson>/gui-gates/verdicts/*.json`、不得篡改 pending 记录、不得用 `-i` 预填 gate 答案。verdict 只能由 `gate-review.mjs decide` 在老师明确回答后记录。
- 页级工具 fail closed：`build-screen` / `check-rendered-section` / `freeze-section` 只在 `SPECKIT_WORKFLOW_RUN_ID` 指向 `courseware-production` 的 run 内运行；`freeze-section` 还要求同一 run 里最近一个 `review-page` gate 已 `approve` 且消息包含本页 section id。手工调试/测试必须显式加 `--manual`（`build-screen` 也可 `--alpha`）；不要把 `--manual` 当成正常流程。
- **壳批准先于内容包**：`courseware-shell` 只依赖壳包，不依赖 `content_pack`/`lesson_slug`；`review-shell` 通过后 `approve-shell` 写 `review/shells/<shell_slug>/shell-approval.json`，绑定壳包全文哈希和 gate run。`courseware-production` 开头 `check-shell-approval` 校验；壳改一个字节即失效，必须重跑壳工作流。不要手写账本或用 `--manual` 绕过正常流程，也不要让老师在生产工作流里重复审壳。

完整工作流示例（参数按当前 lesson 替换）。先跑壳工作流，壳批准后再跑内容工作流：

```bash
# 1) 壳生成后立即审壳，不依赖 content pack
node workflow/tools/run-workflow.mjs courseware-shell \
  -i shell=shells/branch-choice \
  -i shell_slug=branch-choice

# 2) 壳批准后生产内容
node workflow/tools/run-workflow.mjs courseware-production \
  -i integration=codex \
  -i lesson=001-2d-arrays \
  -i shell_slug=branch-choice \
  -i content_pack=research/r0/content-ref/二维数组1.content.json \
  -i courseware_script=specs/001-2d-arrays/courseware.md \
  -i concepts=specs/001-2d-arrays/concepts.yml \
  -i review_sections=specs/001-2d-arrays/review-sections.yml \
  -i storyboard=specs/001-2d-arrays/storyboard.yml \
  -i style_pack=shells/branch-choice/style-pack.manifest.json \
  -i style_pack_full=shells/branch-choice/style-pack.full.json \
  -i lesson_slug=001-2d-arrays \
  -i art_prompts=specs/001-2d-arrays/art-prompts.json \
  -i art_dir=generated/001-2d-arrays \
  -i deck_data=specs/001-2d-arrays/deck.json \
  -i deck_url=http://127.0.0.1:8082/ \
  -i page_count=16
```

## 首次使用：从这里开始

老师安装完工作流后，通常只会说“开始做课件”或“帮我做课件”。agent 必须按下面顺序处理，不要让老师运行命令、看技术文件或使用 `speckit-*`：

1. 读项目根目录的 `START-HERE.md`，用通俗中文告诉老师接下来怎么做；不要向老师展示 `speckit-*`、workflow、gate、JSON、路径或命令。
2. 问老师要课程资料：教案、讲义、网页、Word、PDF 或图片；让老师放进项目，或告诉文件名/位置。**不要问老师要 `content-pack.json`。**
3. **先处理壳（不依赖内容包）**：在项目里查找已有壳；只有一个就直接用，有多个壳时给老师看预览链接/截图让老师选。壳生成后立刻用 `node workflow/tools/run-workflow.mjs courseware-shell -i shell=<shell> -i shell_slug=<slug>` 启动壳审核；到 gate 时用原生中文选择框让老师看壳。壳批准后才进入内容生产。
4. **再处理内容包**：有内容包就直接用；只有源资料就用 `speckit.extract-content` 整理（agent 自己做）。根据课程名生成 `lesson` / `lesson_slug`，准备 `specs/<slug>/` 和内容工作流输入。技术参数由 agent 自己填，不要让老师选。
5. 用 `node workflow/tools/run-workflow.mjs courseware-production ... -i shell_slug=<slug>` 启动内容生产；脚本审一次，之后每页审一次。到 gate 时用原生中文选择框（“通过，继续”/“不通过，需要改”）。
6. 如果老师只说“开始做课件”但还没给资料：先问资料；壳可以先做/先审，但不要猜课程内容，也不要用别的课件的草稿内容代替。

## 人工审核闸门与审批账本

- 脚本批准只由工作流的 `review-script` 人工 gate  + 紧随其后的 `approve-script` 机械步骤产生。`approve-script` 必须收到 gate 的 `approve` 结果，并核对本次 run 在 `.specify/workflows/runs/<run-id>/state.json` 里的 `review-script` 步骤确已 `completed` 且 choice 为 `approve`（`paused` 的 gate 不能铸造批准）。账本记录整份 `courseware.md` 的 SHA-256、屏数、每屏哈希与 gate run id。不要手动运行 `approve-script.mjs`，不要手改该账本或 run 状态，也不要把脚本/截图标成人工 APPROVED。
- 批准与**当时的文本**绑定。任何对 `courseware.md` 的编辑（包括只改旁白、制作字段或 frontmatter）都会使账本失效；必须重新走 `review-script` 人工 gate。
- 所有下游工具（component-plan、narration、storyboard 修订、组件、deck、截图、冻结）都会重新校验账本及其 gate run 状态。`node workflow/tools/check-script-approval.mjs <courseware.md>` 失败就是阻断项；不要通过传别的账本、改判据或删除检查绕过。
- 工作流在 `approve-script` 之后立刻运行 `verify-script-approval`，并用 `--expect-run` 要求账本来自当前 run；不匹配会让整次运行失败，而不是等到几阶段之后。
- `approve-script` 现在要求 production run 证据：同一 run 的 `self-review-script` 与 `check-self-review-script` 都已完成，且 `review/<lesson>/self-review-script.json` 的 `verdict` 为 `pass`、`reviewedArtifacts` 绑定当前 `courseware.md` 哈希。只有 gate 的最小 workflow 不能铸造账本；测试/调试才加 `--manual`。
- `register-staged-components` 也只允许在 production run 内、且当前 run 的 `review-page` gate 已 `approve` 时注册；手工注册必须显式 `--manual`。
- `script-to-storyboard --out` 只允许从已批准脚本投影；`--check` / `--print` 不受影响。测试/调试用 `--manual`。
- 参考适配每课生成一次映射；页自审只读映射、证据包和截图，发现未映射的参考课可见内容才在 `referenceAdaptation` 写增量。单次模型没有文件工具，不再每页读 `<shell>/source/lesson.js`；`check-self-review-page` 会强制非空。渲染页面不能残留参考课内容，壳/品牌/风格/布局保持不变。
- 学生可见标题不得带制作前缀：`check-script` 拒绝 `封面：` / `标题：` / `第 X 页` / `Sxx` 开头的标题；封面用 `layout`/`type` 表达。
- 0.37.0 起页循环不再跑 `check-overflow` / `check-overlap`：版面几何由截图 AI 和老师逐页审核判断；整份 Alpha/Gold 仍跑 `check-overflow`。非视觉确定性门禁（精确文本、quiz、概念、旁白、参考残留、截图/deck 绑定）继续在 `review-page` 之前阻断。
- 截图绑定当前 deck：`build-screen --deck` 记录 `deckSha256`；`check-rendered-section --deck` 发现截图缺少哈希或与当前 deck 不一致就失败，必须重建重截。老师看到的图必须来自当前构建。
- 本地文件无法证明“某个真人按了键”：能改文件的人也能改账本。上面的检查保证正常路径不会误放行、暂停的 gate 不能被当成批准。`gate-review.mjs decide` 只在老师明确回答后由 agent 调用，verdict 记录 `source: chat` / `decidedBy: teacher` 并绑定 run/step/digest/nonce；真正的信任边界是老师在自己面前的 harness 里做出的选择，agent 不代答、不伪造 verdict。
- 页循环内的 `review-page` 有 resume guard：Spec Kit 恢复嵌套步骤时会重跑父 body；`check-pending-gui-gate.mjs` 用 wrapper 设置的 `SPECKIT_WORKFLOW_RUN_ID` 认出同一 run 的 pending/decided gate，跳过页重建与自审后再进入 gate，避免 `reviewedAt` 改写使已批准的 digest 失效。不要手工删 pending/verdict、改 run 状态或绕过 guard；guard 不是批准来源，verdict 仍由 `gate-review.mjs` 按 nonce/digest 写入并一次性消费。


## 产物与事实源

- `specs/<lesson>/spec.md`：教学简报（UbD）。
- `specs/<lesson>/concepts.yml`：核心概念台账；每个概念的术语、定义、`mustAppear` 短语必须真正出现在引入页的屏幕内容里。只写在旁白或代码声明里不算。
- `specs/<lesson>/courseware.md`：人类可读课件脚本，整份一次人工审核；交互设计与制作字段保留在这里供工具使用。
- `review/<lesson>/courseware.teacher.md`：老师审核版脚本，由 `render-teacher-script` 自动生成（屏幕内容、旁白、转场、一行学生动作），不手改、不提交。
- `specs/<lesson>/storyboard.yml`：从 `courseware.md` 投影出的分镜，不应手工改。
- `specs/<lesson>/deck.json`：声明式 deck；只允许 `type` / `component` / `props` 等数据字段，禁止 `style`、`className`、`html`、`innerHTML`、`on*`。
- `review/shells/<shell_slug>/shell-preview.md` / `shell-shots/`：壳审核证据，由独立 `courseware-shell` 的 `validate-shell` 生成；`shell-preview.json` 记录预览服务的 URL/PID，`shell-report.json` 是完整报告。壳预览自带 30 页占位内容与 4 音色占位语音（`shells/<id>/site/preview-audio/`、`preview-data.json`）。不要手改。
- `registry/`：组件库；页面需要的组件先暂存，页面审核通过后才注册进 core。
- `review/<lesson>/script-approval.json`：整份脚本批准账本，绑定 `courseware.md` 的 SHA-256、每屏哈希和 gate run id。不要手改。
- `review/<lesson>/page-approvals.json`：逐页审核账本，按 section/slide 记录脚本与截图哈希。不要绕过或手改冻结状态。
- `screenshots/<lesson>/`：逐页截图与渲染元数据；页面审核和 Alpha 使用。
- `review/<lesson>/gui-gates/`：人工审核闸门的 pending/verdict 运行时状态；由 `gui-gate` 与 `gate-review.mjs` 读写，不要手改或提交。

## 门禁

硬门禁失败就是失败，不要用 `|| true`、改判据或删除检查来“通过”。常用命令：

```bash
node workflow/tools/check-script.mjs ...
node workflow/tools/check-script-approval.mjs ...
node workflow/tools/check-concepts.mjs ...
node workflow/tools/check-narration.mjs ...
node workflow/tools/check-deck-data.mjs ...
node workflow/tools/check-overflow.mjs ...
node workflow/tools/check-self-review.mjs ...
node workflow/tools/check-registry.mjs ...
node workflow/tools/smoke-test.mjs
```

- 自审（self-review）可以修安全的小问题，但不得把脚本/截图标成人工 APPROVED；人工审核点必须留给人。**页面自审是例外**：0.32.0 起它是单次模型调用，没有文件/命令工具，不能修任何东西；它报 blocking 就失败，由主 agent 修复后重跑页面。
- 0.22.0 起 `self-review-inputs` / `self-review-alpha` / `self-review-beta` / `self-review-gold` 是确定性 shell 步骤（从门禁结果与逐页自审汇总），不要当成 AI 自审去手写或改判；`self-review-script` / `self-review-component-plan` 仍是 AI 判断步骤，证据包与骨架由工具生成。**`self-review-page` 自 0.32.0 起不是 coding agent 步骤**，而是 `page-review-ai.mjs` 的单次 HTTP 模型调用。
- 0.37.0 起页面证据不再跑 `check-overflow` / `check-overlap`：版面几何由截图 AI 和老师逐页审核判断；精确渲染文本、quiz 答案位置、概念 mustAppear、旁白音频、参考残留和截图/deck 绑定仍保留为确定性门禁。整份 Alpha/Gold 的 `check-overflow` 仍在，防止整课溢出回归。不要因为删了两个几何检查就把非视觉门禁也删掉。
- 0.36.0 起页面自审默认 **`page_review_scope=visual-script`**：AI 只收到本页截图和已批准的脚本页（屏幕内容、交互设计、转场），判断可见内容是否与脚本一致，以及排版/裁切/重叠/可读性/可见占位或个人信息等视觉问题；不再把 density、确定性检查结果、概念和参考映射塞给模型。确定性页面门禁仍照常运行并阻断（精确文本、quiz、概念、旁白、参考残留、截图/deck 绑定；0.37.0 起不再包含 overflow/overlap）；AI 通过后才进入 `review-page` 人工审核。AI 发现问题时由主 agent 修改页面、重建、重截图，再跑同一视觉自审，直到通过，不要先请老师审核。旧的完整证据包路径保留：显式传 `-i page_review_scope=evidence` 可回滚；该路径与页面 density 权威（`density_authority=page`）配套。
- 0.35.0 起老师审核脚本看**老师版**：`render-teacher-script` 从 `courseware.md` 确定性生成 `review/<lesson>/courseware.teacher.md`，只含标题、对应目标、本屏作用、屏幕内容、一行“学生要做”摘要、旁白、转场；`review-script` gate 的 `show_file` 指向这份。交互设计和制作字段继续留在 `courseware.md`（唯一内容源，检查工具/分镜投影依赖），不要从源文件删除。老师版是自动生成物，不手改；脚本批准账本仍绑定完整 `courseware.md`，源文件任何编辑都会使批准失效。
- 0.34.0 起 density/segmenting 与交互/组件复杂度以**脚本自审为唯一权威**（`density_authority` 默认 `script`）：`build-script-review-evidence` 生成 `density[]` 与 `complexity[]` 骨架，`self-review-script` 在脚本阶段判断一屏一个语义边界、交互/组件是否过复杂；`check-self-review-script` 用 `--script --role script --density-authority script` 强制。多语义单元或多组件必须拆屏，或标 `exception` 并写明理由；有问题先改脚本，不要留到页面阶段。页面自审不再判断 density（`page-review-ai` 使用无 density 的输出 schema），只判断交互证据、视觉版面、组件行为、占位/个人信息。旧的页面 density 代码保留用于回滚：显式传 `-i density_authority=page` 才恢复页面唯一权威；不要同时启用两套权威。Alpha/Gold 仍继承脚本阶段已通过的 density 结论。
- 0.23.0 的“density 以页面自审为唯一权威”已被 0.34.0 取代，仅作为历史说明保留；不要按 0.23.0 的规则让脚本自审跳过 density。
- 0.24.0 起参考适配每课生成一次 `review/<lesson>/reference-adaptation.json`（`residue: replace|allow`），页自审只读映射做增量确认；`check-reference-residue` 会从渲染后的 `#slide` 文本扫描 `replace` 字符串。不要每页重读 `shells/<id>/source/lesson.js`，也不要把通用 C++ 语法标成 `replace`。
- 0.25.0 起页自审不再判断“渲染文本逐字一致”：`check-rendered-text` 对初始可见的高信号字面量做确定性阻断，长散文只做非阻断覆盖率提示。动态隐藏的后续题目/面板/检查点留给页交互审核；不要为了通过检查把隐藏内容塞进初始 DOM。新增 `blank` 组件时，要在 `check-rendered-text.mjs` 的 `collectBlocking` 里登记它初始可见的高信号 props（标题之外），否则只会做标题级检查。
- 0.26.0 起人工审核和课堂展示用 `player.html`（固定 1440×900 iframe + 整体缩放），不要用直接 deck URL 做审核链接：壳是响应式的，浏览器缩放会让直接 URL 重排，而 AI 截图固定 1440×900。`extract-shell` / `prepare-shell-site` / `check-shell --serve-preview` 会自动写入播放器；不要改壳 CSS/JS 来修缩放，播放器是外层缩放容器。
- 0.26.1 起播放器不再有外层工具栏：页面上只看到课件本身；全屏走壳内全屏按钮或 `F` 键，放大用全屏，不再提供 100% 滚动模式。不要把“课件播放器”标题栏/按钮加回来。
- 0.27.1 起播放器把 `#slide` 的背景色/背景图 `cover` 到外层，宽屏两侧显示课件自身背景，不再留天空色空白；不要改成纯色/黑边或裁切内容。
- 0.28.0 起页自审只让 AI 判断确定性检查覆盖不了的部分；`concepts` 和 `referenceAdaptation` 由 `build-page-evidence` 用确定性检查预填，AI 不要重写。0.34.0 起 density 移到脚本阶段；0.36.0 起默认 `visual-script`，页面模型只判断截图与已批准脚本的可见一致性、视觉问题、可见控件/状态和占位/个人信息；交互证据、隐藏内容和精确文本仍由确定性门禁和老师逐页审核兜底；版面几何由截图 AI + 老师判断（0.37.0 起页面证据不再跑 overflow/overlap）。不要为了“更全面”把概念/参考适配/渲染文本/quiz/溢出重新塞回 AI checklist。
- 0.29.0 起 `build-page-evidence` 并行跑确定性检查（浏览器检查并发上限 2），页循环用 `page-review-cache` 按键复用 AI 判断；共享文件变化只刷新 `reviewedArtifacts`，不重跑 AI。缓存文件在 `review/<lesson>/page-review-cache/`，是运行时状态，不要提交或手改。
- 0.30.0 起 `page-review-risk.mjs` 只做风险校准，不自动跳过 AI。001 校准显示 low 只有 S01 且有非阻断问题、medium 页含 blocking，所以**不要启用页级跳过 AI**；除非校准报告为 `missedBlocking`/`missedAny` 全空且连续多课验证。
- 0.31.0 起 `build-screen` 同时生成 1440×900 PNG（证据/老师）和 1280 宽 `aiImage`（页自审用，默认 JPEG，`--ai-format webp` 可选）；页自审只读 `aiImage`，缺失才回退 PNG。不要为了“看得更清”让 AI 重新读全分辨率 PNG，也不要删除 `aiImage` 的哈希绑定。
- 0.32.0 起页自审改为**单次模型调用**：`self-review-page` 是 shell 步骤，`page-review-ai.mjs` 读输入（0.36.0 默认 `visual-script`：本页截图 + 已批准脚本页；`evidence` 回滚模式：完整证据包）、内联 `aiImage`、发一次 Anthropic Messages 或 OpenAI Chat Completions 请求，模型只能返回 `submit_page_review` 结构化 JSON，没有文件/命令/MCP 工具。模型/端点/key 由用户配置（优先项目内 `.courseware/page-review.json`，否则 `~/.config/courseware/page-review.json`，或 `COURSEWARE_REVIEW_*`）；`check-page-review-config` 在页循环前 fail-closed。模型必须支持图片；不支持时直接失败，不要退回 `zcode -p` / `claude -p` / `codex exec`，也不要悄悄做纯文本判断。缺配置是技术问题：agent 自己排查或向用户说明“我需要先处理一个技术问题”，不要让老师填 JSON、API key 或运行命令。
- 0.32.0 静态页规则：页面明确声明 `watch` / `static-reading` 且有书面静态理由时，页自审 checklist 0（交互是否产出声明证据）记 `n/a`，不因“只是看”判 fail；只有页面声称互动/学生产出证据、实际却直接给答案时才 fail。S02 同一证据 3 次验证全部 pass（2 次保留非阻断提示）。不要把这条规则扩大成“所有静态页都免检”：声明与页面不一致、或没有书面理由的 watch/next 仍要 fail。
- 0.32.0 起 `page-review-cache.mjs` 的键包含 `aiImage` 哈希和暂存组件文件哈希；缓存命中时同时合并 `referenceAdaptation` 增量和暂存组件 `reviewedArtifacts`，并标 `reviewMeta.cached: true`。修改暂存组件后缓存必须失效；不要手工保留旧缓存。
- 0.33.0 起人工审核收敛为 **3 类**：`review-shell`（`courseware-shell`）、`review-script`、`review-page`。`review-inputs` / `review-brief` / `review-self-study-audit` / `review-shell-art` / `review-component-plan` / `review-alpha` / `review-beta` / `gold` 的人工 gate 已移除；对应 `self-review-*`/检查仍保留为内部质量步骤，不要把它们重新加回人类 gate。
- 0.33.0 起壳审核独立成 `courseware-shell` 工作流（3 步：`validate-shell` → `review-shell` → `approve-shell`），不依赖 `content_pack` / `lesson_slug`，按 `shell_slug` 写 `review/shells/<slug>/shell-approval.json`。内容工作流开头 `check-shell-approval` 校验壳包哈希和 gate run；不要在生产工作流里重新加 `validate-shell`/`review-shell`。
- 0.33.1 runner 隔离：`run-workflow.mjs` 的新 run 一律生成新 run id，不继承 `SPECKIT_WORKFLOW_RUN_ID`；`smoke-test.mjs` 启动时清除继承的 run id；`test-lesson-paths` 回归覆盖。页面实现/自审的 coding agent 不得在 workflow 内运行 `smoke-test`、`run-workflow.mjs` 或其它 workflow；测试在 workflow 外由独立终端跑。2026-10-22 的 S05 事故就是 smoke test 复用了 production run id，覆盖了 `04649d9c` 的 state/inputs/log；页面本身不是失败原因。
- 0.27.0 起页自审性能测试用 `workflow/tools/bench-page-review.mjs`（确定性管线）和 `workflow/tools/workflow-timing.mjs`（真实 run 的逐步骤耗时，含 AI）。基准不是门禁；不要把基准失败当成页面失败，也不要在基准里调用 AI。
- 概念、内容覆盖、答案位置分布、无滚动条、组件注册、页面冻结都是阻断项。新增规则或特判前，先查业界做法并走决策咨询。
- 修改组件后要重跑该组件的 core/interaction 测试、相关页面溢出检查，并刷新受影响的审核哈希。

## 安全与隐私

- 账号、密码、登录会话只存在于 `tools/r0/credentials.local.json`（600）和 `/tmp`；不要读取、打印、提交或复制到其他文件。
- `research/raw/`、`research/r0/mirror/`、`research/r0/screenshots/` 含第三方内容、本机路径或个人信息；不要放进可分享产物。
- 参考课件里的用户姓名、头像、平台信息不得进入风格包、截图或课件。
- 生成的插画在授权问题解决前只在本地使用；不要发布到外部服务。
- 项目已 `git init`，但默认不提交。不要主动 `git add` / `git commit` / `git push`，除非用户明确要求。提交时全局 gitleaks 钩子会扫描密钥、私网 IP、个人邮箱和本机路径；不要设置仓库级 `core.hooksPath` 覆盖全局钩子。

## 不要做的事

- 不要把 `paused` 当成成功，不要手动运行 `approve-script.mjs`，不要让 agent 代替老师回答 gate；不要在老师回答前调用 `gate-review.mjs decide`，不要用 `-i` 或手写 verdict 绕过。
- 不要把页自审改回 coding agent：不要用 `prompt` 步骤、`zcode -p`、`claude -p` 或 `codex exec` 跑 `self-review-page`，也不要给页面审核模型 Bash/文件/编辑工具。页自审只能走 `page-review-ai.mjs` 的单次 HTTP 调用。
- 不要为了单页改壳渲染器、壳 CSS 或 `deck.json` 结构；退回组件阶段或页面设计阶段解决。
- 不要手画参考组件；参考已有的交互按源码逐字节复制，参考没有的走 component-plan → brief → build → review → core。
- 不要在页面里塞多个语义单元来“一次讲完”；一页一个语义边界，放不下就拆页或改交互。
- 不要在没有跑门禁的情况下宣布完成；报告要给出实际命令结果和可运行 URL。
