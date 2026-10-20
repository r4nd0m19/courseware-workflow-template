# 组件简报：matrix-lab

## 1. 复用检索

- 检索命令：`node workflow/tools/search-registry.mjs --registry registry/index.json --query "matrix index" --tags "matrix,index" --level modify`
- 命中组件与版本：无（首个矩阵类组件）。
- 现有组件为何不够：`quiz-single` 只能选文字选项，不能操作二维格子。

## 2. 缺口与决定

- 缺口描述：需要点击二维矩阵格子并观察行列下标的交互。
- 决定：`new`。
- 关系：后续的 `edge-sum-lab` 复用其网格视觉与键盘导航，不修改本组件。

## 3. 学习目标与成功标准

- 对应 objectiveId：O1
- 互动层级：modify
- 学生要完成的具体动作：点击任意格子，观察高亮与行列下标。
- 成功标准：任意点击都能正确显示 0-based 行列下标。
- 对应误区：M1 把行/列顺序写反；反馈中同时标出“第 r 行、第 c 列”。

## 4. 交互状态机

| 状态 | 事件 | 下一状态 | 反馈 | 条件 |
|---|---|---|---|---|
| idle | click-cell | selected | 高亮格子并显示行列下标 | 格子可点 |
| selected | click-cell | idle | 取消高亮 | 点击同一格 |
| selected | click-cell | selected | 移动高亮并更新下标 | 点击另一格 |
| idle | disable | disabled | 显示只读样式 | 只读演示 |
| disabled | enable | idle | 恢复可点击 | 退出只读 |

- 初始状态：`idle`
- 完成状态：无强制完成；以最后一次选择为准。
- 重试/重置：点击同一格取消选择。
- 不可用状态：`disabled` 时禁用指针与键盘选择。

## 5. Props API

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| values | number[][] | 是 | — | 矩阵数值，1–10 行、1–10 列 |
| disabled | boolean | 否 | false | 只读演示模式 |

`propsSchema` 设置 `additionalProperties: false`；未知 prop 是硬错误。

## 6. 视觉状态与布局约束

- 使用的风格包 tokens：`--surface`、`--border`、`--accent`、`--space-1`、`--radius-sm`。
- 视觉状态：default / hover / focus / selected / disabled。
- 最大尺寸：640×480；最小尺寸：320×240。
- 兼容 layout：`content-slide`。
- 无滚动条约束：超过 10×10 时拆页；不缩小字号、不裁切。

## 7. 无障碍

- 键盘：方向键移动焦点，Space 选择/取消。
- 焦点：可见焦点环，行优先顺序。
- ARIA：`role=grid`、`aria-selected`、格子标签“第 r 行第 c 列，值 v”。
- 对比度：文字与高亮达到 WCAG AA。
- 减少动画：`prefers-reduced-motion` 下取消过渡。
- 屏幕阅读器文本：选择变化通过 `aria-live=polite` 播报。

## 8. 静态降级

- 无 JS 时：静态表格展示矩阵，用粗体标出一个示例格子及其下标。
- 降级组件：`rich-text` + 表格。
- 降级后仍覆盖：行列下标的含义与顺序。

## 9. 测试计划

- 交互测试：状态机 5 条 transition 各一个用例。
- 视觉基线：1440×900；1366×768 无滚动条。
- 无障碍测试：键盘走查与屏幕阅读器标签检查。
- 内容样例：3×3 矩阵 + 1×1 边界。

## 10. 风险与非目标

- 行为错误风险：行列下标顺序写反；用真实矩阵用例测试。
- 性能风险：格子数限制在 10×10。
- 非目标：编辑数值、拖拽、区域选择。
- 回滚策略：若审核未通过，删除 staging 包并退回静态表格。

## 11. 审核

- 简报审核人：demo teacher
- 审核日期：2026-10-19
- 结论：approve
