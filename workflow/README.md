# 课件工作流（可执行载体）

本目录把 `工作流草稿.md` 落成可安装的 Spec Kit preset + workflow + 校验工具。

当前版本：**workflow 0.13.0 / 90 步（含逐页循环嵌套）+ 壳库（001 pilot 生产路径）**。核心变化：

- **人工闸门 fail-closed**：非交互运行必须通过 `tools/run-workflow.mjs`；Spec Kit 的 `paused` 被映射为退出码 3，agent 不能再把“停在 gate”当成成功。脚本批准与 `courseware.md` 的整份 SHA-256、每屏哈希绑定（`review/script-approval.json`），编辑脚本即失效；所有下游工具和 `verify-script-approval` 步骤都会重新校验。

- **先审壳，再审内容**：`validate-shell` 渲染 30 页**占位内容**预览 deck、4 音色**占位语音**、逐页截图和审核清单，并启动 detached 本地预览服务；`review-shell` 门禁直接把真实壳 URL 交给老师。壳没批准，不进入内容生产。
- **风格包 = 参考课件源码逐字节直拷**，不是“看截图重画”。CSS/JS 哈希、舞台几何、DOM 选择器、动画（含 APNG 帧数）都由门禁锚定。
- **课件 = 壳包 + 声明式 deck**：生产路径写 `specs/<lesson>/deck.json`（`COURSEWARE_SHELL_DATA`），由 `build-shell-site.mjs` 一条命令完成插画 provenance、站点装配、组件 bundle/宿主注入与壳/插画站点闸门。旧 `prototype/site`（`slides.js`）只作历史路径保留。
- **每课插画必须重新生成**：壳内的参考角色只作生图参考；`generate-shell-art.mjs --prompt-file` 按本课提示词生成不同角色，`check-shell-art --require-all` 校验哈希、透明像素、尺寸与提示词/种子/模型溯源。构建默认 fail-closed，缺图即失败。
- **内容定制组件仍在库里**：参考已有的交互标为 `reference-verbatim` 直接复制；参考没有的走 component-brief → build → review → core，再由 `build-shell-site` 注入 bundle。
- **三类人工审核**：壳先审一次（真实预览 URL + 30 页占位内容 deck + 4 音色占位语音）；整份 `courseware.md` 审一次；之后每渲染完一页就发起一次页审核，上一页未批准不得进入下一页。插画单独有一次生成后审核。

## 文件地图

| 路径 | 内容 |
|---|---|
| `install.mjs` | 一键安装：复制 workflow、初始化 Spec Kit、装 preset/workflow/依赖、检测 Chromium、smoke tests |
| `preset/` | courseware preset：模板 + 命令（`speckit.script`、`component-plan`、`component-build`、`implement` 等） |
| `workflows/courseware-production.yml` | 90 步生产 workflow（shell / gate / command / fan-out / do-while + if；含逐页循环嵌套） |
| `schemas/` | content-pack、courseware-script、storyboard、style-pack、component-package/registry、narration、self-review 等 schema |
| `tools/build-style-pack-source.mjs` | 从参考课件目录逐字节复制 CSS/JS，写 `SOURCE.json` |
| `tools/check-source-fidelity.mjs` | 源码哈希 + site 副本 + inline base CSS + DOM 几何/选择器 + 动画/APNG 门禁 |
| `tools/extract-shell.mjs` | 把一个参考课件提取成可复用壳包（`shells/<id>/`）；`--preview-only` 只刷新占位预览数据 |
| `tools/shell-profiles/` | 壳提取 profile：复制清单、lesson.js 数据化变换、slide 类型、组件表、插图槽位；含 `preview-deck.mjs` / `preview-narration.mjs` 占位 fixture |
| `tools/make-preview-voice.mjs` | 用 Edge TTS 生成壳预览的占位语音（8 句 × 4 音色），写字节数/SHA-256/实测时长 manifest |
| `tools/shell-preview-lib.mjs` | 校验占位 deck/旁白标记、页数、音频哈希/大小/时长，并写 `deck.js` / `narration-plan.js` / `voice-manifest.js` / `preview-audio/` |
| `tools/shell-lib.mjs` / `list-shells.mjs` / `check-shell.mjs` | 壳包校验、库清单、Playwright 逐页渲染检查；`check-shell --serve-preview` 启动审核用本地服务并写审核清单 |
| `tools/preview-lib.mjs` / `preview-server.mjs` | 人工审核用的 detached 静态预览服务、URL 打开与审核清单生成 |
| `tools/generate-shell-art.mjs` / `check-shell-art.mjs` | 按课件生成风格相似但不同的角色插图；哈希/尺寸/透明背景/溯源门禁；`--reuse` 幂等复用，`--prompt-file` 提供本课提示词 |
| `tools/image-alpha.mjs` | 生成图去白底、裁透明边距，按壳配置最近邻像素化，输出带 alpha 的像素角色 |
| `tools/prepare-shell-site.mjs` | 选壳 + deck + 语音 + 插图 → 可运行站点，写 `build-manifest.json`；默认缺图即失败 |
| `tools/build-shell-site.mjs` | 生产构建唯一入口：插画 provenance → `prepare-shell-site`（fail-closed）→ 组件 bundle/宿主 → 壳/插画站点闸门 |
| `runtime/shell-component-host.js` | 壳站点的 deck 级组件宿主：挂载 `blank` 页注册组件，删除无 chapter 页时的 `0.x` 站号 |
| `tools/check-deck-data.mjs` | deck 数据 vs storyboard（id/title/顺序/type/旁白/禁用字段）门禁 |
| `tools/sync-deck-components.mjs` | 把注册表 core 组件打成 `components.bundle.js/.css` |
| `tools/build-audio-adapter.mjs` | 旧 deck：从 narration manifest 生成 `audio.js`（`LESSON_*` 数据）；壳路径不用 |
| `tools/check-script.mjs` | 脚本闸门：schema、词表、交互完整性、内容覆盖、逐字存在性 |
| `tools/check-component-plan.mjs` | 组件计划/简报闸门：复用检索、缺口、FSM、props、a11y、降级、测试计划、参考源码对照 |
| `tools/registry-lib.mjs` / `check-registry.mjs` / `register-staged-components.mjs` | 注册表读写、组件包校验、审核后注册、usedBy |
| `tools/check-overflow.mjs` | 无滚动条硬门禁 |
| `tools/build-screen.mjs` / `check-baseline.mjs` | 逐屏截图与基线对比 |
| `tools/list-approved-screens.mjs` | fan-out 的已批准屏列表（可按页过滤） |
| `tools/section-lib.mjs` / `check-review-sections.mjs` / `next-section.mjs` / `freeze-section.mjs` / `check-section-freeze.mjs` | 逐页清单（强制每节恰好一屏）、批准账本、哈希冻结、重开 |
| `tools/approve-script.mjs` | 只接受 `review-script` gate 的 `approve` 结果，并核对 run state 中该 gate 已完成；记录整份脚本哈希、每屏哈希与 gate run id 并置为 APPROVED |
| `tools/check-script-approval.mjs` / `approval-lib.mjs` | 校验批准账本：schema、人工批准人、gate 结果与 run 状态、整份/每屏哈希、APPROVED 状态 |
| `tools/run-workflow.mjs` | fail-closed 运行 `specify workflow run/resume`；`paused` → 退出码 3，打印人工恢复命令、gate 审核请求（含课件 URL）与审核文件 |
| `tools/build-narration.mjs` / `check-narration.mjs` | Edge TTS 语音生成与校验 |
| `tools/smoke-test.mjs` | 全量工具回归 |
| `examples/` | 脚本/组件计划/注册表/组件包/故事板的通过/失败 fixture |

