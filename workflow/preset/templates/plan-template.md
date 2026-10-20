# 技术计划：<lesson title>

> 内容源是 `courseware.md`（已获人工 `approve`）。本文件只记录制作侧决策，不重写教学内容。
> `storyboard.yml` 由脚本投影生成，**不要手改**；手工修改会在一致性检查中被判失败。

## 1. 输入与前置

- 课件脚本：`courseware.md`（frontmatter `status: APPROVED`）
- 内容包：`<content-pack.json>`
- 风格包 manifest：`<style-pack manifest.json>`
- 完整风格包与冻结清单：`style-pack/style-pack.full.json` / `style-pack/style-pack.freeze.json`（pack+baseline 哈希）
- 直拷源码清单：`style-pack/source/SOURCE.json`（CSS/JS 哈希）
- 保真合约：`style-pack/source/fidelity.json`（几何/DOM/动画/组件类型）
- 参考外壳与 deck 数据：`prototype/site/index.html` / `prototype/site/slides.js`
- 组件注册表：`registry/index.json`
- 组件计划：`component-plan.md`（已获人工 `approve`；新组件已入 core）

## 2. 分镜投影

```bash
node workflow/tools/script-to-storyboard.mjs courseware.md --out storyboard.yml
node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml
```

- 投影只复制脚本的机器字段，不引入新内容；脚本改了就重新投影。
- 投影后运行：schema、内容覆盖、词表（含注册表）、教学闸门。
- deck 数据是唯一实现载体：`slides.js` 的 id/title/顺序与 `storyboard.yml` 一致，`type` 只能取自 `fidelity.json` 的 `sourceTypes`、已注册 core 组件 id，或已批准 component-plan 中声明且由本页/前序页实现的 new/extend 组件 id。
- 参考 CSS/JS 逐字节来自 `style-pack/source/`；页面只允许由 `sync-deck-components` 插入 bundle 标签。

## 3. 分镜摘要

| Slide | 标题 | Objective ID | contentRefs | Components | Layout | Interaction | 状态 |
|---|---|---|---|---|---|---|---|
| S01 |  | O1 | K01 | eyebrow-heading, rich-text | content-slide | watch | APPROVED |

## 4. 覆盖矩阵

| content ID | 类型 | slides | covered |
|---|---|---|---|
| K01 | knowledge | S01 | yes |

## 5. 组件映射

| Slide | 学习动作 | 组件 | 来源 | 版本 |
|---|---|---|---|---|
| S01 | 阅读概念 | rich-text | style-pack | 1.0.1 |
| S02 | 观察参考交互 | quiz-code | reference-verbatim | — |
| S03 | 点击下标 | matrix-lab | registry | 1.0.0 |

- 来源四选一：`reference-verbatim`（参考源码已有，逐字节/逐函数复制）、`style-pack`、`registry`、`new`。
- 所有组件必须来自风格包或 `status: core` 的注册表条目；`deprecated` 不得使用。
- 脚本中出现未注册组件时，**退回 component-plan 补简报并获人工批准**；实现由首次使用它的页面在页面循环内完成，不得在实现阶段临时发明。

## 6. 页面预算与拆页

- 视口：1440×900；舞台：1380×742（以 `fidelity.json` 的 `stage` 为准）。
- 一页一个教学单元；所有内容单页完整显示，**不允许滚动条**。
- 超页在语义边界拆页，续页由脚本 `continuedFrom` / `continued` 表达，再重新投影。

## 7. 闸门

```bash
node workflow/tools/validate-json.mjs workflow/schemas/storyboard.schema.json storyboard.yml
node workflow/tools/check-coverage.mjs <content-pack> storyboard.yml [waivers.json]
node workflow/tools/check-vocabulary.mjs storyboard.yml <style-pack-manifest> registry/index.json
node workflow/tools/check-teaching.mjs storyboard.yml <content-pack>
node workflow/tools/check-overflow.mjs <deck-url> --pages <N>
node workflow/tools/check-deck-data.mjs --url <deck-url> --storyboard storyboard.yml --fidelity style-pack/source/fidelity.json --registry registry/index.json
node workflow/tools/check-source-fidelity.mjs --url <deck-url> --source style-pack/source/SOURCE.json --fidelity style-pack/source/fidelity.json --site prototype/site
node workflow/tools/sync-deck-components.mjs --registry registry/index.json --check
node workflow/tools/build-audio-adapter.mjs prototype/site/narration.json --out prototype/site/audio.js --check
```

## 8. 风险

- 脚本与实现漂移风险（只改 storyboard 不改脚本）：
- 组件行为风险：
- 内容超页风险：
- 敏感数据风险：

## 9. 设计决策与理由（含业界范式对照）

| 决策 | 业界范式 / 依据 | 采用或偏离 | 理由 |
|---|---|---|---|
| 参考视觉与组件 | 设计系统源码直拷 + 视觉回归基线 | 采用 | 截图无法覆盖动画；哈希/DOM/APNG 可机械验证 |
| deck 数据 | 数据驱动 slide 数组 + 固定 renderer | 采用 | 内容与实现分离，组件可注册复用 |
| 组件库 | 注册表 + staging → review → core | 采用 | 复用优先，变更可追溯 |
| 语音 | Edge TTS + 预生成 MP3 + 数据驱动播放器 | 采用 | 本地可跑，播放器复用参考实现 |
| 逐节渲染审核 | 人工 gate + 脚本哈希冻结 | 采用 | 早发现问题，避免整份返工 |

- 若偏离上表范式：写明偏离项、影响范围、人工批准记录。
