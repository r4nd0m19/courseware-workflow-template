---
description: 审核课件脚本是否足够学生自学；输出缺口报告与「自学补充」提案，不改动原脚本。
---

## User Input

```text
$ARGUMENTS
```

> **工作流模式**：如果 `$ARGUMENTS` 包含 `--no-self-review`，只生成产物；跳过本文件的 Human Review（人工审核）节，不要读取 `workflow/tools` 源码、不要额外跑门禁套件或临时脚本、不要写 `review.md`。自审、校验和人工 gate 由 `courseware-production` workflow 的统一步骤负责。写完产物即结束。

## 目的

参考课件常常是**教师课堂讲授**用的：老师会口头补充、追问、给答案，屏幕只呈现提示和局部内容。直接把它做成学生自学课件，会出现「看得见结论、看不见推理」「有练习、没答案」「有动画、没解释」等缺口。

本阶段在脚本草案通过机械校验之后、人工审脚本之前，独立回答一个问题：

> **一个没有老师在旁边的学生，能否只靠这份 courseware.md 学会全部目标？**

本阶段只**报告**与**提案**，不修改 `courseware.md`，不擅自增加页数。

## 前置输入

1. `courseware.md`（{{ inputs.courseware_script }}）、`spec.md`、`review-sections.yml`。
2. content pack（{{ inputs.content_pack }}），特别是 `kind`、`text`、`code`、`output`、`feedback`、`steps`、`sourcePage`。
3. 参考课件原文（若存在，如 `research/r0/content-ref/*.md`）：用来识别哪些内容是老师口头补充的。
4. `workflow/preset/templates/self-study-audit-template.md` 与 `workflow/schemas/self-study-audit.schema.json`。

## 审核维度（10 项，缺一不可）

| id | 检查问题 | 典型缺口 |
|---|---|---|
| `objectives` | 每个目标是否有「讲解 → 示例 → 练习 → 反馈」的完整链路 | 目标只出现在概览，后面没有对应练习 |
| `prerequisites` | 先修知识是否在需要之前被唤醒或补讲 | 直接用 `for` 嵌套，却没复习循环与下标 |
| `explanation` | 屏幕内容是否解释了「为什么」，而不只是「是什么」 | 只给结论/公式，没有推理过程 |
| `worked-examples` | 每个新知识点是否至少有一个**完整**例题：题目→思路→步骤→代码→输出→易错点 | 只有题目和最终输出，答案写「见参考页」 |
| `practice` | 是否有学生可独立完成的练习，且难度递进 | 只有判断题；或练习依赖老师口头补充的条件 |
| `feedback` | 每个练习是否有针对答案的反馈；错误反馈是否绑定误区 | 只写「回答正确/再想想」 |
| `misconceptions` | spec 中每个误区是否在屏幕/反馈中被点名并反驳 | 误区只写在 spec，课件里没出现 |
| `navigation` | 每屏是否有转场，学生是否知道「现在在哪、下一步做什么」 | 连续讲解页之间没有衔接 |
| `accessibility` | 每个 watch 级内容是否有静态替代；键盘/对比度/减少动画是否说明 | 动画是唯一的信息载体 |
| `self-regulation` | 学生卡住时是否有提示、重试、自查清单或求助路径 | 练习只有一次机会，错了没有提示 |

判定规则：

- **blocking**：不补就无法自学（缺完整例题、缺关键推理、练习无反馈、误区未处理）。
- **recommended**：能学但体验明显受损（先修复习不足、转场缺失、提示层次不够）。
- **info**：可选优化，不阻塞。
- 只要存在任一 `blocking`，`verdict` 必须是 `insufficient`。

## 产出

### 1. `$COURSEWARE_REVIEW_DIR/self-study-audit.json`

按 `workflow/schemas/self-study-audit.schema.json` 写。要点：

- `script.sha256` 必须是当前 `courseware.md` 的 SHA-256。
- `mode` 固定为 `self-study`：本审核模拟「没有老师在旁边」的学生。
- `rubric` 恰好 10 项，每项 `verdict: pass|gap|n/a` 并附具体证据（屏号/原文摘录）。
- `objectives` 逐目标记录 `explanation / workedExample / practice / feedback` 四个布尔值。
- `screens` 覆盖**每一张非 SKIP 屏**且只出现一次：`role`（activate/explain/demonstrate/practice/assess/integrate/summary/other）、`status`（sufficient/gap/waived/n/a）、`gapIds`。标为 `gap` 的屏必须至少引用一个缺口。
- `gaps[]` 每条必须有：`severity`、`dimension`、`slideIds`、证据、提案、**依据**、`pageImpact`。
- `pageBudget`：`current` = 当前屏数；`proposed` = `current + Σ pageImpact`；超过声明的 10 页时 `exceedsDeclaredBudget: true`、`decision: teacher-approval-required`。**先报告，不自动加页。**
- `supplements[]`：只列**允许补充**的类型（解释、先修复习、完整例题、检查题、反馈、转场），`label` 固定为 `自学补充`，并写 `basis`（依据来自哪条内容/哪条课标/哪个教学原则）。
- `verdict`：有 blocking gap → `insufficient`，否则 `sufficient`。

### 2. `$COURSEWARE_REVIEW_DIR/self-study-audit.md`

按模板写人类可读报告，必须让老师在一屏内看懂：

- 结论（够/不够自学）与一句话理由；
- 10 维评分表；
- 缺口清单，按 blocking → recommended → info 排序，每条带屏号与证据；
- 「10 页是否够」的明确判断与 `pageImpact`；
- 补充提案摘要（不展开全文）；
- 需要老师决定的事项（例如：是否加页、是否接受某条豁免）。

### 3. `courseware.self-study.md`（仅当有补充提案）

- 从当前 `courseware.md` 完整复制，**不得删屏、不得改核心知识点**。
- 每处补充用以下定界块包住，缺一不可：

```markdown
<!-- self-study-supplement:G01-a -->
> **自学补充（依据：<basis>）**：<补充内容>
<!-- /self-study-supplement:G01-a -->
```

- 补充可以加在「屏幕内容」「交互设计」「旁白」「转场」中，但必须保持屏幕内容与旁白分离。
- 不改变原有 `id`、`objectiveId`、`contentRefs`、`status`；新增页时必须同步 `review-sections.yml`，并在报告里标出页数变化。
- **不要覆盖 `courseware.md`**；它由人工批准后的 apply 步骤替换。

## 强制校验（工作流模式 `--no-self-review` 跳过；`check-self-study` 由 workflow 执行）

```bash
node workflow/tools/check-self-study.mjs $COURSEWARE_REVIEW_DIR/self-study-audit.json \
  --script {{ inputs.courseware_script }}
```

有补充提案时，检查器会自动读取脚本同目录的 `courseware.self-study.md`。校验必须 exit 0；失败先修报告/提案，不得绕过。

## Human Review（仅非 workflow 模式）

- 展示 `$COURSEWARE_REVIEW_DIR/self-study-audit.md`，明确询问：`Approve the self-study supplement plan? (approve / reject)`。
- 不得自行批准，不得在批准前修改 `courseware.md`。
- 老师若选择「先不加页」，把相应 gap 改为 `recommended`/`info` 并在 `evidence` 写明理由后重跑校验；不要静默删除缺口。
