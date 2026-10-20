# AGENTS.md

本仓库是信奥互动课件的生产工作流（Spec Kit preset + workflow + Node 门禁）。Codex 在本仓库工作时，先读本文件，再按任务读 `工作流说明.md` 与 `workflow/README.md`。

## 运行模型

- 工作流引擎是 Spec Kit，不绑定单一 harness。项目同时安装了 Claude Code（`.claude/skills`）与 Codex（`.agents/skills`）。
- Claude Code 调用命令用 `/speckit-*`；Codex 用 `$speckit-*`。不要手动编辑这两个目录里的 `SKILL.md`，它们由 `specify preset add` / `specify integration use` 生成。
- 工作流的 `integration` 输入默认 `auto`（跟随 `.specify/integration.json` 的项目默认）。在 Codex 中运行完整流程时显式传 `-i integration=codex`，不要修改默认集成。
- 非交互/脚本化运行必须通过 `node workflow/tools/run-workflow.mjs`，不要直接调用 `specify workflow run`。包装器会忽略非 TTY stdin，把 Spec Kit 的 `paused` 变成退出码 3，并打印 gate 的审核请求（逐页 gate 含课件 URL）与审核文件路径；直接调用 `specify workflow run` 在 gate 处会以退出码 0 返回 `paused`，容易被误判为成功。
- 看到退出码 3 表示工作流停在人工审核闸门。若输出里出现 `courseware_gate_open`，这是 GUI 闸门：停止，调用 MCP 工具 `courseware_gate_open`（参数 `{"runId":"<run_id>"}`）把审核面板展示给老师，然后等待。老师在 ZCode 面板里点击选项；面板写入与 run/step/nonce/证据哈希绑定的 verdict，MCP 服务器随即自动 `resume` 该 run。不要运行 `specify workflow resume`，不要传 `-i`，不要调用 `courseware_gate_verdict`——agent 不能代答。
- 只有内置 gate（输出里没有 `courseware_gate_open`）或老师显式在交互式终端运行时，才走终端回答；`node workflow/tools/run-workflow.mjs resume <run_id>` 保留为后备路径。
- 非交互运行不需要额外加 `</dev/null`；包装器已把 stdin 置空。交互式恢复时保留 TTY，gate 才会显示选项。

### GUI 审核闸门（ZCode MCP App 面板）

- 工作流里 13 个人工 gate 都是 `gui-gate`（定义在 `workflow/steps/gui-gate/`）。非 TTY 运行时它把审核请求写到 `review/gui-gates/`，并停在 `paused`；面板点击后由 `workflow/mcp/approval-server.mjs` 自动恢复。
- 安装 `workflow/install.mjs` 会把 step 包复制到 `.specify/workflows/steps/gui-gate/`，构建 `workflow/mcp/panel.html`，并把 `courseware-approval` 合并进 `.zcode/config.json`（保留其他 server）。改完配置要重载 ZCode 窗口/MCP servers。
- 面板 token 只出现在 MCP resource 里，不出现在任何工具结果或日志中；verdict 绑定 `runId` / `stepId` / `gateKey` / `digest` / `nonce`，且一次性消费。`review/gui-gates/` 是运行时状态，不要提交。
- agent 不得直接写 `review/gui-gates/verdicts/*.json`、不得篡改 pending 记录、不得用 `-i` 预填 gate 答案。人工审核点必须由老师在本人的 ZCode 面板里完成。

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

## 人工审核闸门与审批账本