## 一键安装

从课件仓库根目录：

```bash
node workflow/install.mjs --integration claude
# 或
node workflow/install.mjs --integration codex
```

它会复制 `workflow/`、初始化 Spec Kit（若没有 `.specify`）、安装 preset 与 workflow、安装 tools 依赖、检测 Chromium、跑 smoke test。常用选项：`--project <path>`、`--force`、`--skip-deps`、`--no-smoke`、`--dry-run`。

已有项目要**并装 Codex、保留 Claude** 时，不要用 `install.mjs --integration codex`（它检测到 `.specify` 会保留当前集成），而是：

```bash
specify integration install codex --script sh
specify integration use codex     # 把 preset 技能渲染到 .agents/skills
specify integration use claude    # 恢复默认；Codex 技能保留
```

之后运行 workflow 时传 `-i integration=codex`（输入默认 `auto` 跟随项目默认）。Codex 需要项目是 git 仓库。非交互运行必须用 `node workflow/tools/run-workflow.mjs ...`，不要直接 `specify workflow run`：Spec Kit 在 gate 处会以 exit 0 返回 `paused`，包装器则返回 exit 3，打印 run id、恢复命令、gate 审核请求（含课件 URL）与审核文件。详见 [integrations/README.md](integrations/README.md)。

## 核心架构（先读这一节）

```text
参考课件源码（mirror）
   ├─ 逐字节复制 CSS/JS + 记录哈希
   │     ▼
   │  style-pack/source/SOURCE.json + fidelity.json
   │     校验哈希、inline CSS、几何、DOM、动画
   │
   └─ extract-shell（逐字节复制 index.html / styles.css / lesson.js / 静态资产）
         ▼
      shells/<id>/（source/ + site/ + reference/ + shell.json）

specs/<lesson>/deck.json + narration.json + specs/<lesson>/art-prompts.json
         │  build-shell-site.mjs
         │   1. check-shell-art --require-all（本课插画 provenance）
         │   2. prepare-shell-site（默认 fail-closed：缺图即失败）
         │   3. sync-deck-components（bundle + 宿主，写入后 --check）
         │   4. check-shell --require-art + check-shell-art --site --require-all
         ▼
prototype/shell-site（壳 chrome/renderer + deck + 旁白 + 本课生成插画 + 组件 bundle）
```

硬规则：

- **不重画参考组件**。参考已有的交互，复制其 DOM/CSS/JS；截图只做辅助证据，不作为保真依据。
- **不复用壳的参考角色**。`reference/` 只进生图接口；每课用 `generate-shell-art --prompt-file` 生成不同角色，`check-shell-art --require-all` 通过后才允许装配站点。缺图时 `prepare-shell-site` 直接失败，`--allow-missing-art` 只用于壳预览。
- **不删动画**。`@keyframes`、transition、APNG 帧数原样保留；`prefers-reduced-motion` 只做可访问性降级。
- **不写页面级样式**。`deck.json` 不允许 `style`/`className`/`html`/`innerHTML`/`on*` 字段；不合规会被 `check-deck-data` 拦截。
- **不在页面里发明组件**。参考没有、库里也没有的交互，走 component-plan → brief → build → review → core → `build-shell-site` 注入。
- **不改壳渲染器来迁就单页**。组件不满足脚本时退回组件阶段，不在 `deck.json` 或 `index.html` 加特例。
- **`index.html` 只允许由 `sync-deck-components` 插入 bundle 的 `<link>`/`<script>` 标签**；壳 CSS/JS 内容本身不得改。
- `prototype/site` 自带的三个 `matrix-*`/`predict-reveal` 是**保真测试用 harness**，只在 `?deck=slides.reference` 或 `?harness=1` 时加载；生产 deck 用注册表生成的 `components.bundle.js` 或壳站点包。

