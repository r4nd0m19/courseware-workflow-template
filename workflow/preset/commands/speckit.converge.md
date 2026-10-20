---
description: Beta 收敛：把试课反馈与遗留问题变成有证据、有归属的修复清单，并完成安全修复。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 前置条件：
   - Alpha 已获人工 `approve`。
   - 已读取 `review/section-approvals.json`、`review/self-review-alpha.md`、逐屏截图、闸门结果和试课记录。
   - 所有已批准小节仍通过 `check-section-freeze`；若脚本已被改动，先停止并说明。
2. 收集问题：试课/教师反馈、Alpha 截图与基线差异、未关闭的自动检查、旁白试听问题、组件缺陷。每条问题必须有证据（屏号、截图、日志或原话），不得凭印象新增。
3. 分级与归属：
   - `blocker`：内容错误、交互反馈错误、源码保真失败、溢出、无法播放、无障碍阻断。
   - `major`：教学效果明显受损、错误反馈缺失、组件行为与简报不符。
   - `minor`：文案、节奏、非阻断的视觉偏差。
   - 每条写明归属小节/屏、修复方向、是否需要重开小节、负责人。
4. 修复规则：
   - 只改与问题直接相关的脚本/`deck data`/组件；不得顺手重构已批准内容。
   - 已批准小节的脚本必须变化时，先运行
     `node workflow/tools/reopen-section.mjs --sections review-sections.yml --id <section> --reason "<why>"`，
     按顺序重开该节及其后所有小节，再重走实现、渲染、自审、人工审核、冻结。
   - 参考 CSS/JS 逐字节副本不得修改；视觉问题只能改脚本/组件或回到风格包 M0。
   - 组件缺口退回 `speckit.component-plan`（补简报）→ 在首次使用它的页面 `speckit.component-build` → 随页面人工审核 → 注册 → `sync-deck-components`；不得在页面里临时实现。
   - 不得删除 required 内容、不得降低闸门、不得手写音频或旁白占位。
5. 修复后重跑受影响闸门（至少包含相关小节的 deck-data、source-fidelity、overflow、baseline、script、parity、narration；整份再跑 script/parity）。失败项必须修复或记录为带理由的 waiver，不能静默忽略。
6. 写 `review/converge-report.md`：
   - 结论（是否建议进入 Beta）、修复摘要、重开的小节。
   - 问题表：`ID / 严重级 / 小节·屏 / 证据 / 决定 / 负责人 / 状态`。
   - 已修复与未修复清单（未修复必须有 waiver 或后续动作）。
   - 受影响闸门的命令与结果。
7. 不做：不代替 `review-beta` 的人工判断，不修改审核结论，不跳过小节审核。

## 输出

- `review/converge-report.md`
- 本轮修改的脚本/`deck data`/组件与重开的小节
- 闸门结果与仍需人工处理的问题

## 说明

本命令只产出收敛报告与安全修复；工作流随后运行 `self-review-beta`，再由老师执行 `review-beta` gate。
