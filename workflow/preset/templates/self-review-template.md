# AI 自审：<stage>

> 人工审核前必须完成；`verdict` 不是 `pass` 时不得请求人工审核。
> 自审只对 `reviewedArtifacts` 里的**确切字节**负责；任一产物变化都会让本自审过期。

- 阶段：
- 日期：
- 产物路径：
- 版本 / 哈希：见下方 `reviewedArtifacts`

## 1. 被审产物哈希

| 产物 | SHA-256 |
|---|---|
|  |  |

机器可读字段：

```json
"reviewedArtifacts": [
  { "path": "specs/…/courseware.md", "sha256": "…" }
]
```

`check-self-review.mjs` 会重算每个文件的 SHA-256；不一致即 `stale review`，必须重新自审，不能只改哈希。

## 2. 自动检查

| 检查 | 命令 | 结果 | 备注 |
|---|---|---|---|
| schema |  | pass/fail/skipped |  |
| content coverage |  |  |  |
| style vocabulary |  |  |  |
| teaching gates |  |  |  |
| overflow |  |  |  |
| baseline |  |  |  |

## 3. 逐屏内容密度（脚本 / 分镜 / 逐页 / Alpha 必填）

先运行信号报告，再补语义单元：

```bash
node workflow/tools/density-report.mjs <courseware.md> <storyboard.yml> \
  [--slides S04,S05,S06] --json
```

把输出里的 `signals` **原样**放进 `review/self-review-<stage>.json` 的 `density`，然后逐屏填写：

- `semanticUnits`：本屏要求学生**新建立**的语义联系。每条写 `label` + `evidence`（脚本中的原句或字段）。
- `verdict`：`pass` / `exception` / `fail`。
- `notes`：`exception` 必填，说明为什么多个单元必须同屏。

判定口径：

- 默认**一屏一个语义边界**；两个及以上新语义单元必须拆页。
- 同一条规则的多种写法、同一规则的正例/反例、并列对比的两侧、已学内容的复习/自查，算**一个**单元。
- 多个独立知识点（例如“座位表 + 定义格式 + 下标范围 + 元素个数”）算**多个**单元，不能靠“留白多”或“字号小”通过。
- `exception` 只允许并列对比、同一规则的多例、复习整合三类；需写明理由，人工审核时会被重点看。

| 屏 | 语义单元 | 工具信号摘要 | 结论 | 理由 |
|---|---|---|---|---|
|  |  |  | pass/exception/fail |  |

## 4. 逐屏互动尝试（脚本 / 分镜 / 逐页 / Alpha 必填）

每一页都必须先尝试互动；`watch` 是例外，不是默认。逐屏填：

| 屏 | 内容要求的学习动作 | 互动尝试（形式） | 证据 | 结论 | 静态理由（watch 必填） |
|---|---|---|---|---|---|
|  | locate / predict / trace / construct / modify … |  | 学生做出什么算会 | interactive / watch | 为什么没有互动优于静态 |

判定口径：

- 互动形式必须从内容的学习动作推出，不能先选组件再套内容。
- `watch` 只能配 `observe`；写了点击 / 输入 / 单步 / 改写却标 `watch`，视为 blocking。
- 静态理由必须是教学理由（例如“本页只承担定向，互动不产生新证据”），不能写“没有现成组件”“实现麻烦”。
- 选择题只用于内容要求检索/预测的屏；如果内容要求定位、追踪、构造或修改，选择题不能作为唯一证据。
- 每一页都要有 `interaction.contentDemand` / `learningAction` / `evidence`；`watch` 还要有 `whyStatic`。

## 5. 自审清单（按阶段选择）

- [ ] 产物完整，无缺页/缺项/断链
- [ ] 与 brief/storyboard/content pack 一致，无自造内容
- [ ] 未删减参考内容；新增内容有来源/理由
- [ ] 无裸 HTML/CSS/JS、未注册组件、课件级样式覆盖
- [ ] 每个 objective 至少一个回答级互动；quiz 答案/反馈完整
- [ ] 每页都尝试过互动；`watch` 页有教学理由，且不存在明显优于静态的互动
- [ ] 非 watch 互动的证据可由所声明组件产生，不是“看动画”或“点下一步”
- [ ] 每屏一个语义边界；超载已拆页或按 `exception` 写明理由
- [ ] 无滚动条/裁切；所有内容单页可见
- [ ] 无个人信息/未授权资产
- [ ] 自动检查全部 pass（skipped 必须有理由）
- [ ] 参考适配：已识别参考课专属内容并替换为本课内容，渲染页面无参考课残留
- [ ] 待人工判断项/豁免已列出

### 参考适配（页自审必填，自由填写，不套固定清单）

读参考课件源码（例如 `shells/<shell>/source/lesson.js`）和本课内容，自己判断：参考课里哪些可见内容属于参考课自己（文字、代码、文件名、标签、图片、人物道具、例子……由你识别，不限于这些），本课对应应该是什么。把识别项和替换结果写在这里；没有参考课专属内容时写明理由。机器可读字段：`referenceAdaptation`（字符串）。

## 6. 问题

| 问题 | 严重度 | 是否已修复 |
|---|---|---|
|  | blocking / non-blocking | yes/no |

## 7. 结论

- verdict：`pass` / `fail`
- 未解决风险：
- 建议人工重点看：

## 8. 机器可读

同时写 `review/self-review-<stage>.json`，字段见
`workflow/schemas/self-review.schema.json`。`check-self-review.mjs` 会校验：

- verdict 必须是 `pass`
- 不得有自动检查 `fail`
- 不得有未修复的 blocking issue
- checklist 不得有 `fail`
- `reviewedArtifacts` 的 SHA-256 必须与当前文件一致，否则视为过期自审
- 传入 `--script` / `--storyboard` 时，`density` 必须覆盖每一屏，信号必须与当前脚本/分镜一致；
  超过 1 个语义单元必须是 `exception` 且有 `notes`，`fail` 直接阻断