## M0：风格包直拷与冻结

```bash
# 1. 从参考课件镜像逐字节复制 CSS/JS
node workflow/tools/build-style-pack-source.mjs \
  --reference research/r0/mirror/lesson-01/2026/10/16/1itukgf9auj \
  --inline-css research/r0/analysis/lesson-01/inline.css \
  --out style-pack/source

# 2. 只校验源码副本
node workflow/tools/check-source-fidelity.mjs --source-only

# 3. full spec + 基线 + 冻结
node workflow/tools/validate-style-pack.mjs style-pack/style-pack.full.json --check-baselines
node workflow/tools/freeze-style-pack.mjs style-pack/style-pack.full.json --out style-pack/style-pack.freeze.json

# 4. site 存在后校验完整保真（含 DOM/动画）
node workflow/tools/check-source-fidelity.mjs \
  --url http://127.0.0.1:8080/ \
  --source style-pack/source/SOURCE.json \
  --fidelity style-pack/source/fidelity.json \
  --site prototype/site
```

`fidelity.json` 必须记录：

- 视口与舞台几何（1440×900，舞台 1380×742）；
- 外壳选择器（`.app`、`.topbar`、`.footer`、`#slide`、`#outline`、`.voice-picker`、`#voiceProgress`、`#voiceRegions`）；
- 必填 CSS marker（如 `@keyframes robot-idle`、`.cover-topics>span`）；
- 动画资产（APNG 帧数）与 CSS 动画名；
- 每个组件的 `sourceTypes` 与 DOM 选择器（多变体用 `variants`）。

参考图片/音频只在本机使用；授权未解决前不进入可分享包。

## 壳库：把参考课件提成可复用壳

完整命令与 deck 字段见 [`shells/README.md`](../shells/README.md)。核心规则：

- **入库可复制**：`extract-shell` 把参考 `index.html` / `styles.css` / `lesson.js` / 静态资产逐字节复制到 `shells/<id>/source/`，写 `SOURCE.json`；角色裁图放 `reference/` 仅供生图参考。
- **预览 deck 覆盖全类型且必须是占位内容**：profile 的 `deck` 生成 `site/deck.js`，21 种原生 slide 类型（含 `numberLab` 的 kind、`code` 的 `flowType`、两/三张卡片）各至少出现一次；所有标题必须带“占位”，`meta.preview.dummy=true`。`check-shell` 直接检查壳包时缺一即失败，并实际点通主要交互。生产站点用 `--site` 时只要求本课声明的类型被渲染。
- **占位语音 fixture**：`preview-narration.mjs` 定义 8 句占位旁白 × 4 个音色；`make-preview-voice.mjs` 生成 32 个 MP3 与 `manifest.json`（字节数、SHA-256、浏览器实测时长）。`shell-preview-lib.mjs` 在写入站点前逐项校验，`check-shell` 再解码全部音频并在真实壳里播放默认与第三个音色。占位语音只用于检查播放/切换，不是本课旁白；`prepare-shell-site` 装配生产站点时会删除 `preview-audio/` 与 `preview-data.json`，没有本课旁白时写空清单。
- **运行时数据驱动**：`site/lesson.js` 不再内嵌任何一节课的 slides，只读 `window.COURSEWARE_SHELL_DATA = { meta, slides }`；插图读 `window.COURSEWARE_SHELL_ART`；调试钩子 `COURSEWARE_DEBUG`。
- **生成时换图**：`generate-shell-art.mjs --prompt-file specs/<lesson>/art-prompts.json` 以参考角色为风格输入、以本课提示词要求不同角色，自动选择 token 可用的图像模型（qwen-image-2.0 / gpt-image-2），去白底并裁透明边距。`--reuse` 在提示词、参考图、输出文件与溯源都没变时跳过 API 调用；`--force` 强制重生成。
- **插画 provenance 闸门**：`check-shell-art --require-all` 要求每个槽位都有生成图，哈希 ≠ 参考图、PNG 含透明像素、尺寸 ≥ 256 且像素化尺寸可整除，提示词/种子/模型齐全；`--site` 还校验 `build-manifest.json` 与 `shell-art-data.js`。
- **参考图不随站点发布**：`prepare-shell-site` 只复制 `site/`，天然不带 `reference/`；`check-shell` 还会显式检查 `site/reference` 不存在。
- **生产构建 fail-closed**：`prepare-shell-site` 默认缺图即失败（`--allow-missing-art` 只用于壳预览）；`build-shell-site.mjs` 把插画闸门、装配、组件注入与站点闸门串成唯一生产入口。
- **按 id 选壳**：`--shell` 可传库目录或 `shells/index.json` 中的 id（如 `branch-choice`），生成/校验/组装命令一致。

