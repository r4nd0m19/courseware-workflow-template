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
- 需要老师选择时，必须调用原生选择框，选项只用中文：**“通过，继续”** / **“不通过，需要改”**。不要出现 `approve` / `reject`；不要在聊天里让老师打字选择。原生 UI 失败就停下报告，不要退回文字提问。
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

- 工作流里 13 个人工 gate 都是 `gui-gate`（类型名保留，定义在 `workflow/steps/gui-gate/`）。非 TTY 运行时它把审核请求写到 `review/<lesson>/gui-gates/`，并停在 `paused`。
- 安装 `workflow/install.mjs` 会把 step 包复制到 `.specify/workflows/steps/gui-gate/`。旧版本安装的 `courseware-approval` MCP server 条目会被移除；审核不再依赖 MCP 面板。
- verdict 绑定 `runId` / `stepId` / `gateKey` / `digest` / `nonce`，一次性消费。`review/<lesson>/gui-gates/` 是运行时状态，不要提交。
- agent 不得手写 `review/<lesson>/gui-gates/verdicts/*.json`、不得篡改 pending 记录、不得用 `-i` 预填 gate 答案。verdict 只能由 `gate-review.mjs decide` 在老师明确回答后记录。
- 页级工具 fail closed：`build-screen` / `check-rendered-section` / `freeze-section` 只在 `SPECKIT_WORKFLOW_RUN_ID` 指向 `courseware-production` 的 run 内运行；`freeze-section` 还要求同一 run 里最近一个 `review-page` gate 已 `approve` 且消息包含本页 section id。手工调试/测试必须显式加 `--manual`（`build-screen` 也可 `--alpha`）；不要把 `--manual` 当成正常流程。

完整工作流示例（参数按当前 lesson 替换）：

```bash
node workflow/tools/run-workflow.mjs courseware-production \
  -i integration=codex \
  -i lesson=001-2d-arrays \
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
3. 在项目里查找已有内容包和壳：
   - 有内容包就直接用；只有源资料就用 `speckit.extract-content` 整理（agent 自己做）。
   - 只有一个壳就直接用；有多个壳时给老师看预览链接/截图让老师选。
4. 根据课程名生成 `lesson` / `lesson_slug`，准备 `specs/<slug>/` 和工作流输入。技术参数由 agent 自己填，不要让老师选。
5. 用 `node workflow/tools/run-workflow.mjs courseware-production ...` 启动；到 gate 时用原生中文选择框（“通过，继续”/“不通过，需要改”）。
6. 如果老师只说“开始做课件”但还没给资料：先问资料，不要猜课程内容，也不要用别的课件的草稿内容代替。

## 人工审核闸门与审批账本

- 脚本批准只由工作流的 `review-script` 人工 gate  + 紧随其后的 `approve-script` 机械步骤产生。`approve-script` 必须收到 gate 的 `approve` 结果，并核对本次 run 在 `.specify/workflows/runs/<run-id>/state.json` 里的 `review-script` 步骤确已 `completed` 且 choice 为 `approve`（`paused` 的 gate 不能铸造批准）。账本记录整份 `courseware.md` 的 SHA-256、屏数、每屏哈希与 gate run id。不要手动运行 `approve-script.mjs`，不要手改该账本或 run 状态，也不要把脚本/截图标成人工 APPROVED。
- 批准与**当时的文本**绑定。任何对 `courseware.md` 的编辑（包括只改旁白、制作字段或 frontmatter）都会使账本失效；必须重新走 `review-script` 人工 gate。
- 所有下游工具（component-plan、narration、storyboard 修订、组件、deck、截图、冻结）都会重新校验账本及其 gate run 状态。`node workflow/tools/check-script-approval.mjs <courseware.md>` 失败就是阻断项；不要通过传别的账本、改判据或删除检查绕过。
- 工作流在 `approve-script` 之后立刻运行 `verify-script-approval`，并用 `--expect-run` 要求账本来自当前 run；不匹配会让整次运行失败，而不是等到几阶段之后。
- `approve-script` 现在要求 production run 证据：同一 run 的 `self-review-script` 与 `check-self-review-script` 都已完成，且 `review/<lesson>/self-review-script.json` 的 `verdict` 为 `pass`、`reviewedArtifacts` 绑定当前 `courseware.md` 哈希。只有 gate 的最小 workflow 不能铸造账本；测试/调试才加 `--manual`。
- `register-staged-components` 也只允许在 production run 内、且当前 run 的 `review-page` gate 已 `approve` 时注册；手工注册必须显式 `--manual`。
- `script-to-storyboard --out` 只允许从已批准脚本投影；`--check` / `--print` 不受影响。测试/调试用 `--manual`。
- 本地文件无法证明“某个真人按了键”：能改文件的人也能改账本。上面的检查保证正常路径不会误放行、暂停的 gate 不能被当成批准。`gate-review.mjs decide` 只在老师明确回答后由 agent 调用，verdict 记录 `source: chat` / `decidedBy: teacher` 并绑定 run/step/digest/nonce；真正的信任边界是老师在自己面前的 harness 里做出的选择，agent 不代答、不伪造 verdict。
- 页循环内的 `review-page` 有 resume guard：Spec Kit 恢复嵌套步骤时会重跑父 body；`check-pending-gui-gate.mjs` 用 wrapper 设置的 `SPECKIT_WORKFLOW_RUN_ID` 认出同一 run 的 pending/decided gate，跳过页重建与自审后再进入 gate，避免 `reviewedAt` 改写使已批准的 digest 失效。不要手工删 pending/verdict、改 run 状态或绕过 guard；guard 不是批准来源，verdict 仍由 `gate-review.mjs` 按 nonce/digest 写入并一次性消费。


## 产物与事实源

- `specs/<lesson>/spec.md`：教学简报（UbD）。
- `specs/<lesson>/concepts.yml`：核心概念台账；每个概念的术语、定义、`mustAppear` 短语必须真正出现在引入页的屏幕内容里。只写在旁白或代码声明里不算。
- `specs/<lesson>/courseware.md`：人类可读课件脚本，整份一次人工审核。
- `specs/<lesson>/storyboard.yml`：从 `courseware.md` 投影出的分镜，不应手工改。
- `specs/<lesson>/deck.json`：声明式 deck；只允许 `type` / `component` / `props` 等数据字段，禁止 `style`、`className`、`html`、`innerHTML`、`on*`。
- `review/<lesson>/shell-preview.md` / `review/<lesson>/shell-shots/`：壳审核证据，由 `validate-shell` 生成；`review/<lesson>/shell-preview.json` 记录预览服务的 URL/PID。壳预览自带 30 页占位内容与 4 音色占位语音（`shells/<id>/site/preview-audio/`、`preview-data.json`）。不要手改。
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

- 自审（self-review）可以修安全的小问题，但不得把脚本/截图标成人工 APPROVED；人工审核点必须留给人。
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
- 不要为了单页改壳渲染器、壳 CSS 或 `deck.json` 结构；退回组件阶段或页面设计阶段解决。
- 不要手画参考组件；参考已有的交互按源码逐字节复制，参考没有的走 component-plan → brief → build → review → core。
- 不要在页面里塞多个语义单元来“一次讲完”；一页一个语义边界，放不下就拆页或改交互。
- 不要在没有跑门禁的情况下宣布完成；报告要给出实际命令结果和可运行 URL。
