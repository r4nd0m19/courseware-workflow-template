---
description: 按 APPROVED 分镜生成制作任务，含组件集成任务、Deps/DoD 与闸门。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 读取 `plan.md`、`storyboard.yml`、`courseware.md`、`review-sections.yml`、`component-plan.md` 和 `.specify/templates/tasks-template.md`。
2. 只为 `status: APPROVED` 的屏生成任务；`DRAFT`/`SKIP` 跳过。
3. 按 `review-sections.yml` 的页分组页面任务；每一页末尾生成一个逐页审核任务：
   - 只实现/渲染本页；上一页 `approve` 后才进入下一页
   - 老师打开课件、用目录跳到本页，逐项看屏幕与交互证据并给出 `approve / reject`
   - `reject` 时只返工本页，已批准页由脚本哈希冻结
4. 每个页面任务包含：
   - 对应 slide ID / scriptSection / contentRefs / components / layout
   - Deps（前置屏、内容确认、组件已注册）
   - DoD（脚本一致性、schema、词表、内容覆盖、无滚动条、截图基线、§6 硬项）
5. 为使用新组件的屏生成组件集成任务（TC）：
   - 组件已审核并注册进 core，版本锁定
   - 运行 `sync-deck-components.mjs` 生成 `components.bundle.js` / `components.bundle.css`；页面只写 props，不复制组件代码
   - props 符合 `propsSchema`，交互状态/键盘/降级可用
   - 若组件是 `reference-verbatim`：校验源码哈希/DOM 选择器/动画仍与参考一致
6. 为每一页生成 deck data 任务（DD）：
   - 只改本页在 `deck.json` 的条目；id/title/顺序与 storyboard 一致
   - 不修改参考 CSS/JS/index renderer；不写裸 HTML/CSS/JS
   - 运行 `check-deck-data.mjs --section <id>` 与 `check-source-fidelity.mjs --url <deck-url>`
7. 为语音/目录生成集成任务（AV）：
   - `build-narration.mjs` → `build-audio-adapter.mjs`；参考 `lesson-audio.js` 与外壳目录不动
   - 四种声线（小智/小创老师/小未/小来老师）均可选、可播放、可暂停/拖动
8. 生成一个全局闸门任务（全部页批准后），运行：
   - `node workflow/tools/check-section-freeze.mjs --sections review-sections.yml --storyboard storyboard.yml --script courseware.md --require-all`
   - `node workflow/tools/check-script.mjs courseware.md <content-pack> <style-pack-manifest> registry/index.json`
   - `node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml`
   - `node workflow/tools/validate-json.mjs workflow/schemas/storyboard.schema.json <storyboard>`
   - `node workflow/tools/check-coverage.mjs <content-pack> <storyboard> [waivers]`
   - `node workflow/tools/check-vocabulary.mjs <storyboard> <style-pack-manifest> registry/index.json`
   - `node workflow/tools/check-teaching.mjs <storyboard> <content-pack>`
   - `node workflow/tools/check-registry.mjs registry/index.json --style-pack <style-pack-manifest>`
   - `node workflow/tools/check-overflow.mjs <deck-url> --pages <N>`
   - `node workflow/tools/check-deck-data.mjs --url <deck-url> --storyboard storyboard.yml`
   - `node workflow/tools/check-source-fidelity.mjs --url <deck-url>`
9. 需要新组件/版面时：确认 component-plan 与简报已获人工批准；在首次使用它的页面的任务里写明“该页构建组件（`speckit.component-build`）→ 随页审核 → 页面通过后注册”。不得在实现阶段自行发明组件，也不得在 deck.json 里写页面特判。
10. 输出 tasks 路径、任务数、页数、阻断项。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `review/self-review-tasks.json` 和 `.md`。
- 检查只含 APPROVED 屏、Deps/DoD 完整、所有组件已注册、闸门命令完整；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；修不了就停止，不得请求人工审核。
- 只有自审 pass 后才进入下面的 Human Review。

## Human Review（强制）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 `tasks.md`。
- 主动提出审核请求：任务范围、组件集成任务、Deps/DoD、阻断项。
- 明确询问：`Approve tasks? (approve / reject / request changes)`。
- 未获 `approve` 不得进入 implement。
