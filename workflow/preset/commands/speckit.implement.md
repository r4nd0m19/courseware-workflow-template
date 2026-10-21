---
description: 逐页把 APPROVED 脚本实现为数据驱动 deck，逐页渲染并等待人工审核。
---

## User Input

```text
$ARGUMENTS
```

## 运行模式

> 多课件项目：`review/` 路径用 `$COURSEWARE_REVIEW_DIR/...`，`screenshots/` 路径用 `$COURSEWARE_SCREENSHOTS_DIR/...`，`--approval` 用 `$COURSEWARE_SCRIPT_APPROVAL`，`--approvals` 用 `$COURSEWARE_PAGE_APPROVALS`；站点输出用 `site/<lesson_slug>`，不要写死 `prototype/shell-site`。workflow 会设置这些变量，并通过 `$ARGUMENTS` 传 `--lesson-slug <slug>`。

- **逐页模式（工作流默认）**：参数含 `--section <id>`。只实现/修改该页，渲染该页，提交老师审核；上一页未 `approve` 不得继续。
- **整份模式（仅手动兜底）**：参数不含 `--section`。实现全部 `APPROVED` 屏；仍需按 `review-sections.yml` 逐页自审和人工审核，不得跳过页 gate。正常生产必须由 `courseware-production` workflow 驱动；`build-screen` / `check-rendered-section` / `freeze-section` 在 workflow 外会 fail closed，不要用整份模式绕过页 gate（调试/测试才加 `--manual`）。
- **数据文件**：参数可含 `--deck-data <path>`，工作流默认传 `specs/<lesson>/deck.json`；本命令只写这个文件，不得另起 deck 数据文件。
- **暂存组件**：参数可含 `--staging <dir>`（默认 `registry/staging`）。本页需要的新组件已由 `speckit.component-build` 按页实现进暂存区；这里直接使用，不得自己实现组件，也不得要求它先注册 core。
- 人工审核以页为单位：`review-sections.yml` 每个 section 只含一页；工具参数仍叫 `--section`，但展示给老师时一律称“页”。

## 核心架构（不可偏离）

课件运行时是**参考课件源码直拷 + 数据驱动**：

- `style-pack/source/` 保存参考课件的 CSS/JS 逐字节副本，由 `SOURCE.json` 记录 SHA-256；`style-pack/source/fidelity.json` 记录外壳几何、DOM 选择器、动画与组件类型。
- `deck.json` 是唯一由本命令生成的课件数据文件：声明式 slide 对象数组。`build-shell-site.mjs` 从 `shells/branch-choice/` 外壳包和 `deck.json` 生成 `prototype/shell-site/`（`index.html`、`lesson.js`、`deck.js`、`styles.css`、`narration-plan.js`、`shell-art-data.js`、组件 bundle）。**不要手改生成站点里的任何文件。**
- 已注册的自定义组件由 `sync-deck-components.mjs` 打包进 `components.bundle.js` / `components.bundle.css`；页面只传 props，**不得把组件实现复制进 deck.json**。
- 本页新建的组件仍在 `registry/staging/`，构建时用 `build-shell-site.mjs --staging` 一并打包，供本页渲染和审核；页面通过后工作流才注册进 core。
- 旁白由 `build-narration.mjs` 生成 manifest 与 MP3；`build-shell-site.mjs` 按 slide id 注入 `narration-plan.js`，四声线由外壳顶栏选择。不得另写一套目录或播放器。
- 页面不允许裸 HTML/CSS/JS、内联样式、页面级 CSS 覆盖、字号/间距魔法数；内容超页只改脚本并重新投影。

## 审批闸门（必须最先运行）

```bash
node workflow/tools/check-script-approval.mjs courseware.md
```

必须 exit 0。失败说明脚本尚未获 `review-script` 人工 gate 批准、批准后又改过、批准账本缺失，或账本记录的 gate run 不存在/未完成；停止并回到工作流人工审核。不得手动运行 `approve-script.mjs`，也不得继续本命令。

脚本批准必须由 `courseware-production` workflow 的 `self-review-script` → `check-self-review-script` → `review-script` 产生；`approve-script` 会核对同一 run 的这两步和 `$COURSEWARE_REVIEW_DIR/self-review-script.json` 的哈希绑定。只有 gate 的最小审批 workflow 会被拒绝。

## Outline

