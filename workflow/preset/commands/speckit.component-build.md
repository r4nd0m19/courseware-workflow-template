---
description: 按已批准简报，只为当前页实现这一页需要的新组件；组件随页面一起人工审核，页面通过后才注册进 core。
---

## User Input

```text
$ARGUMENTS
```

## 审批闸门（必须最先运行）

```bash
node workflow/tools/check-script-approval.mjs courseware.md
```

必须 exit 0。失败说明脚本尚未获 `review-script` 人工 gate 批准、批准后又改过、批准账本缺失，或账本记录的 gate run 不存在/未完成；停止并回到工作流人工审核。不得手动运行 `approve-script.mjs`，也不得继续本命令。

## Outline

1. 前置条件：`component-plan.md` 与相关简报已获人工 `approve`；`registry/index.json` 有效。解析参数：
   ```text
   --section <review-section-id> --slides <S02A,S02B> --components <id,id> --staging <dir>
   ```
   - `--components` 是本页实际需要的 `new` / `extend` 组件（由工作流 `list-section-components.mjs` 从已批准 storyboard 与注册表算出）；**只实现这些组件**，不得顺手把整份 component-plan 里的其他组件全部建好。
   - 没有 `--components` 时停止并报错；不要从组件清单反推页面。
   - `--staging` 缺省为 `registry/staging`。
2. 对每个范围内组件，在 `<staging>/<id>/` 建包（不得直接写 `registry/components/`）。实现形态是**浏览器原生 JS 模块**，不是 JSX/MDX：
   - `runtime.js`：IIFE/浏览器脚本，调用 `window.CoursewareComponents.register('<id>', { render(s), bind(root, s) })`；不得依赖打包器。
   - `styles.css`：组件样式；只允许引用风格包 tokens/参考 CSS 规则，禁止页面级覆盖。
   - 若简报判定为 `reference-verbatim`：直接从参考课件复制对应 CSS/DOM 渲染函数/JS，保持逐字节或逐函数一致，并在 `sourceFidelity` 记录哈希与选择器；不得“重画”。
   - 只有 `generated` 组件才写新实现，且视觉语言必须来自参考 CSS。
   - `component.json`：从 `.specify/templates/component-manifest-template.json` 起稿；`id`、`name`、`version`、`status: core`、`category`、`description`、`tags`、`interactionLevels`、`whenToUse`、`whenNotToUse`、`learningFunction`、`propsSchema`（`additionalProperties: false`）、`states`、`interactionModel`（states + transitions）、`accessibility`、`fallback`、`implementation`（`.js`）、`runtime: vanilla-browser`、`styles`、`sourceFidelity`（kind/sourceRefs/selectors/animation）、`stories`、`tests`、`baselines`、`provenance`（`type: generated` 或 `reference-verbatim`、简报路径、来源课件、审核人）、`usedBy`。
   - 实现文件、stories、tests、基线截图都必须位于包内（包自包含）。
   - 若该组件是 `extend`：版本必须高于已注册版本，旧 props 保持兼容；只有本页需要的新模式写进增量。
3. 实现要求：
   - 状态机与简报逐条对应；每条 transition 有测试。
   - 只使用风格包 tokens/参考 CSS；禁止页面级样式覆盖；无滚动条/裁切。
   - 键盘、焦点、ARIA、对比度、`prefers-reduced-motion` 按简报落地。
   - 静态降级可用；不可交互时内容等价。
   - 课件工程不手写组件代码：实现只进 staging；页面只写组件 props。
   - 动画必须保留：`@keyframes`/transition/APNG 不得为了“简化”而删除；`prefers-reduced-motion` 只做可访问性降级。
4. 运行：
   ```bash
   node workflow/tools/check-staged-components.mjs --registry registry/index.json --staging <staging> --project-root . --script courseware.md
   node workflow/tools/check-component-package.mjs <staging>/<id>
   ```
   以及包内 tests、stories 构建、视觉基线检查；任何失败先修复。
   不要在这里注册组件；页面站点构建时用 `build-shell-site.mjs --staging <staging>` 把暂存组件打进本页，渲染效果就是审核对象。
5. 输出：本页范围（section / slides / components）、包路径、测试/基线结果、包检查结果、待人工判断项。

## Self-review（强制，页面审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写
  `$COURSEWARE_REVIEW_DIR/self-review-page-<section>-components.json` 和 `.md`。
- `reviewedArtifacts` 必须逐个列出本页每个暂存包的全部文件与其简报的 `sha256`；组件实现一改，这份自审即过期。
- 检查简报逐条落地（FSM、props、a11y、fallback、测试、基线）、无占位文本、无未测试 transition、本页 deck 里的 props 与交互设计一致；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 这份自审是页面自审的输入；不要单独请求一次“组件审核”。

## Human Review

- **没有独立的组件人工审核环节**。组件与页面一起审核：工作流把暂存组件打进本页站点，页面 gate 的通过即同时批准这些组件进入 core。
- 页面审核时向老师说明本页新建/暂存了哪些组件，以及它们承载的学习动作与证据；组件未获页面 `approve` 前不得注册、不得在其他页面引用。
- 页面 `approve` 后由工作流的 `register-staged-page-components` 步骤执行注册（`--only <本页未注册组件> --clean`），随后从 registry 重建站点并重跑 deck-data gate，再冻结该页。
- 注册后把结果写回 `component-plan.md` 与审核记录；注册命令不得提前执行或代替工作流执行。
