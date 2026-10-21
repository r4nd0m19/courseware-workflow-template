---
description: 生成信奥互动课件的教学简报（UbD），并建立内容覆盖映射。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 读取 `.specify/memory/constitution.md`、内容包（content pack）和风格包（style pack manifest）。
2. 使用 `.specify/templates/spec-template.md`，在 feature 目录写 `spec.md`。
3. 必须包含：
   - 学习者与前置、常见误区（带 contentRef/来源）
   - 学习目标（过程性 + 概念性）
   - **核心概念台账**：在 feature 目录写 `concepts.yml`（schema：`workflow/schemas/concepts.schema.json`），并在 `spec.md` 的「核心概念台账」一节汇总。每个概念要有术语、一句话定义、`introducedOn`、`mustAppear`（2–6 条会被逐字检查的屏幕短语）、可观察证据、来源 contentRef。
   - **评估证据先于活动**：前测预测题、迁移题、延迟题
   - **内容覆盖映射**：列出 content pack 中每一个 `required: true` 的项，以及计划覆盖它的页面/活动
4. 概念台账只收“学生必须能自己解释”的核心概念；不要把每个知识点都登记成概念。逐字语法/声明格式不是概念定义。`mustAppear` 要写成学生能在屏幕上读到的完整短语，而不是关键词堆砌。
5. 允许新增例子/练习，但不得删减参考内容；新增项要标记来源与理由。
6. 需要澄清时最多问 5 个问题；不确定处标 `[NEEDS CLARIFICATION]`，不要自行编造。
7. 不要写页面实现、组件代码或 CSS。
8. 完成后输出：spec 路径、concepts.yml 路径与概念数、required 项数量、仍需澄清的点。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `$COURSEWARE_REVIEW_DIR/self-review-brief.json` 和 `.md`。
- 运行/读取本阶段自动检查；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 只有自审 pass 后才进入下面的 Human Review；不得自行把产物标成 APPROVED/reviewed。

## Human Review（强制）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 `spec.md` 与内容覆盖映射。
- 主动向用户提出审核请求：产物路径、3–5 行摘要、自动检查结果、待人工判断项/豁免。
- 明确询问：`Approve to proceed? (approve / reject / request changes)`。
- 未获 `approve` 不得进入 script；不得自行把任何内容标成 reviewed/APPROVED。