1. 读取 `tasks.md`、`courseware.md`、`review-sections.yml`、`storyboard.yml`、`component-plan.md`、`style-pack/source/SOURCE.json`、`style-pack/source/fidelity.json`、风格包 manifest、组件注册表和 `plan.md`；从参数解析 `--section`、`--sections`、`--storyboard`、`--deck-data`、`--staging`。
2. 解析 `review-sections.yml`，确定本页与屏 ID；校验：
   ```bash
   node workflow/tools/check-review-sections.mjs review-sections.yml storyboard.yml --script courseware.md --require-approved
   node workflow/tools/check-section-freeze.mjs --sections review-sections.yml --storyboard storyboard.yml --script courseware.md --approval "$COURSEWARE_SCRIPT_APPROVAL" --approvals "$COURSEWARE_PAGE_APPROVALS"
   ```
   第二条保证已批准页的脚本没有被改动。失败时停止，不要覆盖已批准内容。
3. **只实现本页的 `APPROVED` 屏**；不要改其他页、`DRAFT`/`SKIP` 屏。
4. 编辑 `--deck-data` 指定的 `deck.json`：
   - 每个 slide 至少包含 `id`、`title`、`type` 与渲染所需 props；`id/title` 必须与 storyboard 完全一致，顺序与 storyboard 一致。
   - 若 deck 仍是占位/smoke 数据，用本页及此前已批准页的真实数据重建；已批准页的内容不得改动。
   - 屏幕文字、代码、输出、测验题干/选项从脚本「屏幕内容」逐字搬入；旁白不进入屏幕字段。
   - 交互反馈、完成条件、重置行为与脚本「交互设计」一致。
   - 交互必须产生脚本 `interaction.evidence` 声明的证据：点中的格子、填出的网格、预测的下一格、改过的矩阵。只放一个“下一步”或一段动画不算。
   - `watch` 页只能渲染静态内容，并且脚本必须给出教学理由；非 `watch` 页不得退化成静态表格/代码页。
   - 参考组件类型使用 `fidelity.json` 中的 `sourceTypes`；自定义组件类型使用其注册 id 或本页暂存 id。
   - 本页需要但既未注册、又不在暂存区的组件：立即停止，先运行 `speckit.component-build --section <id> --slides <ids> --components <ids>`；不得在 deck.json 里硬编码实现。
   - 不得新增 `html`、`innerHTML`、`style`、`on*` 等字段；不得在数据里写 `<script>`/`javascript:`。
   - 图片只引用本地资产；含个人信息的安装截图不得进入课件。
5. 组件与语音：
   - 自定义组件要么已注册为 `core`，要么已由本页的 `speckit.component-build` 放进 `--staging` 指定目录；两者都由 `sync-deck-components.mjs` 进入 bundle。本页暂存组件随页面一起审核，页面通过后由工作流注册。
   - 语音由 `build-narration.mjs` 生成 manifest；`build-shell-site.mjs` 注入站点；不得手写假音频/空旁白。
   - 目录（outline）由参考外壳从 deck 自动生成；语音选择/播放由外壳顶栏驱动。不得另写一套目录或播放器。
6. `contentRefs` 中的 required 项必须在页面上真实可见/可操作；不得用装饰或旁白假装覆盖。
7. 重建并运行技术闸门（本页）：
   ```bash
   node workflow/tools/build-shell-site.mjs --script courseware.md --shell <shell-dir> --deck <deck.json> \
     --art <art-dir>/art-manifest.json --narration <narration.json> --audio-dir <audio-dir> \
     --registry registry/index.json --staging registry/staging --out prototype/shell-site --force
   node workflow/tools/check-deck-data.mjs --script courseware.md --url "<deck-url>" --shell <shell-dir> --storyboard storyboard.yml \
     --sections review-sections.yml --section <id> --fidelity style-pack/source/fidelity.json --registry registry/index.json --staging registry/staging
   node workflow/tools/check-rendered-section.mjs --sections review-sections.yml --storyboard storyboard.yml --section <id> --screenshots screenshots
   node workflow/tools/check-overflow.mjs "<deck-url>" --script courseware.md --start <section.start> --pages <section.count>
   node workflow/tools/check-baseline.mjs screenshots --baseline <baseline-dir> --include <id>
   node workflow/tools/check-narration.mjs courseware.md <narration.json> --audio-root <audio-dir> --only <id>
   node workflow/tools/check-script.mjs courseware.md <content-pack> <style-pack-manifest> registry/index.json
   node workflow/tools/check-quiz-keys.mjs <deck.json> --slides <id>
   node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml
   ```
   任何硬项失败 → 停止并报告，不要绕过。