```bash
node workflow/tools/list-shells.mjs --check
node workflow/tools/check-shell.mjs --shell shells/branch-choice \
  --shots review/shell-shots --review-out review/shell-preview.md \
  --serve-preview --open-preview

# 只刷新占位预览数据（不重新抽壳）：deck / narration / preview-audio
node workflow/tools/extract-shell.mjs --preview-only \
  --out shells/branch-choice --id branch-choice --profile branch-v1

# 1. 本课提示词（每个插图槽一个；由 speckit 的 shell-art-brief 步骤写出）
cat specs/001-2d-arrays/art-prompts.json

# 2. 生成/复用本课插画并过 provenance 闸门
node workflow/tools/generate-shell-art.mjs --shell shells/branch-choice \
  --lesson 001-2d-arrays --lesson-title "二维数组：给数据排好座位" \
  --prompt-file specs/001-2d-arrays/art-prompts.json \
  --out generated/001-2d-arrays --reuse
node workflow/tools/check-shell-art.mjs --shell shells/branch-choice \
  --art generated/001-2d-arrays/art-manifest.json --require-all

# 3. 一条命令构建生产站点
node workflow/tools/build-shell-site.mjs --shell shells/branch-choice \
  --deck specs/001-2d-arrays/deck.json \
  --art generated/001-2d-arrays/art-manifest.json \
  --narration prototype/site/narration.json --audio-dir prototype/site/audio \
  --registry registry/index.json --out prototype/shell-site --force

# 4. 站点级复核
node workflow/tools/check-shell.mjs --shell shells/branch-choice \
  --site prototype/shell-site --require-art
node workflow/tools/check-shell-art.mjs --shell shells/branch-choice \
  --art generated/001-2d-arrays/art-manifest.json \
  --site prototype/shell-site --require-all
```

001 二维数组的生产路径：`deck.json` → `build-shell-site` → `prototype/shell-site`，注册组件由 `shell-components.js` 宿主挂载。workflow YAML 自 0.7.1 起已默认壳路径；旧 `prototype/site` + `slides.js` 只保留给历史课件，两种 deck 契约不要混用。


## 课件脚本 `courseware.md`（人类可读唯一内容源）

生成课件前先写 `courseware.md`（模板：`preset/templates/script-template.md`）和 `review-sections.yml`（模板：`preset/templates/review-sections-template.yml`）。老师直接审阅/修改；`storyboard.yml` 由脚本投影，不手改。

每屏固定包含：

| 区块 | 内容 |
|---|---|
| 屏幕内容 | 学生实际看到的文字、代码、表格、图示（逐字） |
| 交互设计 | 学生动作、互动层级、初始状态、成功/错误反馈、完成条件、重置、无障碍、静态替代 |
| 旁白 / 语音 | 逐字稿；等待操作处写 `[暂停]` |
| 转场 | 与上一屏/下一屏的衔接 |
| 制作字段 | `id`、`title`、`objectiveId`、`contentRefs`、`components`、`layout`、`interaction`、`componentPlan`、`status` |

组件策略：

- 参考已有：`componentPlan.status: reference-verbatim`，实现时复制源码。
- 风格包/注册表已有：`existing`。
- 需要扩展：`extend`；需要新做：`new`，两者都必须写简报。

```bash
node workflow/tools/check-script.mjs specs/lesson-01/courseware.md \
  content/lesson-01.content.json style-pack/manifest.json registry/index.json
node workflow/tools/script-to-storyboard.mjs specs/lesson-01/courseware.md \
  --out specs/lesson-01/storyboard.yml
node workflow/tools/check-review-sections.mjs specs/lesson-01/review-sections.yml \
  specs/lesson-01/storyboard.yml
```

- `check-script` 检查：schema、组件/版面词表、交互完整性、误区反馈、required 覆盖、例题代码/输出与测验选项逐字存在、无 TODO/TBD。
- 脚本人工 `approve` 后才允许进入 component-plan 与分镜；脚本改动后必须重新投影。

## 组件库与按需生成

组件分两类：

| 类型 | 来源 | 存放 | 实现要求 |
|---|---|---|---|
| `reference-verbatim` | 参考课件已有 | `style-pack/source/`（CSS/JS 副本）+ `fidelity.json` 选择器 | 逐字节/逐函数复制，不改视觉与动画；哈希入 `SOURCE.json` |
| `generated` | 参考没有、内容需要 | `registry/components/<id>/`（审核后） | 浏览器原生 `.js`，调用 `CoursewareComponents.register`；样式只用参考 tokens |

风格包 manifest 里也可能出现 `kind: generated` 条目：它们只登记设计语汇、DOM 选择器与预期动画，表示参考里**没有可复制的实现**。`check-vocabulary`、`check-script`、`check-component-plan`、`check-deck-data` 都不会把这类条目当作可用组件——必须先在注册表里有 `status: core` 的实现，分镜和 deck 才能使用。当前风格包暂缓收录 `matrix-lab` / `matrix-trace` / `predict-reveal`，机制保留，后续需要时再加回。

流程：

1. `speckit.script` 在每屏 `componentPlan` 里声明 `reference-verbatim | existing | extend | new`。
2. `speckit.component-plan` 先查参考源码与注册表，写 `component-plan.md` 和 `component-briefs/<id>.md`；每个 `new` 必须说明为什么不能直接复制参考源码。
3. 组件实现按页进行：每个页面由 `list-section-components` 算出本页缺失的 `new`/`extend` 组件，`speckit.component-build` 只把这些组件实现到 `registry/staging/<id>/`：
   ```text
   component.json      # propsSchema / FSM / a11y / fallback / sourceFidelity / provenance
   runtime.js          # window.CoursewareComponents.register('<id>', { render, bind })
   styles.css          # 只用参考 tokens
   tests/…             # 每条 transition 至少一个用例
   baselines/…         # 1440×900 基线
   ```
   JSX/MDX 包会被 `sync-deck-components` 拒绝。
