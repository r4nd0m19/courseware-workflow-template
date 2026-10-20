---
description: 从已批准课件脚本投影分镜，生成 plan.md 与 storyboard.yml。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 前置条件：
   - `courseware.md` 已获人工 `approve`（frontmatter `status: APPROVED`）。
   - `review-sections.yml` 存在，并覆盖全部非 SKIP 屏（连续、无重叠）。
   - `component-plan.md` 与简报已获 `approve`；所有 `new`/`extend` 组件已注册进 core。
   - `registry/index.json` 通过 `check-registry`。
2. 用 `.specify/templates/plan-template.md` 写技术计划 `plan.md`：覆盖矩阵、组件映射、**源码直拷与保真策略**、deck data 映射、页面预算、闸门与风险。**不要重写教学内容**。
3. 从脚本投影机器可读分镜，不手写、不手改：
   ```bash
   node workflow/tools/script-to-storyboard.mjs courseware.md --out storyboard.yml
   ```
   如需核对一致性：
   ```bash
   node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml
   ```
4. 覆盖规则：
   - content pack 中每个 `required: true` 项必须至少被一个非 SKIP 屏的 `contentRefs` 引用。
   - 允许新增内容；不得删减参考内容；引用不存在的 content ID 会失败。
5. 页面预算与运行时：
   - 舞台复刻参考几何（1440×900 下 1380×742）；内容列 1120px（quiz-code 1080px）。
   - deck 是数据驱动：`prototype/site/slides.js` 的 slide 顺序与 storyboard 一致；`type` 必须是 `fidelity.json` 的 `sourceTypes`、已注册 core 组件 id，或已批准 component-plan 中声明且由本页/前序页实现的 new/extend 组件 id。
   - 参考 CSS/JS 保持 `SOURCE.json` 哈希；组件 bundle 与 `audio.js` 由工具生成，不手写。
   - 一页一个教学单元；所有内容单页完整显示，**不允许滚动条**。
   - 超页只改脚本（语义边界拆页、`continuedFrom` / `continued`），再重新投影。
6. 组件规则：
   - 分镜只能使用风格包或已注册 `status: core` 的组件；`deprecated` 不得使用。
   - 如脚本引用了未注册组件：确认它已在已批准的 component-plan/简报中声明；分镜可以引用该 id，实现由首次使用它的页面在页面循环内完成；**不得在分镜或实现中临时发明组件**。
7. 运行闸门：
   ```bash
   node workflow/tools/validate-json.mjs workflow/schemas/storyboard.schema.json storyboard.yml
   node workflow/tools/check-review-sections.mjs review-sections.yml storyboard.yml --require-approved
   node workflow/tools/check-coverage.mjs <content-pack> storyboard.yml [waivers.json]
   node workflow/tools/check-vocabulary.mjs storyboard.yml <style-pack-manifest> registry/index.json
   node workflow/tools/check-teaching.mjs storyboard.yml <content-pack>
   ```
8. 输出：plan 路径、storyboard 路径、覆盖矩阵、组件映射、自动检查结果。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `review/self-review-storyboard.json` 和 `.md`。
- 运行/读取 schema/coverage/vocabulary/teaching/repository 检查；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 只有自审 pass 后才进入 Human Review；不得自行把屏标成 APPROVED。

## Human Review（强制）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 `plan.md` + `storyboard.yml` + 覆盖矩阵。
- 主动提出审核请求：逐屏状态、contentRefs 覆盖、组件来源/版本、超页拆页、自动检查结果。
- 明确询问：`Approve storyboard? (approve / reject / request changes)`。
- 未获 `approve` 不得进入 tasks/implement。