8. 内容超页时只改脚本并重新投影（续页 `continuedFrom`），不改字号/间距硬塞，不滚动/裁切。
9. 如发现组件行为不满足脚本：本页暂存组件直接修包并重跑本页组件自审；已注册组件需要 `extend` 时，先补简报与 component-plan（人工批准），再在首次使用它的页面重建。不得在 deck.json 里加特判，也不得在生成站点里写页面分支。
10. 如本页必须改动已批准页的脚本/设计：停止，说明原因，先运行
    `node workflow/tools/reopen-section.mjs --sections review-sections.yml --id <earlier> --reason "<why>"`。
11. 输出：本页修改的 deck data、闸门结果、逐屏截图、仍需人工处理的项。

## 视觉保真专项

- 参考 CSS/JS 的 SHA-256 必须与 `SOURCE.json` 一致；生成站点的 inline base CSS 必须与 `00-base.css` 一致。
- 必须保留参考动画：`@keyframes robot-idle`、`page-enter-forward/backward`、APNG 帧数、transition；不得以“性能/简化”为由删除。
- 组件 DOM 必须命中 `fidelity.json` 的选择器；若有新增选择器，先更新 fidelity 合约并说明理由。
- 截图只作为辅助证据；**保真以源码哈希 + DOM/计算样式 + 动画检查为主**。
- 若页面确实需要参考课件没有的交互，走 component-plan → brief（人工批准）→ 首次使用它的页面 component-build → 随页面人工审核 → 注册进 core；不得在页面里临时画一个近似组件。

## Self-review（强制，人工审核前）

- 写 `$COURSEWARE_REVIEW_DIR/self-review-page-<id>.json` 和 `.md`，模板按 `specify preset resolve self-review-template`。
- 参考适配：读参考课件源码（如 `<shell>/source/lesson.js`）和本课内容，自己判断参考课里哪些可见内容属于参考课（文字、代码、文件名、标签、图片、人物道具、例子等，由你识别，不套固定清单），本课对应应该是什么；把识别项和替换写进自审的 `referenceAdaptation`。渲染页面不能残留参考课内容；壳/品牌/风格/布局保持不变。
- `stage` 写 `page-<id>`；`artifactPaths` 必须包含本页的 `courseware.md` 区块、`storyboard.yml`、`deck.json`、截图、闸门结果。
- 逐屏核对：屏幕文字/代码/输出、交互反馈、完成条件、重置与脚本一致；无占位符；无未注册组件（本页暂存组件除外）；无个人信息。
- 若本页有暂存组件：读取 `$COURSEWARE_REVIEW_DIR/self-review-page-<id>-components.md` 与暂存包，确认渲染出来的行为符合简报、交互产生了声明的证据、没有静默退化为静态降级；把组件结论并入本页自审，不另开一次人工组件审核。
- 互动尝试：逐页确认脚本写了 `contentDemand` / `learningAction` / `evidence`；`watch` 页的 `whyStatic` 是教学理由，不是“没组件/麻烦”；非 `watch` 页的渲染确实产生声明的证据。
- 答案位置：记录 `check-quiz-keys` 的 A/B/C/D 分布与每题正确位置；不得用“加一条说明”代替调序。
- 检查源码直拷约束：参考 CSS/JS 哈希未变、没有页面级样式覆盖、动画仍在、目录/语音来自参考外壳而非另写一套。
- 运行/读取 deck-data、source-fidelity、本页 overflow、rendered-section、baseline、narration、quiz-keys、script、parity 结果；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 只有自审 pass 后才进入下面的 Human Review。

## Human Review（强制，每页一次）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为：可运行课件 URL、本页截图、`$COURSEWARE_REVIEW_DIR/self-review-page-<id>.md`、闸门结果、baseline-report、source-fidelity 报告。
- 主动提出审核请求：**先给课件链接**（例如 `http://127.0.0.1:8082/`），再给本页屏号与标题、脚本一致性、交互证据、截图、源码保真结果、自动检查、待人工项；不要另做审核网页。
- 若本页新建了组件：明确说明组件名、承载的学习动作/证据、组件自审结论；**页面 `approve` 同时批准这些组件进入 core**，不另设组件审核。
- 明确询问：`Approve rendered page <id>? (approve / reject)`。
- 未获 `approve` 不得进入下一页；不得自行修改审核结论；暂存组件在页面通过前不得注册。
- `reject` 时：只返工本页（及相关脚本屏），已批准页保持不变；重新渲染、自审、再请求本页审核；暂存组件保留待改。
- `approve` 后由工作流运行 `register-staged-page-components` 注册本页暂存组件、从 registry 重建站点并重跑 deck-data gate，然后运行 `freeze-section.mjs` 记录本页脚本哈希；不要手动改 `$COURSEWARE_PAGE_APPROVALS`。
- 全部页 approve 后，才进入整份 Alpha 回归审核。
