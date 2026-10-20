# 自学充分性审核：<lesson title>

- **脚本**：`<courseware.md>`（SHA-256 `<hash>`）
- **使用场景**：`self-study`（无老师在旁）
- **屏数**：<current>（声明预算 <declared>）
- **审核时间**：<ISO time>
- **结论**：`sufficient` / `insufficient` — <一句话理由>

> 本报告只回答「没有老师时学生能否学会」。它不评价脚本是否符合格式；格式已由 `check-script` 把关。
> 本报告不修改 `courseware.md`。补充提案见 `courseware.self-study.md`，经老师批准后才应用。

## 1. 十维评分

| 维度 | 判定 | 证据（屏号/原文） | 说明 |
|---|---|---|---|
| objectives 目标链路 | pass / gap / n/a | | |
| prerequisites 先修唤醒 | | | |
| explanation 讲解完整性 | | | |
| worked-examples 完整例题 | | | |
| practice 独立练习 | | | |
| feedback 反馈 | | | |
| misconceptions 误区处理 | | | |
| navigation 转场与定位 | | | |
| accessibility 无障碍与静态替代 | | | |
| self-regulation 卡住时怎么办 | | | |

## 2. 逐屏自学作用

| 屏 | 本屏作用 | 目标 | 状态 | 缺口 |
|---|---|---|---|---|
| S01 | activate / explain / demonstrate / practice / assess / integrate / summary | O1 | sufficient / gap / waived / n/a | |

## 3. 目标 × 自学链路

| 目标 | 讲解 | 完整例题 | 练习 | 反馈 | 屏号 |
|---|---|---|---|---|---|
| O1 | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | |

## 4. 缺口清单

按 blocking → recommended → info 排序。每条必须写依据；依据可以是 content pack、参考课件原文、课标，或明确的教学原则（如 Merrill 的示范—应用—整合、worked-example effect）。

### G01 · <标题>

- **严重度**：blocking / recommended / info
- **维度**：`worked-examples`
- **涉及屏**：S06
- **证据**：<屏幕上现在是什么；为什么学生无法自学>
- **提案**：<补什么；补在哪一屏>
- **依据**：<content pack E05 / 参考页 / 教学原则>
- **页数影响**：+0 / +1

## 5. 页数判断

- 当前：<current> 页
- 提案后：<proposed> 页
- 是否超过声明预算：是 / 否
- **需要老师决定**：<加页 / 不加页并接受哪条缺口 / 改写哪一屏>

## 6. 补充提案摘要

| 补充 id | 缺口 | 类型 | 目标屏 | 依据 |
|---|---|---|---|---|
| G01-a | G01 | worked-example | S06 | |

> 完整文本见 `courseware.self-study.md`；每处补充都有 `<!-- self-study-supplement:<id> -->` 定界和「自学补充」标签。

## 7. 自动检查结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `check-self-study.mjs` | pass / fail | |
| 脚本哈希一致 | pass / fail | |
| required 内容项全部被引用 | pass / fail | |
| 页数预算一致 | pass / fail | |
| 补充块定界与标签 | pass / fail / n/a | |

## 8. 待老师决定

- [ ] 是否批准补充提案？
- [ ] 是否允许超过 <declared> 页？
- [ ] 是否有缺口应保留并书面豁免？