4. 构建本页站点时用 `build-shell-site --staging` 把暂存组件一并打包；组件自审（`self-review-page-<section>-components`）并入页面自审，**不单独设组件人工审核**。
5. 页面 gate `approve` 同时批准本页新组件：工作流执行 `register-staged-components --only <本页组件> --clean` 注册为 `core`，然后从 registry 重建站点并重跑 deck-data，再冻结该页。
6. `sync-deck-components.mjs` 生成 `components.bundle.js/.css`；页面只写 props。
7. `record-component-usage` 写入 `usedBy`，供后续复用检索。

规则：

- 暂存组件只属于当前页，可进入本页 deck；页面通过后注册并清空 staging，不得跨页残留。
- deprecated 组件不得进入 deck。
- `extend` 必须升版本并保持向后兼容。
- 参考组件不复制进 registry；它们属于风格包。

## 逐页渲染审核（rolling render review）

```text
壳包 → validate-shell（30 页占位内容 deck + 4 音色占位语音 + 截图 + 本地预览 URL）
        ↓  老师 review-shell：approve（壳没批准，不进入内容生产）
整份 courseware.md + review-sections.yml
        ↓  老师 review-script：approve
approve-script（DRAFT → APPROVED，记录脚本哈希）
        ↓  component-plan（全局纸面设计，人工审核）→ storyboard → tasks
页 A：按需组件 build 到 staging（仅本页缺少的）→ 实现 deck.json → 语音 → build-shell-site --staging → 截图 → deck-data/shell/shell-art/overflow/基线 → 组件自审并入页面自审 → 老师审渲染
        ↓ approve（同时批准本页新组件）
注册本页暂存组件 → 从 registry 重建站点 → deck-data → freeze-section A
页 B：…（已批准页先过 check-section-freeze）
        ↓
全部页面 approve → 整份 Alpha 回归 → Beta → Gold
```

- `reject` 只返工当前页；已批准页由脚本哈希冻结，不能悄悄改。
- 已批准后要改：
  ```bash
  node workflow/tools/reopen-section.mjs --sections review-sections.yml \
    --id B --reason "S12 的反馈太难，需要重做"
  ```
- 批准账本：`review/script-approval.json`、`review/page-approvals.json`、`review/page-approvals.md`、`review/page-reopens.json`。不要手改。`script-approval.json` 与整份 `courseware.md` 文本绑定：任何编辑（包括旁白、制作字段或 frontmatter）都会让批准失效，必须重新走 `review-script` 人工 gate。账本同时记录 gate run id；`approve-script` 会拒绝 `paused` 或没有完成 `review-script` 的 run，`verify-script-approval` 用 `--expect-run` 要求账本来自当前 run。
- 本地文件无法证明按键的是真人；检查保证“暂停的 gate 不会被当成批准、批准后改稿会失效”。真正的信任边界是老师在自己的终端回答 gate，agent 不代答或手动铸造账本。
- `node workflow/tools/check-script-approval.mjs <courseware.md>` 必须通过；失败时下游工具（component-plan、narration、storyboard、组件、deck、截图、冻结）都会拒绝继续。
- 非交互运行停在 gate 时，包装器返回 exit 3，并打印 gate 的审核请求（逐页 gate 会带课件 URL）与 `show_file` 审核文件路径；老师在自己的终端运行 `node workflow/tools/run-workflow.mjs resume <run-id>` 交互式回答 gate。不要由 agent 代答。

## Deck 数据与语音

生产路径的 `specs/<lesson>/deck.json` 形如：

```json
{
  "meta": { "title": "二维数组：给数据排好座位", "brandMain": "C++", "brandAccent": "互动课堂", "brandTitle": "二维数组" },
  "slides": [
    { "id": "S01", "type": "hero", "title": "二维数组：给数据排好座位", "lead": "…", "topics": ["定义", "初始化"] },
    { "id": "S02A", "type": "table", "headers": ["座位", "第 0 列"], "rows": [["第 0 行", "(0,0)"]] },
    { "id": "S03", "type": "blank", "component": "quiz-bank", "props": { "questions": [] } }
  ]
}
```

- 数据 = 内容；renderer = 壳的 `site/lesson.js`。`type` 必须是壳 `shell.json` 的 `dataContract.slideTypes`，或 `blank` + 注册表 core 组件 id。
- `meta.brandTitle` 是顶栏课程名（缺省回退 `brandAccent`）；`brandAccent` 同时用作侧栏副标题，本课为“互动课堂”。
- 目录由壳从 deck 自动生成；不另写目录组件。
- 语音：`build-narration.mjs` 生成 manifest；`build-shell-site` 内的 `prepare-shell-site` 把它转成 `narration-plan.js` + `voice-manifest.js`，音频落盘到 `assets/narration/<slide-id>/<voice>.mp3`。壳路径不再使用 `build-audio-adapter` / `audio.js`。
- 四种声线：小智 `zh-CN-YunxiaNeural`、小创老师 `zh-CN-YunyangNeural`、小未 `zh-CN-XiaoyiNeural`、小来老师 `zh-CN-XiaoxiaoNeural`。
- 插画：`COURSEWARE_SHELL_ART` 只列本课生成的 `assets/generated/` 文件；`reference/` 不进入站点。

## 输入