- 脚本批准只由工作流的 `review-script` 人工 gate  + 紧随其后的 `approve-script` 机械步骤产生。`approve-script` 必须收到 gate 的 `approve` 结果，并核对本次 run 在 `.specify/workflows/runs/<run-id>/state.json` 里的 `review-script` 步骤确已 `completed` 且 choice 为 `approve`（`paused` 的 gate 不能铸造批准）。账本记录整份 `courseware.md` 的 SHA-256、屏数、每屏哈希与 gate run id。不要手动运行 `approve-script.mjs`，不要手改该账本或 run 状态，也不要把脚本/截图标成人工 APPROVED。
- 批准与**当时的文本**绑定。任何对 `courseware.md` 的编辑（包括只改旁白、制作字段或 frontmatter）都会使账本失效；必须重新走 `review-script` 人工 gate。
- 所有下游工具（component-plan、narration、storyboard 修订、组件、deck、截图、冻结）都会重新校验账本及其 gate run 状态。`node workflow/tools/check-script-approval.mjs <courseware.md>` 失败就是阻断项；不要通过传别的账本、改判据或删除检查绕过。
- 工作流在 `approve-script` 之后立刻运行 `verify-script-approval`，并用 `--expect-run` 要求账本来自当前 run；不匹配会让整次运行失败，而不是等到几阶段之后。
- 本地文件无法证明“某个真人按了键”：能改文件的人也能改账本。上面的检查保证正常路径不会误放行、暂停的 gate 不能被当成批准。GUI 闸门把点击路径收进 ZCode 面板：agent 的工具里没有 verdict 写入口，token 也不出现在工具结果里；但真正的信任边界仍是老师在自己面前的 ZCode 面板点击，agent 不代答、不伪造 verdict。
- 页循环内的 `review-page` 有 resume guard：Spec Kit 恢复嵌套步骤时会重跑父 body；`check-pending-gui-gate.mjs` 用 wrapper 设置的 `SPECKIT_WORKFLOW_RUN_ID` 认出同一 run 的 pending/decided gate，跳过页重建与自审后再进入 gate，避免 `reviewedAt` 改写使已批准的 digest 失效。不要手工删 pending/verdict、改 run 状态或绕过 guard；guard 不是批准来源，verdict 仍由面板按 token/nonce/digest 写入并一次性消费。


## 产物与事实源

- `specs/<lesson>/spec.md`：教学简报（UbD）。
- `specs/<lesson>/concepts.yml`：核心概念台账；每个概念的术语、定义、`mustAppear` 短语必须真正出现在引入页的屏幕内容里。只写在旁白或代码声明里不算。
- `specs/<lesson>/courseware.md`：人类可读课件脚本，整份一次人工审核。
- `specs/<lesson>/storyboard.yml`：从 `courseware.md` 投影出的分镜，不应手工改。
- `specs/<lesson>/deck.json`：声明式 deck；只允许 `type` / `component` / `props` 等数据字段，禁止 `style`、`className`、`html`、`innerHTML`、`on*`。
- `review/shell-preview.md` / `review/shell-shots/`：壳审核证据，由 `validate-shell` 生成；`review/shell-preview.json` 记录预览服务的 URL/PID。壳预览自带 30 页占位内容与 4 音色占位语音（`shells/<id>/site/preview-audio/`、`preview-data.json`）。不要手改。
- `registry/`：组件库；页面需要的组件先暂存，页面审核通过后才注册进 core。
- `review/page-approvals.json`：逐页审核账本，按 section/slide 记录脚本与截图哈希。不要绕过或手改冻结状态。
- `review/gui-gates/`：GUI 审核闸门的 pending/verdict/resume 运行时状态；由 `gui-gate` 与 MCP 服务器读写，不要手改或提交。

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

- 不要把 `paused` 当成成功，不要手动运行 `approve-script.mjs`，不要让 agent 代替老师回答 gate；GUI 闸门不要用 `resume` / `-i` / `courseware_gate_verdict` 绕过。
- 不要为了单页改壳渲染器、壳 CSS 或 `deck.json` 结构；退回组件阶段或页面设计阶段解决。
- 不要手画参考组件；参考已有的交互按源码逐字节复制，参考没有的走 component-plan → brief → build → review → core。
- 不要在页面里塞多个语义单元来“一次讲完”；一页一个语义边界，放不下就拆页或改交互。
- 不要在没有跑门禁的情况下宣布完成；报告要给出实际命令结果和可运行 URL。
