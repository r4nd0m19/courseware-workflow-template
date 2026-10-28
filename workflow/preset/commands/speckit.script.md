---
description: 生成人类可读的课件脚本 courseware.md（屏幕内容、交互设计、旁白、制作字段），作为唯一内容源。
---

## User Input

```text
$ARGUMENTS
```

> 多课件项目：`review/` 路径用 `$COURSEWARE_REVIEW_DIR/...`，`--approval` 用 `$COURSEWARE_SCRIPT_APPROVAL`。workflow 会设置这些变量，并通过 `$ARGUMENTS` 传 `--lesson-slug <slug>`。

> **工作流模式**：如果 `$ARGUMENTS` 包含 `--no-self-review`，优先读取 `--input <script-input.json>` 指定的紧凑输入包。包里已经包含 spec、content items、concepts、style vocabulary、registry、模板、输出路径、规则和已有脚本；不要 `ls`/`cat`/`grep` 仓库，不要读取 `workflow/tools` 源码，不要额外跑门禁套件或临时脚本，不要写 `review.md`。只按 `outputs` 写 `courseware.md` 和 `review-sections.yml`；自审、校验和人工 gate 由 `courseware-production` workflow 的统一步骤负责。写完产物即结束。

> **生产 workflow 0.42.0 起不再调用本命令**：`courseware-production` 的 `script` 步骤改由 `generate-courseware-script.mjs` 生成大纲/逐页 JSON 并确定性渲染。本命令保留给手动或非 workflow 使用；不要让 workflow 回退到它。

## Outline

1. 前置条件：`spec.md` 已获人工 `approve`；内容包、风格包 manifest 与 `.specify/memory/constitution.md` 可读。
2. 使用 `.specify/templates/script-template.md` 写 `courseware.md`，它是生成课件前的**人类可读唯一内容源**，老师直接审阅/修改。
3. 同时使用 `.specify/templates/review-sections-template.yml` 写 `review-sections.yml`：把全部非 SKIP 屏按顺序逐屏写成 section，**每个 section 恰好一屏**（`slides` 只有一个屏 ID，id/title 直接取该屏）。生成课件时逐页实现、逐页渲染、逐页人工审核；整份脚本仍只审一次。
4. 每一屏必须包含：
   - **屏幕内容**：学生实际看到的文字、代码、表格、图示；逐字写，不混入旁白。
   - **交互设计**：先写「互动尝试」——从本页内容要求学生做的学习动作出发，说明最能产生学习证据的互动形式；再写学习动作、内容依据、证据、学生动作、互动层级、初始状态、成功反馈、错误反馈（绑定误区）、完成条件、重置、无障碍、静态替代。每一页都必须尝试互动；只有写清「静态理由」、证明没有互动比静态更能产生学习证据时，才允许 `watch`。`watch` 只能配 `observe`；写了点击/输入/单步/改写，就必须用对应的非 watch 层级。
   - **旁白 / 语音**：逐字稿；等待操作处写 `[暂停]`；不得照读屏幕全文。
   - **转场**：与上一屏/下一屏的衔接。
   - **制作字段**：`id`、`title`、`objectiveId`、`contentRefs`、`components`、`layout`、`interaction`（必填：`type`、`level`、`contentDemand`、`learningAction`、`evidence`、`learningFunction`、`staticAlternative`；`watch` 另填 `whyStatic`）、`componentPlan`、`status`。
5. 内容与教学规则：
   - content pack 中每个 `required: true` 项至少被一个非 SKIP 屏的 `contentRefs` 引用。
   - 每个 objective 至少一个 `answer` 级及以上互动；`watch` 级必须有静态替代与静态理由。
   - 每个误区至少在一个互动中被暴露/反驳，并在错误反馈里点名。
   - 互动形式由内容的学习动作决定，不按组件类型凑数；同一课可以有多道选择题，但只能出现在内容确实要求检索/预测的屏。
   - 例题、代码与输出、测验题干/选项在屏幕内容中出现；旁白不替代屏幕内容。
   - 一屏一个教学单元；超页在语义边界拆页，续页填 `continuedFrom` / `continued`；不允许滚动条。
6. 组件策略：先查参考课件源码，再检索组件库（见下一阶段 `speckit.component-plan`）。
   - 参考课件已有的交互：标为 `reference-verbatim`，实现时逐字节复制其 CSS/DOM/JS，不得重画。
   - 参考没有、库里也没有：标为 `new`，写 `component-briefs/<id>.md`，走 brief → build → review → core。
   - 本阶段允许写 `componentPlan: [{id, status: reference-verbatim|existing|extend|new, brief}]` 表达需求，但**不得在页面里发明组件**；脚本中引用的所有组件最终必须来自参考源码、风格包或已注册组件。
7. 不允许 TODO/TBD/待定/占位文本。
8. 运行闸门（**工作流模式 `--no-self-review` 跳过本节**；`validate-script-draft` / `validate-concepts` / `self-study-audit` / `validate-script` 由 workflow 执行）：
   ```bash
   node workflow/tools/check-script.mjs courseware.md <content-pack.json> <style-pack-manifest.json> [registry/index.json]
   node workflow/tools/script-to-storyboard.mjs courseware.md --out storyboard.yml --draft
   node workflow/tools/check-review-sections.mjs review-sections.yml storyboard.yml
   node workflow/tools/check-source-fidelity.mjs --source-only
   ```
   投影出的 `storyboard.yml` 只用于校验逐页清单；正式分镜仍由 `speckit.plan` 在脚本批准后生成。失败项先修复；不得靠删除内容或降低 required 通过。
9. 输出：`courseware.md`、`review-sections.yml` 路径、屏数、页数、目标/误区覆盖摘要、检查结果。

## Self-review（仅非 workflow 模式，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `$COURSEWARE_REVIEW_DIR/self-review-script.json` 和 `.md`。
- 必须运行 `check-script.mjs` 且 `verdict` 为 `pass`；逐屏检查屏幕内容/旁白分离、交互反馈完整、无占位符。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 只有自审 pass 后才进入 Human Review；不得自行把脚本标成 APPROVED。

## Human Review（仅非 workflow 模式）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 `courseware.md` + `review-sections.yml` + 自审结果。
- 主动提出审核请求：逐屏屏幕内容、交互设计、旁白、误区反馈、拆页建议、逐页清单、自动检查结果。
- 明确询问：`Approve courseware script? (approve / reject / request changes)`。
- 只有老师批准后，才进入下游阶段；批准状态只能由工作流的 `review-script` gate 记录，并由紧随其后的 `approve-script` 步骤把 frontmatter 与各屏 `status` 改为 `APPROVED`、写入 `$COURSEWARE_SCRIPT_APPROVAL`。你（AI）不得自行把状态改为 `APPROVED`，不得手动运行 `approve-script.mjs`；未获 `approve` 不得进入 component-plan/plan/tasks/implement。
- 脚本批准后，课件按 `review-sections.yml` 逐页实现、逐页渲染、逐页人工审核；某一页 reject 只返工该页（已批准页由哈希冻结），不要重做整份课件。