| 输入 | 说明 |
|---|---|
| `lesson` | 课次 id/标题 |
| `approver` | 组件注册/脚本批准记录里的人类审核人 |
| `content_pack` | R0-C 产出的 `content-pack.json` |
| `courseware_script` | `speckit.script` 写出的 `courseware.md` |
| `review_sections` | `speckit.script` 写出的 `review-sections.yml` |
| `component_registry` | 组件库索引；默认 `registry/index.json` |
| `storyboard` | `speckit.plan` 从脚本投影的 `storyboard.yml` |
| `style_pack` | 生产壳的风格包 manifest（001：`shells/branch-choice/style-pack.manifest.json`；旧路径为 `style-pack/manifest.json`） |
| `style_pack_full` | 完整风格包 JSON（001：`shells/branch-choice/style-pack.full.json`），需已冻结 |
| `style_pack_freeze` | 冻结清单（001：`shells/branch-choice/style-pack.freeze.json`）；工作流校验 pack/基线哈希未变 |
| `style_pack_source` | 直拷源码清单（001：`shells/branch-choice/SOURCE.json`；旧路径为 `style-pack/source/SOURCE.json`） |
| `source_fidelity` | 保真合约（001：`shells/branch-choice/fidelity.json`） |
| `shell` | 壳包 id 或目录；默认 `shells/branch-choice` |
| `shell_source` | 壳源码清单（`shells/<id>/SOURCE.json`），逐页 source-fidelity 闸门用 |
| `lesson_slug` | 本课 slug，写进插画 provenance（如 `001-2d-arrays`） |
| `art_prompts` | 本课插画提示词文件（`specs/<lesson>/art-prompts.json`，槽位 → 提示词） |
| `art_dir` | 生成插画与 `art-manifest.json` 的目录（如 `generated/001-2d-arrays`） |
| `site_dir` / `deck_data` | 装配后的壳站点目录 / 声明式 `deck.json` |
| `deck_url` | 构建后 deck 的 dev/preview URL |
| `voice_catalog` / `narration_manifest` / `audio_dir` | Edge TTS 声线目录、manifest 与 MP3 目录 |
| `page_count` / `baseline_dir` / `coverage_waivers` | overflow、基线、覆盖豁免 |

## 运行

```bash
SPECIFY_INIT_DIR=/path/to/courseware \
node workflow/tools/run-workflow.mjs courseware-production \
  -i lesson="二维数组：给数据排好座位" \
  -i approver="张老师" \
  -i content_pack="research/r0/content-ref/二维数组1.content.json" \
  -i courseware_script="specs/001-2d-arrays/courseware.md" \
  -i review_sections="specs/001-2d-arrays/review-sections.yml" \
  -i component_registry="registry/index.json" \
  -i storyboard="specs/001-2d-arrays/storyboard.yml" \
  -i style_pack="shells/branch-choice/style-pack.manifest.json" \
  -i style_pack_full="shells/branch-choice/style-pack.full.json" \
  -i style_pack_freeze="shells/branch-choice/style-pack.freeze.json" \
  -i style_pack_source="shells/branch-choice/SOURCE.json" \
  -i source_fidelity="shells/branch-choice/fidelity.json" \
  -i shell="shells/branch-choice" \
  -i shell_source="shells/branch-choice/SOURCE.json" \
  -i lesson_slug="001-2d-arrays" \
  -i art_prompts="specs/001-2d-arrays/art-prompts.json" \
  -i art_dir="generated/001-2d-arrays" \
  -i site_dir="prototype/shell-site" \
  -i deck_data="specs/001-2d-arrays/deck.json" \
  -i deck_url="http://127.0.0.1:8082/" \
  -i page_count=16 \
  -i baseline_dir="baselines/001-2d-arrays"
```

流程：

1. `validate-content` / `validate-style-pack-full`（含冻结哈希）/ `validate-source-fidelity --source-only`；`validate-shell`（壳包契约）；`ensure-registry` / `validate-registry`。
2. `speckit.specify` → 教学简报；`review-brief` 人审。
3. `speckit.script` → `courseware.md` + `review-sections.yml`；`validate-script-draft` → `self-study-audit` → `validate-script`；`review-script` 人审（整份一次）；`approve-script`（只接受 gate 的 `approve`，并核对 run state）→ `verify-script-approval`（重新校验整份/每屏哈希与当前 run）。
4. **本课插画**：`shell-art-brief`（逐槽提示词）→ `build-shell-art`（`generate-shell-art --prompt-file … --reuse`，未变化不重生成、不需要 key）→ `check-shell-art --require-all`（provenance）→ `review-shell-art` 人审。
5. `build-narration` → `check-narration`（四声线 manifest；壳路径不再有 `build-audio-adapter`）。
6. `speckit.component-plan` → 复用/缺口/简报（全局纸面设计）；`review-component-plan` 人审。**不在这里预建组件**；实现由页面循环在首次需要它的页面完成。
7. `speckit.plan` → `storyboard.yml` + `plan.md`；`review-storyboard` 人审。
8. `speckit.tasks` → 逐页任务；`review-tasks` 人审。
9. **逐页循环**：`section-freeze-check` → `load-page-components`（本页缺哪些组件）→ 缺则 `build-missing-page-components`（`speckit.component-build --section --slides --components`）→ 暂存组件校验/自审 → `implement-section`（写 `--deck-data`）→ 语音 → `section-shell-build --staging` → 语音闸门 → 截图 → deck-data（含 `--staging`）/shell/art/source-fidelity/rendered/baseline/script/quiz-keys/parity/overflow → 页面 AI 自审（含组件自审）→ `review-page` 人审（同时批准本页新组件）→ `register-staged-page-components --only … --clean` → `check-registry` → 从 registry 重建站点 → deck-data（不含 staging）→ `freeze-section`。
10. 全部页面批准后：`all-sections-frozen` → `alpha-shell-build` → 整份截图/基线 → `alpha-deck-data-gate` / `alpha-source-fidelity-gate` / `alpha-bundle-gate` / `alpha-shell-gate` / `alpha-shell-art-gate` / `alpha-narration-gate` / script/parity/overflow → `review-alpha`。
11. `speckit.converge` → `review-beta`；`gold-script-gates` / `gold-parity-gate` / `final-gates` / `gold-shell-gate` / `gold-shell-art-gate` → `gold` 签字。

