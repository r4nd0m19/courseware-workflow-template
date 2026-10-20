---
description: 先检索组件库，再决定复用/扩展/新建；为每个缺口写组件简报。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 前置条件：`courseware.md` 已获人工 `approve`（所有屏 `status: APPROVED`）。
2. 读取脚本中每屏的 `interaction` / `componentPlan`，列出所有交互需求（学习动作 + 互动层级）。
3. **复用优先，且参考源码优先**：
   - 先查风格包中的参考组件（`style-pack/source/fidelity.json` 的 `components`）：若参考课件已有同类交互，直接列为 `reference-verbatim`，实现阶段逐字节复制其 CSS/DOM/JS，**不得重画**。
   - 再查注册表：对每个需求运行组件检索，不得凭记忆判断：
   ```bash
   node workflow/tools/search-registry.mjs --registry registry/index.json \
     --query "<学习动作>" --tags "<tag1,tag2>" --level <watch|answer|modify|construct|explain>
   ```
   记录检索词、命中组件、版本、是否满足；不满足时逐条对照 `whenToUse` / `propsSchema` / `interactionModel` 说明原因。
4. 使用 `.specify/templates/component-plan-template.md` 写 `component-plan.md`：
   - `复用检索` 表：至少一行，含检索命令与命中结果。
   - `缺口` 表：每个 `new` / `extend` 一行，写清现有组件为何不够、决定、简报路径；无缺口写 `—` 行。
   - `复用映射` 表：Slide → 学习动作 → 组件 → 来源（`reference-verbatim` / `style-pack` / `registry` / `new`）。
   - 每个 `new` 必须说明为什么不能直接复制参考源码；`reference-verbatim` 项不写实现简报，只记录源文件、哈希与选择器。
5. 每个 `new` / `extend` 使用 `.specify/templates/component-brief-template.md` 写 `component-briefs/<id>.md`，必须含：
   - 复用检索、缺口与决定、学习目标与成功标准
   - **参考源码对照**：参考文件/哈希、复用的 DOM/CSS/动画、`reference-verbatim` 或 `generated` 判定、保真验证方法
   - 交互状态机（状态/事件/下一状态/反馈/条件，可测试）
   - Props API、视觉状态与布局约束、无障碍、静态降级、测试计划、风险与非目标、审核
6. 规则：
   - `new` = 库中没有可满足的组件；`extend` = 扩展已注册组件且保持向后兼容（版本升级）。
   - 不得为一次性页面写“私有组件”；所有新组件都必须走 brief → 按页 build → 随页面 review → core。
   - 这一步只做**全局规划与简报**，不写任何实现；实现由页面循环在第一次需要它的那一页完成（见 `speckit.component-build`），不得在这里把所有组件预先建好。
   - 不允许在 `component-plan.md` 或简报中留 TODO/待定。
7. 运行闸门：
   ```bash
   node workflow/tools/check-component-plan.mjs courseware.md <style-pack-manifest.json> \
     [registry/index.json] --plan component-plan.md --briefs component-briefs
   ```
8. 输出：`component-plan.md`、简报清单、复用/新建统计、检查结果。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `review/self-review-component-plan.json` 和 `.md`。
- 检查每个交互需求都有检索记录、每个缺口都有简报、状态机/props/无障碍/降级/测试计划完整；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。

## Human Review（强制）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 `component-plan.md` + 简报。
- 主动提出审核请求：复用结论、缺口列表、每个新组件的学习动作与交互状态机、风险。
- 明确询问：`Approve component plan and briefs? (approve / reject / request changes)`。
- 未获 `approve` 不得开始任何页面实现；这一步批准的是“要建哪些组件、每个组件怎么交互”的纸面设计，不是组件实现。组件实现与页面一起审核。
