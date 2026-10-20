# 组件简报：<component-id>

> 生成组件前的设计契约。人工批准本简报后，才允许写实现代码。所有状态、反馈、无障碍与降级都必须可测试。

## 1. 复用检索

- 检索命令：
- 命中组件与版本：
- 为什么现有组件不够（逐条对照 `whenToUse` / `propsSchema` / 交互状态）：

## 2. 缺口与决定

- 缺口描述：
- 决定：`new` / `extend`
- 如果 extend：扩展哪个已注册组件、如何保持向后兼容、版本如何升级：

## 3. 学习目标与成功标准

- 对应 objectiveId：
- 互动层级（watch / answer / modify / construct / explain）：
- 学生要完成的具体动作：
- 成功标准（可观察）：
- 对应误区（M1…）与如何暴露/反驳：

## 4. 交互状态机

| 状态 | 事件 | 下一状态 | 反馈 | 条件 |
|---|---|---|---|---|
| idle | click-cell | selected | 高亮格子；显示下标 | 格子可点 |
| selected | submit | correct | 成功反馈 | 全部选中正确 |
| selected | submit | incorrect | 指出错误并关联误区 | 有误选 |
| correct / incorrect | reset | idle | 清除反馈 | 用户点击重置 |

- 初始状态：
- 完成状态：
- 重试/重置：
- 不可用状态（disabled）：

## 5. Props API

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| rows | number | 是 | — | 行数 1–10 |
| values | number[][] | 是 | — | 矩阵内容 |
| mode | enum | 是 | — | 组件模式 |

`propsSchema` 必须设置 `additionalProperties: false`；未知 prop 直接报错。

## 6. 视觉状态与布局约束

- 使用的风格包 tokens（颜色/间距/字号/圆角）：
- 视觉状态：default / hover / focus / active / correct / incorrect / disabled / completed
- 最大尺寸与最小尺寸：
- 与哪些 layout 兼容：
- 无滚动条约束：内容超出时如何拆页/缩减，不允许滚动或裁切。

## 7. 参考源码对照（强制）

> 先证明与参考课件同源，再谈实现。不允许凭截图“重画”一个近似组件。

- 参考文件与哈希（CSS/JS/HTML 片段）：
- 复用的 DOM 结构（选择器 + 行号/片段）：
- 复用的 CSS 规则 / tokens：
- 动画与过渡（`@keyframes`、transition、APNG 帧数、`prefers-reduced-motion`）：
- 判定：`reference-verbatim`（逐字节复制） / `generated`（复用视觉语言，但行为是新写的）
- 如果偏离参考源码：必须写明原因、影响范围与人工批准记录
- 保真验证：
  - [ ] 源码文件 SHA-256 与参考一致（`reference-verbatim`）
  - [ ] 渲染 DOM 命中简报中的全部选择器
  - [ ] 关键计算样式（布局/颜色/字号/动画名）一致
  - [ ] 动画资产帧数/循环方式一致
  - [ ] 1440×900 截图与参考基线对照，差异已解释
- 使用的参考组件类型（fidelity.json `sourceTypes`）：

## 8. 无障碍

- 键盘：Tab / Enter / Space / 方向键分别做什么
- 焦点：焦点环、焦点顺序、焦点陷阱（如有）
- ARIA：角色、标签、状态播报（`aria-live`）
- 对比度：文字/控件/反馈的对比度目标
- 减少动画：`prefers-reduced-motion` 下的替代
- 屏幕阅读器文本：

## 9. 静态降级

- 无 JS / 不可交互时的等价内容：
- 降级组件的 props：
- 降级后仍必须覆盖的内容：

## 10. 测试计划

- 交互测试：状态机的每条 transition 至少一个用例
- 视觉基线：1440×900 必测；1366×768 建议
- 溢出测试：组件 story 页在基准视口无滚动条
- 无障碍测试：键盘走查 + axe（如项目已有）
- 内容样例：至少一个真实课件用例 + 一个边界用例

## 11. 风险与非目标

- 行为错误风险（AI 生成界面常见）：
- 性能/渲染风险：
- 非目标：
- 回滚策略：

## 12. 审核

- 简报审核人：
- 审核日期：
- 结论：待审核 / approve / request changes