## 直接跑闸门（不经过 workflow）

```bash
node workflow/tools/check-script-approval.mjs specs/001-2d-arrays/courseware.md --approval review/script-approval.json
node workflow/tools/check-script.mjs specs/001-2d-arrays/courseware.md research/r0/content-ref/二维数组1.content.json shells/branch-choice/style-pack.manifest.json registry/index.json
node workflow/tools/script-to-storyboard.mjs specs/001-2d-arrays/courseware.md --check specs/001-2d-arrays/storyboard.yml
node workflow/tools/validate-style-pack.mjs shells/branch-choice/style-pack.full.json --check-baselines --freeze shells/branch-choice/style-pack.freeze.json
node workflow/tools/check-shell.mjs --shell shells/branch-choice
node workflow/tools/build-shell-site.mjs --script specs/001-2d-arrays/courseware.md --shell shells/branch-choice --deck specs/001-2d-arrays/deck.json \
  --art generated/001-2d-arrays/art-manifest.json --narration prototype/site/narration.json \
  --audio-dir prototype/site/audio --registry registry/index.json --out prototype/shell-site --force
node workflow/tools/check-shell.mjs --shell shells/branch-choice --site prototype/shell-site --require-art
node workflow/tools/check-shell-art.mjs --shell shells/branch-choice --art generated/001-2d-arrays/art-manifest.json \
  --site prototype/shell-site --require-all
node workflow/tools/check-source-fidelity.mjs --source shells/branch-choice/SOURCE.json --source-only
node workflow/tools/check-deck-data.mjs --script specs/001-2d-arrays/courseware.md --url http://127.0.0.1:8082/ --storyboard specs/001-2d-arrays/storyboard.yml \
  --registry registry/index.json --shell shells/branch-choice
node workflow/tools/check-overflow.mjs http://127.0.0.1:8082/ --script specs/001-2d-arrays/courseware.md --pages 16
```

`check-shell.mjs --shell …`（不给 `--site`）只校验壳包的预览；生产站点用 `--site prototype/shell-site --require-art`，且插画闸门是必需项。旧 `prototype/site` 的命令不再适用于壳站点。

## AI 自审 → 人工审核（每个 gate 前）

```text
prompt self-review → check-self-review → human gate
```

- self-review 写 `review/self-review-<stage>.json/.md`（schema：`workflow/schemas/self-review.schema.json`；模板：`preset/templates/self-review-template.md`）。
- `check-self-review` 要求：`verdict: pass`、无自动检查 `fail`、无未修复 blocking issue、checklist 无 `fail`。
- **自审绑定确切字节**：每份自审的 `reviewedArtifacts` 记录被审文件的 SHA-256；`check-self-review` 重算并比对，文件一变即 `stale review` 失败。改稿后必须重新自审，不能只改哈希。
- **逐屏密度闸门**：脚本 / 分镜 / 逐页 / Alpha 自审必须带 `density`。先跑 `density-report.mjs` 得到客观信号（contentRefs、表格行列、代码行、要点数、旁白句数等），再为每屏写 `semanticUnits`（label + evidence）。默认一屏一个语义边界；超过 1 个单元必须拆页，或标 `exception` 并写明理由（仅限并列对比、同一规则多例、复习整合）。信号与当前脚本/分镜不一致也会失败。
- human gate 用 `show_file` 展示自审报告，并主动请求 `approve / reject`；未批准不得继续。
- 阶段：`inputs`、`brief`、`script`、`component-plan`、`components`、`storyboard`、`tasks`、`section-<id>`、`alpha`、`beta`、`gold`。`density` 在 `script`、`storyboard`、`section-<id>`、`alpha` 强制；其余阶段只强制 `reviewedArtifacts`。
- 插画另有 `review-shell-art` 人工审核（`show_file` 展示 `art-manifest.json`），不经过 `self-review`。

## 内容覆盖规则

- 同课重制 + 可补充；允许新增例子/练习，**不可删减**参考内容。
- 覆盖粒度：知识点 + 例题 + 测验；讲解、代码示例与输出、练习/测验与反馈、结构/步骤/旁白也必覆盖。
- `content-pack.items[].required = true` 的项必须被非 SKIP 分镜的 `contentRefs` 引用。
- 缺失 → `check-coverage` exit 1；豁免格式：`["Q01"]` 或 `{ "waivers": [{ "id": "Q01", "reason": "…" }] }`。

## 当前未完成 / stub

