# 制作任务：<lesson title>

> 只实现 `APPROVED` 的屏；`DRAFT`/`SKIP` 不进入制作。
> 内容改动一律改 `courseware.md`，再重新投影 `storyboard.yml`；不要直接改分镜。
> `review-sections.yml` 每页一项：逐页实现、逐页渲染、逐页人工审核；当前页 approve 后才进入下一页。

## 任务格式

## 页 S01 — <page title>

### T01 — S01 <title>

- **来源**：`courseware.md` §S01 / `storyboard.yml` S01
- **Deps**：S01 已 APPROVED；相关 contentRefs 已确认；所用组件已注册
- **DoD**：
  - [ ] 页面文字/代码/输出与脚本「屏幕内容」逐字一致
  - [ ] 交互状态、成功/错误反馈、完成条件与脚本「交互设计」一致
  - [ ] 只使用已注册组件/版面；无裸 HTML/CSS/JS；无课件级样式覆盖
  - [ ] `slides.js` 数据只含 id/title/type/props；id/title/顺序与 storyboard 一致
  - [ ] `type` 来自 `fidelity.json` 的 `sourceTypes` 或 core 组件 id；无 `html`/`style`/`on*`
  - [ ] `contentRefs` 中所有 required 项在本屏可见/可操作
  - [ ] deck-data / source-fidelity / schema / 脚本 / 词表 / 内容覆盖 / 无滚动条闸门通过
  - [ ] 截图与基线一致，或差异已人工确认
  - [ ] 教学硬项（P/I）通过，或书面豁免

### TR-S01 — 页 S01 渲染审核

- **范围**：S01（`review-sections.yml` 中每个 section 只含一页）
- **Deps**：本页页面任务完成；自动闸门通过；AI 自审 pass
- **审核材料**：可运行课件 <http://127.0.0.1:8082/> + `screenshots/S01.png` + `review/self-review-page-S01.md`
- **DoD**：
  - [ ] 老师打开课件、用目录跳到本页，逐项确认屏幕内容/交互证据与脚本一致
  - [ ] 老师确认本页没有滚动条、裁切、拥挤
  - [ ] 老师给出 `approve` 或 `reject`（附具体意见）
  - [ ] `approve` 后运行 `freeze-section.mjs` 冻结本页脚本哈希，才进入下一页
  - [ ] `reject` 后只返工本页；已批准页不得修改

> 后续页按同样结构展开，每页末尾都有 TR 审核任务。

## 组件任务

> 新组件不在全量预构建阶段完成：在首次使用它的页面任务里构建（`speckit.component-build`），随该页一起人工审核，页面通过后注册；本阶段只做页面集成与用法验证。

### TC01 — 集成 <component-id>@<version>

- **来源**：`component-plan.md` / `component-briefs/<id>.md`
- **Deps**：组件已审核并注册进 core；`check-registry` 通过
- **DoD**：
  - [ ] 组件由 `sync-deck-components.mjs` 打包进 `components.bundle.js/.css`；页面只传 props，不复制实现
  - [ ] props 符合 `propsSchema`，无未知 prop
  - [ ] 交互状态与简报状态机一致；键盘/ARIA/降级可用
  - [ ] `reference-verbatim`：CSS/JS 哈希、DOM 选择器、动画帧数与参考一致
  - [ ] 组件在基准视口无滚动条/裁切

## 语音与目录任务

### TA01 — Edge TTS 语音与播放器

- **来源**：`courseware.md` 每屏「旁白 / 语音」
- **Deps**：脚本已 APPROVED；声线目录有效
- **DoD**：
  - [ ] `build-narration.mjs` 生成 manifest 与每种声线的 MP3
  - [ ] `check-narration.mjs` 通过（raw/spoken 文本、音频文件、sourceHash）
  - [ ] `build-audio-adapter.mjs` 生成 `audio.js`，参考 `lesson-audio.js` 未改
  - [ ] 顶栏声线可选；播放/暂停/拖动进度正常
  - [ ] 目录由参考 `buildOutline()` 生成，覆盖全部页面且可跳转

## 跨屏任务

### T99 — 全局闸门（全部页批准后）

- [ ] `node workflow/tools/check-section-freeze.mjs --sections review-sections.yml --storyboard storyboard.yml --script courseware.md --require-all`
- [ ] `node workflow/tools/validate-style-pack.mjs style-pack/style-pack.full.json --check-baselines --freeze style-pack/style-pack.freeze.json`
- [ ] `node workflow/tools/check-script.mjs courseware.md ... registry/index.json`
- [ ] `node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml`
- [ ] `node workflow/tools/validate-json.mjs ... storyboard.yml`
- [ ] `node workflow/tools/check-coverage.mjs ...`
- [ ] `node workflow/tools/check-vocabulary.mjs ... registry/index.json`
- [ ] `node workflow/tools/check-teaching.mjs ...`
- [ ] `node workflow/tools/check-overflow.mjs ... --pages N`
- [ ] `node workflow/tools/check-deck-data.mjs --url ... --storyboard storyboard.yml ...`
- [ ] `node workflow/tools/check-source-fidelity.mjs --url ... --source ... --fidelity ... --site prototype/site`
- [ ] `node workflow/tools/check-registry.mjs registry/index.json --style-pack ...`
- [ ] `node workflow/tools/sync-deck-components.mjs --registry registry/index.json --check`
- [ ] `node workflow/tools/build-audio-adapter.mjs prototype/site/narration.json --out prototype/site/audio.js --check`
- [ ] 老师 Alpha/Beta/Gold 签字

## 未决

- 需要退回 component-plan 的组件缺口：
- 需要书面豁免的硬项：
