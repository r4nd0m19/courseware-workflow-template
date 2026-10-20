# AGENTS.md

本仓库使用 Spec Kit 工作流生产信奥互动课件。Codex 在本仓库工作时，先读本文件，再按任务读 `workflow/README.md`。

## 运行模型

- 工作流引擎是 Spec Kit，不绑定单一 harness。项目安装后，Codex 技能在 `.agents/skills`，Claude Code 技能在 `.claude/skills`。
- Codex 调用命令用 `$speckit-*`；Claude Code 用 `/speckit-*`。不要手动编辑这两个目录里的 `SKILL.md`，它们由 `specify preset add` / `specify integration use` 生成。
- 工作流的 `integration` 输入默认 `auto`（跟随 `.specify/integration.json` 的项目默认）。在 Codex 中运行完整流程时显式传 `-i integration=codex`，不要修改项目默认集成。
- 非交互/脚本化运行 `specify workflow run` 时加 `</dev/null`。Codex 在 stdin 不是 TTY 时会等待额外输入，缺这个重定向会看起来像卡住。
- 本模板只含工作流，不含具体课件的壳、注册表、研究资料和插画。跑完整流程前，把本项目的 shell/style pack 放到 `shells/`，把内容包放到 `research/` 或项目约定路径。

完整工作流示例（参数按当前 lesson 替换）：

```bash
specify workflow run courseware-production \
  -i integration=codex \
  -i lesson=<lesson-slug> \
  -i content_pack=<content-pack.json> \
  -i courseware_script=specs/<lesson-slug>/courseware.md \
  -i concepts=specs/<lesson-slug>/concepts.yml \
  -i review_sections=specs/<lesson-slug>/review-sections.yml \
  -i storyboard=specs/<lesson-slug>/storyboard.yml \
  -i style_pack=shells/<shell>/style-pack.manifest.json \
  -i style_pack_full=shells/<shell>/style-pack.full.json \
  -i lesson_slug=<lesson-slug> \
  -i art_prompts=specs/<lesson-slug>/art-prompts.json \
  -i art_dir=generated/<lesson-slug> \
  -i deck_data=specs/<lesson-slug>/deck.json \
  -i deck_url=http://127.0.0.1:8082/ \
  -i page_count=<page-count> \
  < /dev/null
```

## 产物与事实源

- `specs/<lesson>/spec.md`：教学简报（UbD）。
- `specs/<lesson>/concepts.yml`：核心概念台账；每个概念的术语、定义、`mustAppear` 短语必须真正出现在引入页的屏幕内容里。只写在旁白或代码声明里不算。
- `specs/<lesson>/courseware.md`：人类可读课件脚本，整份一次人工审核。
- `specs/<lesson>/storyboard.yml`：从 `courseware.md` 投影出的分镜，不应手工改。
- `specs/<lesson>/deck.json`：声明式 deck；只允许 `type` / `component` / `props` 等数据字段，禁止 `style`、`className`、`html`、`innerHTML`、`on*`。
- `registry/`：组件库；页面需要的组件先暂存，页面审核通过后才注册进 core。
- `review/page-approvals.json`：逐页审核账本，按 section/slide 记录脚本与截图哈希。不要绕过或手改冻结状态。

## 门禁

硬门禁失败就是失败，不要用 `|| true`、改判据或删除检查来“通过”。常用命令：

```bash
node workflow/tools/check-script.mjs ...
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
- 每个页面先尝试互动设计；只有没有互动设计能比静态页产生更好的学习证据时，才做静态页。一页一个语义边界，放不下就拆页或改交互。

## 安全与隐私

- 账号、密码、登录会话只存在于 `tools/r0/credentials.local.json`（600）和 `/tmp`；不要读取、打印、提交或复制到其他文件。
- `research/raw/`、`research/r0/mirror/`、`research/r0/screenshots/` 含第三方内容、本机路径或个人信息；不要放进可分享产物。
- 参考课件里的用户姓名、头像、平台信息不得进入风格包、截图或课件。
- 生成的插画在授权问题解决前只在本地使用；不要发布到外部服务。
- 不要主动 `git add` / `git commit` / `git push`，除非用户明确要求。提交时全局 gitleaks 钩子会扫描密钥、私网 IP、个人邮箱和本机路径；不要设置仓库级 `core.hooksPath` 覆盖全局钩子。
- 如果要把本项目发布为可分享模板，先确认 `workflow/preset` 的许可、壳/参考素材授权和所有截图/研究资料已脱敏。

## 不要做的事

- 不要为了单页改壳渲染器、壳 CSS 或 `deck.json` 结构；退回组件阶段或页面设计阶段解决。
- 不要手画参考组件；参考已有的交互按源码逐字节复制，参考没有的走 component-plan → brief → build → review → core。
- 不要在页面里塞多个语义单元来“一次讲完”；一页一个语义边界，放不下就拆页或改交互。
- 不要在没有跑门禁的情况下宣布完成；报告要给出实际命令结果和可运行 URL。
