# 组件简报：edge-sum-lab

## 1. 复用检索

- 检索命令：`node workflow/tools/search-registry.mjs --registry examples/registry/index.json --query "matrix edge sum" --tags "matrix,edge" --level modify`
- 命中组件与版本：`matrix-lab@1.0.0`（高亮/选择），`quiz-single@1.0.0`（单选答题）。
- 现有组件为何不够：`matrix-lab` 没有累计和、提交判定与漏选反馈；`quiz-single` 不能操作矩阵单元格。

## 2. 缺口与决定

- 缺口描述：需要“点击边缘格子 + 实时累计 + 提交校验 + 边界误区反馈”的组合交互。
- 决定：`new`。
- 与已有组件的关系：复用 `matrix-lab` 的网格视觉与键盘导航模式，但不修改其代码，避免影响已用课件。

## 3. 学习目标与成功标准

- 对应 objectiveId：O1
- 互动层级：modify
- 学生要完成的具体动作：点击所有位于第一行、最后一行、第一列、最后一列的格子，然后提交。
- 成功标准：选中的格子集合恰好等于边缘集合；累计和正确显示。
- 对应误区：M2 忽略第一行/第一列的边界；漏选角上格子时给出针对性反馈。

## 4. 交互状态机

| 状态 | 事件 | 下一状态 | 反馈 | 条件 |
|---|---|---|---|---|
| idle | click-cell | selecting | 高亮格子并更新累计和 | 格子未选中 |
| selecting | click-cell | selecting | 取消高亮并回退累计和 | 格子已选中 |
| selecting | reset | idle | 清空选择，累计和归零 | 任意 |
| selecting | submit | correct | 显示“边界完整，和为 26” | 集合等于边缘集合 |
| selecting | submit | incorrect | 标出漏选/多选的具体格子，并关联误区 M2 | 集合不等于边缘集合 |
| incorrect | click-cell | selecting | 清除错误标记，继续编辑 | 任意 |
| correct | reset | idle | 清空选择与反馈 | 任意 |

- 初始状态：`idle`
- 完成状态：`correct`
- 重试/重置：任意状态可重置回 `idle`。
- 不可用状态：`disabled`（只读演示时禁用点击并显示静态替代）。

## 5. Props API

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| values | number[][] | 是 | — | 矩阵数值，2–6 行、2–6 列 |
| disabled | boolean | 否 | false | 只读演示模式 |

`propsSchema` 必须设置 `additionalProperties: false`；未知 prop 是硬错误。

## 6. 视觉状态与布局约束

- 使用的风格包 tokens：`--surface`、`--border`、`--accent`、`--success`、`--danger`、`--space-2`、`--radius-md`。
- 视觉状态：default / hover / focus / selected / correct / incorrect / disabled。
- 最大尺寸：720×520；最小尺寸：360×260。
- 兼容 layout：`content-slide`、`split-slide`。
- 无滚动条约束：矩阵超过 6×6 时拆成多屏，不缩小字号、不裁切、不滚动。

## 7. 无障碍

- 键盘：方向键在格子间移动；Space 切换选中；Enter 提交；R 重置。
- 焦点：可见焦点环；焦点顺序按行优先；不设置焦点陷阱。
- ARIA：网格使用 `role=grid`/`role=gridcell`；`aria-selected` 暴露选中状态；反馈区 `aria-live=polite`。
- 对比度：正文与反馈达到 WCAG AA 4.5:1。
- 减少动画：`prefers-reduced-motion` 下取消高亮过渡，仅保留即时状态变化。
- 屏幕阅读器文本：每个格子播报“第 r 行第 c 列，值 v，已选/未选”。

## 8. 静态降级

- 无 JS / 不可交互时：显示同一矩阵，用粗边框标出所有边缘格子，并在下方给出求和算式。
- 降级组件：`rich-text` + `table` 的静态组合。
- 降级后仍必须覆盖：边缘定义、求和结果、角上格子只计一次。

## 9. 测试计划

- 交互测试：覆盖状态机全部 7 条 transition，至少一个漏选角上格子的用例。
- 视觉基线：1440×900 必测；1366×768 必测（无滚动条）。
- 溢出测试：组件 story 页在基准视口无滚动条与裁切。
- 无障碍测试：键盘走查 + `aria-live` 播报检查。
- 内容样例：3×3 真实课件用例 + 1×1 边界用例。

## 10. 风险与非目标

- 行为错误风险：重复计数角上格子；提交判定必须用集合而不是累加长度。
- 性能/渲染风险：格子数量受限在 6×6，避免小屏溢出。
- 非目标：转置、旋转、任意形状选区。
- 回滚策略：若审核未通过，删除 staging 包，脚本退回复用 `matrix-lab` 的静态方案。

## 11. 审核

- 简报审核人：demo teacher
- 审核日期：2026-10-19
- 结论：approve