- **真实内容参考课件**：仅接入了 lesson-01 的本地镜像与内容参考；新的参考课件需要重新跑 R0-C 与 `build-style-pack-source`。
- **壳路径已是 0.7.1 起的默认生产路径**：YAML 输入含 `shell` / `shell_source` / `lesson_slug` / `art_prompts` / `art_dir` / `site_dir` / `deck_data`；逐页与 Alpha 都用 `build-shell-site` 装配站点，旁白由 `prepare-shell-site` 转换，不再使用 `build-audio-adapter`。001 pilot 之前的旧 `prototype/site` + `COURSEWARE_SLIDES` 仅作历史路径保留。
- **旧 deck 的 `speckit.implement` / schema 默认值仍在**：`deck_url` / `deck_data` 的示例值已改壳路径，但 0.5.x 的工具与文档若被复用，需要显式带 `--shell`，否则会按旧站点检查。
- **生图 API 已实跑**：`generate-shell-art.mjs` 使用本机 `~/.config/courseware/aliyun-image.key`（600 权限，不提交）；当前 token 只暴露 `gpt-image-2`，qwen 模型走同一接口但需 token 所属分组有渠道。`--prompt-file` 按槽位写本课提示词；`--reuse` 在提示词、参考图哈希、输出文件哈希与 provenance 均未变时直接复用，不调用 API、也不需要 key；`--force` 强制重生成。角色经去白底、裁边、像素化后由人工看样。
- **参考资产授权**：图片/音频/字体等未确认可再分发；当前只在本机使用。
- **组件库种子**：参考组件登记在风格包；内容定制组件需要按新 run 重新走简报/审核/注册。
- **VLM 辅助评审**：未接入；硬门禁仍是源码哈希 + DOM 几何 + 截图基线。
- **TTS 质量**：Edge TTS 为本地/原型用途；音质与发音仍需人工试听。

## 测试证据

- `specify preset add` / `workflow add` 在 Claude Code 与 Codex 两个 integration 实测安装成功。
- 一键安装 `node workflow/install.mjs --project … --integration …` 实测 exit 0。
- `smoke-test` 覆盖 schema、coverage、vocabulary（含 `kind: generated` 未入 core 时拒绝、入 core 后通过）、teaching、self-review（含 `stale review`、缺少 density、信号不一致、单屏多语义单元未拆页、exception 带理由通过）、style pack 验证/冻结/冻结哈希校验、脚本、组件包/注册表/staging、组件计划、逐页清单（含“多屏合并成一个 section”被拒绝，防止绕过逐页人工审核）、截图列表、`next-section`、`approve-script`、`check-script-approval`（批准通过、缺账本、批准后编辑、伪造 `reject` gate、DRAFT 状态、paused run 均拒绝）、`freeze-section`、`check-section-freeze`、`reopen-section`；并包含壳插画 fail-closed：空 art manifest 时 `prepare-shell-site` 与 `build-shell-site` 均 exit 1（项目没有 `shells/branch-choice` 时该组检查标记 SKIP，适配只含 workflow 的模板仓库），harness 选择检查（`integration` 输入默认 `auto`、无硬编码 integration），workflow 逐页人工审核 gate 静态检查（`review-page` 位于每页实现与自审之后，消息带课件 URL、附本页自审文件），占位预览 fixture 检查（30 页标题带“占位”、4 音色、32 个音频文件的哈希与时长），以及生产装配隔离检查（`prepare-shell-site` 不复制 `preview-audio/` / `preview-data.json`，无本课旁白时写入空清单而非占位语音；完整仓库 89/89 通过，只含 workflow 的模板仓库跳过 shell 检查后同样通过）。
- `check-source-fidelity --source-only` 与完整 DOM 模式已对 `style-pack/source` + `prototype/site` 实测通过（含 26 个组件选择器与 3 个自定义组件）；壳路径的 source 闸门对 `shells/branch-choice/SOURCE.json` 实测通过（15 个源文件哈希一致）。
- 壳路径已在 001 Section A 实测：`build-shell-site`（插画 provenance → fail-closed 站点 → bundle/宿主 → 壳/插画站点闸门）、`check-deck-data --shell`、`check-shell --site prototype/shell-site --require-art`、`check-shell-art --site --require-all`、`check-overflow --debug-go`、`check-rendered-section` 与 68 项运行时检查全部通过；7 屏 × 4 声线 = 28 个非空 MP3，站点 `missingArt: []`。
- 0.13.0 workflow YAML 经 `specify workflow info` 解析成功：90 个顶层步骤、含逐页循环嵌套，无重复 ID；`review-shell` 门禁能读取 `validate-shell` 的 JSON 输出（`previewUrl` / `reviewFile` / `slideCount` / `typeCount` / `narration.voiceCount` / `narration.pageCount`）；`approve-script` 读取 `steps.review-script.output.choice` 与 `context.run_id` 并核对 run state，`verify-script-approval` 紧随其后且要求当前 run。
- `check-shell --shots review/shell-shots --review-out review/shell-preview.md --serve-preview` 实测：30 页占位内容、30 张截图、21 种原生类型、29 项互动自检通过；所有标题含“占位”，4 个音色共 32 个占位 MP3 全部解码成功，并在真实壳里播放了 `xiaolai` 与 `xiaozhi`；自动播放会在互动页停住并提示“下一页”，点“下一页”后才继续；detached 预览服务可复用（第二次运行 `previewReused: true`）。
- 双 harness 已实测：Claude Code 与 Codex 并装后 `.claude/skills` 与 `.agents/skills` 并存；workflow 的 `prompt` 与 `command` 步骤都能经 `codex exec` 调度（command 步骤发送 `$speckit-<name>`）；Codex 在非 git 目录报 `Not inside a trusted directory`，`git init` 后通过；非交互运行必须经 `run-workflow.mjs`，`paused` 返回 exit 3 而不是 0。
- `generate-shell-art --reuse` 已在 001 实测：prompt / 参考图哈希 / 输出哈希 / provenance 全部匹配时复用 cover、end，不读 API key；`check-shell-art --require-all` 仍通过。
- `check-deck-data` 与 `sync-deck-components` 在 001 壳路径实跑通过；`build-audio-adapter` 仅旧 deck 使用，壳路径由 `prepare-shell-site` 取代。
