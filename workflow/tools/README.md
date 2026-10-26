# 工作流校验工具

所有命令从课件项目根目录运行（工具自身依赖在 `workflow/tools/node_modules`）。

## 0. 全量 smoke test

```bash
node workflow/tools/smoke-test.mjs
```

覆盖 content-pack/storyboard/narration schema、coverage 通过/失败、vocabulary 通过/失败、teaching 通过/失败（I3 / draft content）、self-review 通过/失败、style pack 验证/冻结、audio adapter 生成/校验、组件 bundle 生成/校验、script/component-plan/registry、脚本批准账本（通过、缺账本、批准后编辑、伪造 gate、DRAFT、paused run 均断言）、approved screens、review sections 等门禁。任何一项与预期不符 → exit 1。

## 0B. 壳批准（先于内容包）

壳审核独立于内容包，壳生成后立即运行：

```bash
# 1) 壳工作流：validate-shell -> review-shell(人审) -> approve-shell
node workflow/tools/run-workflow.mjs courseware-shell \
  -i shell=shells/branch-choice -i shell_slug=branch-choice

# 2) 内容工作流开头自动校验壳批准；手工检查：
node workflow/tools/check-shell-approval.mjs --shell shells/branch-choice \
  --approval review/shells/branch-choice/shell-approval.json
```

- `approve-shell` 只接受 `review-shell` gate 的 `approve`，并核对 `.specify/workflows/runs/<run-id>/state.json` 中该 gate 已完成；`review/shells/<shell_slug>/shell-approval.json` 记录壳包**全文哈希**、文件数和 gate run id。
- `check-shell-approval` 重新哈希壳包；改任何一个 CSS/JS/资源文件都会让它失效，必须重跑壳工作流。
- `courseware-shell` 不需要 `content_pack`/`lesson_slug`；人工审核只有 `review-shell` 一个 gate。
- 不要把壳审核放回内容工作流，也不要在生产工作流里重复 `validate-shell`/`review-shell`。

## 0A. 脚本批准与 fail-closed 运行

```bash
# 下游工作前必须通过；失败即停止
node workflow/tools/check-script-approval.mjs specs/<lesson>/courseware.md \
  --approval review/script-approval.json

# 非交互运行工作流（不要直接 specify workflow run）
node workflow/tools/run-workflow.mjs courseware-production -i lesson=... ...

# 人工恢复停在 gate 的运行（交互式）
node workflow/tools/run-workflow.mjs resume <run-id>
```

- `review/script-approval.json` 由工作流的 `review-script` gate + `approve-script` 步骤生成，绑定整份 `courseware.md` 的 SHA-256、每屏哈希和 gate run id。`approve-script` 会核对 `.specify/workflows/runs/<run-id>/state.json`：`review-script` 必须已完成且 choice 为 `approve`，`paused` 的 gate 不能铸造批准；`verify-script-approval` 再用 `--expect-run` 要求账本来自当前 run。批准后编辑脚本会让它失效；不要手改，也不要手动运行 `approve-script.mjs`。
- 本地账本只能证明“某次 run 的 gate 记录为 approve”，不能证明按键的一定是真人；老师必须在自己的终端回答 gate，agent 不得代答。
- `run-workflow.mjs` 的新 run **一律生成新 run id**，不继承 `SPECKIT_WORKFLOW_RUN_ID`；`smoke-test.mjs` 启动时清除继承的 run id。页面实现/自审的 agent 不得在 workflow 内跑 `smoke-test` 或其它 workflow（会继承/覆盖运行中的 run）。
- `run-workflow.mjs` 在非交互运行中把 Spec Kit 的 `paused` 映射为 **exit 3**，并打印恢复命令、gate 的完整审核请求（含课件 URL）和 `show_file` 路径。看到 exit 3 就停止；老师在自己的终端交互式恢复。
- 所有下游工具（`check-component-plan`、`build-narration`、`check-narration`、`check-section-freeze`、`freeze-section`、`build-shell-site`、`build-screen`、`check-deck-data`、`check-overflow`、`check-staged-components`、`register-staged-components`、`record-component-usage`）在收到 `--script`（或默认账本）时会重新校验批准；失败不会产生下游产物。

## 1. Schema 校验

```bash
node workflow/tools/validate-json.mjs \
  workflow/schemas/content-pack.schema.json \
  path/to/content-pack.json

node workflow/tools/validate-json.mjs \
  workflow/schemas/storyboard.schema.json \
  path/to/storyboard.yml
```

## 2. 内容覆盖闸门

```bash
node workflow/tools/check-coverage.mjs \
  path/to/content-pack.json \
  path/to/storyboard.yml \
  [path/to/waivers.json]
```

- `content-pack.items[].required = true` 的项必须被至少一个非 `SKIP` 分镜的 `contentRefs` 引用。
- 允许新增内容；不允许删减参考内容。
- 豁免文件格式：`["Q01"]` 或 `{ "waivers": [{ "id": "Q01", "reason": "..." }] }`。
- 引用不存在的 ID 会报错；豁免不存在的/非必填项也会报错。

## 2A. 核心概念覆盖闸门

```bash
node workflow/tools/check-concepts.mjs \
  path/to/courseware.md \
  path/to/content-pack.json \
  path/to/storyboard.yml \
  --concepts path/to/concepts.yml

# 简报阶段（脚本/分镜还没生成）：只校验台账 schema 与 sourceRefs
node workflow/tools/check-concepts.mjs --ledger-only \
  path/to/content-pack.json \
  --concepts path/to/concepts.yml
```

- 台账 `concepts.yml` 列本课的核心概念：术语、一句话定义、`introducedOn`、`mustAppear` 短语、证据、`sourceRefs`。
- 引入页的**屏幕内容**必须逐字包含术语与每条 `mustAppear`（标点/空白归一化后匹配）；只在旁白说、只在代码声明里出现都不算。
- `reinforcedOn` / `assessedOn` 页必须存在、不能是 `SKIP`，且不能早于引入页。
- 引入页的 `contentRefs` 必须包含概念的 `sourceRefs`；`sourceRefs` 必须存在于内容包。
- `--slides` 只检查与该页相关的概念，逐页闸门使用；`--ledger-only` 在简报阶段使用。

## 3. 封闭词表检查

```bash
node workflow/tools/check-vocabulary.mjs \
  path/to/storyboard.yml \
  path/to/style-pack.manifest.json
```

检查分镜使用的组件和版面是否都在风格包或注册表中可用，并拒绝分镜上的 `style/css/html/className` 覆盖。标 `kind: generated` 的风格包条目只是设计语汇：未在注册表 core 中出现时，引用它的分镜会被拒绝。

## 4. 无滚动条闸门

```bash
node workflow/tools/check-overflow.mjs http://127.0.0.1:5173 --script courseware.md --pages 2
```

- 检查页面、`.stage` 和所有受限容器的 `scrollHeight/scrollWidth`。
- 任何溢出 → `exit 1`；必须拆页或精简，不能滚动/裁切。
- 需要 Playwright Chromium；默认路径 `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，可用 `CHROME_PATH` 覆盖。
- 默认只检查当前页；`--pages N` 用 `ArrowRight` 翻页检查。

## 5. W2 逐屏构建/截图

```bash
node workflow/tools/list-approved-screens.mjs path/to/storyboard.yml
# 输出 JSON 数组，供 workflow 的 fan-out items 使用

node workflow/tools/build-screen.mjs S01 \
  --url http://127.0.0.1:5173 \
  --storyboard path/to/storyboard.yml \
  --out screenshots
# 按 storyboard 中非 SKIP 屏的顺序翻页，截图 <out>/S01.png + S01.json
# 同时生成 AI 审核图 <out>/S01.ai.jpg（默认 1280 宽；--ai-format webp / --ai-width 0）
```

`build-screen` 依赖 Playwright Chromium；没有 `--url` 时退回 stub 模式。`--index` 可显式指定 deck 中的序号（deck 只包含部分页时使用）；截图基线对比见 §7。PNG 是证据/人工审核用；`aiImage` 是页自审用的 1280 宽降规格图，默认 JPEG，视觉接口支持 WebP 时可加 `--ai-format webp`。

## 6. R0-C 内容包抽取

```bash
# 1. 爬取参考课件（URL 或本地 HTML/目录）
node workflow/tools/crawl-reference.mjs <url-or-file> \
  --out reference-crawl --pages auto \
  [--next-selector "<css>"] [--storage-state storage-state.json] [--viewport 1440x900]

# 2. 抽内容包草稿
node workflow/tools/extract-content.mjs reference-crawl \
  --out content/lesson.content.json \
  --lesson-id lesson-01 --lesson-title "C++编程入门" --audience "C++ 初学者"

# 3. 校验草稿
node workflow/tools/validate-json.mjs workflow/schemas/content-pack.schema.json content/lesson.content.json
```

- 爬取器用 `ArrowRight` + 常见 next 选择器；页面自定义导航时传 `--next-selector`。
- 草稿抽取是**启发式**：封面/目录可能误判、quiz 答案可能检测不到；必须按 `speckit.extract-content` 命令复核。
- `reference-crawl/` 含第三方页面 HTML/截图，可能含个人信息，已加入 `.gitignore`；不要提交或外发。
- `sensitivity: personal` 的项必须脱敏或排除。

## 7. 截图基线对比

```bash
node workflow/tools/check-baseline.mjs screenshots --baseline baselines/lesson-01
```

- 用 pixelmatch 比较同名 PNG；默认 color threshold 0.1，最大差异比例 0.2%。
- 缺当前截图、尺寸不一致、差异超阈值 → exit 1，diff 图写到 `screenshots/diffs/`。
- `--baseline` 为空 → 跳过（打印提示）。
- 新增屏没有基线时只警告；基线目录需按课次准备。

## 8. 教学硬门禁

```bash
node workflow/tools/check-teaching.mjs storyboard.yml content-pack.json
```

- 每个非 SKIP 屏必须有 `objectiveId`（O1…）；每个 objective 至少 1 个 `level != watch` 的互动（I3）。
- `interaction` 若有，必须含 `type/level/learningFunction/staticAlternative`（I1/I2）。
- 每个 quiz item 必须恰好一个正确选项（`quizType: multi` 时至少一个），且每个选项都有非空反馈（I5 硬部分）。
- content pack 所有 item 必须是 `reviewStatus: "reviewed"`；R0-C 草稿（draft）不能进入制作。
- 缺互动、缺反馈、错误 objective 绑定、未复核内容 → exit 1。
- P3/P4/P6/P7 等仍需组件/人工评审，不在此工具中。

## 9. AI 自审检查

确定性自审（0.22.0；不再启动 AI）：

```bash
# inputs：content pack 的 reviewed/quiz 反馈 + input 门禁
node workflow/tools/build-self-review-inputs.mjs --lesson-slug <slug> \
  --content <content-pack.json> --style <style-pack.manifest.json> \
  --style-full <style-pack.full.json> --style-freeze <style-pack.freeze.json> \
  --source <SOURCE.json> --fidelity <fidelity.json> --registry registry/index.json \
  --shell-ok true --shell-review review/shells/<slug>/shell-preview.md \
  --out review/<slug>/self-review-inputs.json --md review/<slug>/self-review-inputs.md

# script：紧凑逐屏证据包 + density/complexity 自审骨架（AI 只填判断字段）
node workflow/tools/build-script-review-evidence.mjs --lesson-slug <slug> \
  --script specs/<slug>/courseware.md --storyboard specs/<slug>/storyboard.yml \
  --content <content-pack.json> --style <style-pack.manifest.json> \
  --concepts specs/<slug>/concepts.yml --registry registry/index.json \
  --review-sections specs/<slug>/review-sections.yml --review-dir review/<slug> \
  --density-authority script

# alpha / beta / gold：聚合或扫描，不调用模型
node workflow/tools/build-self-review-alpha.mjs ...
node workflow/tools/build-self-review-beta.mjs ...
node workflow/tools/build-self-review-gold.mjs ...

# 任意自审 JSON → Markdown（页自审在 AI 填完后自动渲染）
node workflow/tools/render-self-review-md.mjs review/<slug>/self-review-page-S02B.json \
  --out review/<slug>/self-review-page-S02B.md --screenshots screenshots/<slug>

# 老师版脚本（0.35.0）：只含屏幕内容/旁白/转场/一行学生动作，不含交互设计/制作字段
node workflow/tools/render-teacher-script.mjs specs/<slug>/courseware.md \
  --out review/<slug>/courseware.teacher.md

# 参考适配（0.24.0）：每课一次映射 + 每页确定性残留扫描
node workflow/tools/check-reference-adaptation.mjs \
  review/<slug>/reference-adaptation.json \
  --storyboard specs/<slug>/storyboard.yml --script specs/<slug>/courseware.md \
  --shell shells/<id> --lesson-slug <slug>
node workflow/tools/check-reference-residue.mjs \
  review/<slug>/reference-adaptation.json --url http://127.0.0.1:8082/ \
  --storyboard specs/<slug>/storyboard.yml --slides S02B --json

# 渲染文本（0.25.0）：高信号字面量阻断 + 散文覆盖率提示
node workflow/tools/check-rendered-text.mjs \
  --url http://127.0.0.1:8082/ --deck specs/<slug>/deck.json \
  --storyboard specs/<slug>/storyboard.yml --slides S02B \
  --concepts specs/<slug>/concepts.yml --json
# 同一次浏览器会话里也扫描参考残留：
#   --reference-adaptation review/<slug>/reference-adaptation.json

# 固定 1440×900 播放器（0.26.0）
node workflow/tools/write-player-page.mjs --site shells/<id>/site
# extract-shell / prepare-shell-site / check-shell --serve-preview 会自动写入

# 页自审性能测试（0.27.0）
# 1) 确定性管线：证据包/截图/JSON/MD，重复测平均
node workflow/tools/bench-page-review.mjs \
  --lesson-slug <slug> --script specs/<slug>/courseware.md \
  --content <content-pack.json> --storyboard specs/<slug>/storyboard.yml \
  --sections specs/<slug>/review-sections.yml --deck specs/<slug>/deck.json \
  --concepts specs/<slug>/concepts.yml --site-dir site/<slug> \
  --screenshots screenshots/<slug> --repeat 3 --out /tmp/page-bench.json
# 2) 真实 run：按 step 统计实际耗时（含 self-review-page 模型步骤）
node workflow/tools/workflow-timing.mjs --latest --filter 'page|evidence' --json
# 或指定 run：
node workflow/tools/workflow-timing.mjs --run <run-id>
```

`bench-page-review` 不调用 AI，只测确定性部分；`promptBytes` 由新的单次请求 prompt 构造器
（`page-review-lib.mjs`）估算。真正的 `self-review-page` 耗时用 `workflow-timing` 从真实 run 的
`log.jsonl` 读。基准不是门禁，失败项只记录状态。
`build-page-evidence` 内部并行跑快速检查，overflow/overlap/rendered-text 并发上限 2；证据包
的 `checks[].durationMs` 可直接用于定位最慢检查。

## 9A-1. 单次模型页自审（0.32.0）

页面自审不再走 coding agent。`page-review-ai.mjs` 读取 `build-page-evidence` 的 JSON，把
`aiImage`（缺失回退 PNG）以 base64 内联，只发一次模型请求，要求模型返回一个
`submit_page_review` 结构化对象；没有文件、命令、MCP 工具，也不会有 agent 循环。

```bash
# 1) 配置预检（工作流在页循环前自动跑）
node workflow/tools/page-review-ai.mjs --check-config

# 2) 只看请求，不调用模型（不打印 key/base64）
node workflow/tools/page-review-ai.mjs \
  --lesson-slug <slug> --section S02B \
  --evidence review/<slug>/page-evidence-S02B.json \
  --review-json review/<slug>/self-review-page-S02B.json \
  --dry-run --request-out /tmp/page-review-request.json

# 3) 真实调用；工作流里的正式命令还会带
#    --component-staging registry/staging --unregistered <id,id>
#    --density-authority script（默认；页面只判断渲染结果，不重新判 density）
node workflow/tools/page-review-ai.mjs \
  --lesson-slug <slug> --section S02B \
  --evidence review/<slug>/page-evidence-S02B.json \
  --review-json review/<slug>/self-review-page-S02B.json \
  --component-staging registry/staging --unregistered matrix-fill \
  --density-authority script
```

配置优先读项目内 `.courseware/page-review.json`（已 gitignore），否则读 `~/.config/courseware/page-review.json`；也可用 `COURSEWARE_REVIEW_CONFIG`：

```json
{
  "api": "anthropic-messages",
  "baseUrl": "https://你的视觉模型网关",
  "model": "支持图片输入的模型",
  "apiKeyFile": "~/.config/courseware/page-review.key",
  "maxTokens": 8192,
  "timeoutMs": 120000,
  "structuredOutput": "json"
}
```

- `api`：`anthropic-messages`（`POST {baseUrl}/v1/messages`）或 `openai-chat`（`POST {baseUrl}/v1/chat/completions`）。
- key：`apiKeyEnv` 指向的环境变量（默认 `COURSEWARE_REVIEW_API_KEY`），或 `apiKeyFile`（建议 600）。
- 模型必须支持图片；不支持会直接失败，不会退化成纯文本判断。
- `structuredOutput`：默认 `tool`（forced tool call）；用 `--zcode-config` 复用 ZCode provider 时默认 `json`。DeepSeek 的 Anthropic 兼容端点可能返回 DSML 文本而不是标准 `tool_use`，工具检测到后会**自动重试一次 JSON 模式**；也可以直接写 `"structuredOutput": "json"` 避免这次重试。
- `maxTokens` 默认 **8192**：推理模型可能把几千 token 花在 thinking 上，4096 会在输出前被截断。工具在 `stop_reason: max_tokens` 时会直接提示增大 `maxTokens`，不会写半成品。
- 静态页规则：页面明确声明 `watch` / `static-reading` 且有书面静态理由时，checklist 0（交互是否产出声明证据）记 `n/a`，不因“只是看”判 fail；只有页面声称互动/学生产出证据、实际却直接给答案时才 fail。S02 同一证据 3 次验证全部 pass（2 次保留非阻断提示）。
- `density_authority=page` 时工具允许模型填 `density`；`density_authority=script` 时页面模型不输出 density，`density` 由脚本阶段结论保留。两种模式都只允许模型填 `checklist` / `issues` / `referenceAdaptation` / `verdict`；`signals`、`concepts`、`automatedChecks`、`reviewedArtifacts` 由工具保留/合并。模型声称 `fixed: true` 也会被强制改成 `false`。
- 失败时不会写半成品：schema 不合法、缺截图、HTTP 错误都退出非 0；原始模型输出写到 `review/<slug>/page-review-raw-<section>.json` 方便排查。
- `--zcode-config <provider_config.json> --zcode-provider <id>` 可以直接复用 ZCode 已配置的 Anthropic 兼容 provider/model/key，key 不打印、不落盘。也可以把这两个字段写进 `page-review.json`：`"zcodeConfig": ["~/.zcode/v2/provider_config.json", "/mnt/c/Users/<you>/.zcode/v2/provider_config.json"], "zcodeProvider": "<provider-id>"`。`zcodeProvider` 取 `providerConfigRules.providerRules[].providerId`（本机示例是 `new-provider-2`，不是通用默认值）；`zcodeConfig` 是候选路径数组，Windows 用 `~`、WSL 用 `/mnt/c/...`，谁存在用谁。
- 回归测试：`node workflow/tools/test-page-review-ai.mjs`（本地 mock server，不调用真实模型）。

## 9A-2. 页自审风险校准

```bash
node workflow/tools/page-review-risk.mjs --lesson-slug <slug> \
  --review-dir review --include-archive-sections --json
```

- 输出每页 low/medium/high、风险原因、历史 blocking/真实问题数；
- `wouldSkip` 表示该页会被跳过 AI，`missedBlocking`/`missedAny` 表示会漏掉的历史问题；
- 只用于校准，不改 workflow 行为；没有“0 missed blocking”之前不要启用页级跳过 AI。

## 9B. 页面自审缓存

```bash
node workflow/tools/page-review-cache.mjs --mode check \
  --lesson-slug <slug> --section S02B \
  --evidence review/<slug>/page-evidence-S02B.json \
  --deck specs/<slug>/deck.json --registry registry/index.json \
  --staging registry/staging --unregistered matrix-fill \
  --cache-dir review/<slug>/page-review-cache \
  --review-json review/<slug>/self-review-page-S02B.json --json

node workflow/tools/page-review-cache.mjs --mode store ... --review-json ...
```

- 键由页面脚本、density 信号、脚本阶段 density 结论（`density_authority=script` 时）、参考映射、检查摘要、PNG 与 `aiImage` 哈希、deck slide、registry 和暂存组件文件哈希组成。**换模型或改 prompt 不会自动让缓存失效**；需要重新判断时删掉 `review/<slug>/page-review-cache/` 下对应缓存。
- `check` 命中时把上次 AI 判断字段（含 `referenceAdaptation` 增量）合并到新骨架，刷新 `reviewedArtifacts` 和暂存组件哈希，工作流跳过 `self-review-page`；`reviewMeta.cached` 标记为 `true`。
- `store` 在 `check-self-review-page` 通过后写入缓存；缓存目录是运行时状态，不提交。

```bash
node workflow/tools/check-self-review.mjs review/self-review-brief.json
node workflow/tools/check-self-review.mjs review/self-review-script.json \
  --script path/to/courseware.md --role script --density-authority script \
  --concepts path/to/concepts.yml
```

> 0.34.0 起 density/复杂度以**脚本自审为唯一权威**（`density_authority=script` 默认）：
> `build-script-review-evidence` 生成 `density[]` 与 `complexity[]`，`--script --role script
> --density-authority script` 强制两者；页面自审不再判断 density。
> 显式传 `--density-authority page` 才恢复旧的页面/Alpha density 对照路径。

- 校验 `self-review.schema.json`。
- 要求 `verdict: pass`、无自动检查 `fail`、无未修复 blocking issue、checklist 无 `fail`。
- `--concepts` 要求每个在范围内的概念都有一条 `concepts` 记录（`conceptId`、`verdict: pass`、`evidence`、`slideIds`）；缺条目、`gap` 或引用范围外页面都会失败。
- `--script` / `--storyboard` 同时启用 density 对照；`--slides` 限定逐页范围。`--role script --density-authority script` 还要求 `complexity[]`，且 `components/newComponents > 1` 必须有 `exception` 理由。
- `--role page --density-authority script` 只检查页面判断字段（交互证据、视觉版面、组件行为、占位/个人信息），不强制 density。
- 自审模板在 `workflow/preset/templates/self-review-template.md`。
- 每个 human gate 前都应先跑这个检查；未通过不得请求人工审核。

## 10A. 参考源码直拷与保真

```bash
# 从参考课件目录逐字节复制 CSS/JS，写 SOURCE.json（哈希/字节数）
node workflow/tools/build-style-pack-source.mjs   --reference research/r0/mirror/lesson-01/2026/10/16/1itukgf9auj   --inline-css research/r0/analysis/lesson-01/inline.css   --out style-pack/source

# 只校验源码副本（不要求 site 已存在）
node workflow/tools/check-source-fidelity.mjs --source-only

# 校验源码 + site 副本 + 渲染 DOM/几何/动画（需要本地服务器）
node workflow/tools/check-source-fidelity.mjs   --url http://127.0.0.1:8080/   --source style-pack/source/SOURCE.json   --fidelity style-pack/source/fidelity.json   --site prototype/site
```

- CSS/JS 必须与参考逐字节一致；`SOURCE.json` 记录 SHA-256 与字节数。
- `index.html` 的 inline base CSS 必须等于 `00-base.css`。
- `fidelity.json` 记录舞台几何、外壳选择器、必填 CSS marker、动画（含 APNG 帧数）和每个组件的 DOM 选择器。
- 标 `kind: generated` 的条目只登记设计语汇与选择器，不能当作可复制实现；其 renderer 必须来自注册表 core。
- `--source-only` 用于 M0/脚本阶段；完整模式用于逐页和 Alpha。
- 参考图片/音频只在本机使用，不进入可分享包。

## 10B. Deck 数据门禁

```bash
node workflow/tools/check-deck-data.mjs   --script courseware.md   --url 'http://127.0.0.1:8080/?lesson=lesson-01'   --storyboard specs/lesson-01/storyboard.yml   [--sections specs/lesson-01/review-sections.yml --section A]   --fidelity style-pack/source/fidelity.json   --registry registry/index.json
```

- 读取浏览器里的 `COURSEWARE_SLIDES`，对照 storyboard 的 id/title/顺序；逐页模式只检查本页。
- `--script`（可选）会在启动浏览器前重新校验脚本批准账本；批准失效时直接拒绝。
- `type` 必须是 fidelity 的参考 renderer 类型或已注册 core 组件 id；`kind: generated` 条目的类型只在其注册表实现为 core 后才允许，并会在浏览器里核对 `CoursewareComponents.has(type)`，防止 bundle 未同步。
- 禁止 `html`/`innerHTML`/`style`/`on*` 等页面级实现字段。
- 每屏旁白必须能从 `LESSON_NARRATION` 解析，并且 `LESSON_VOICE_MANIFEST.clips` 含全部声线。

## 10C. 组件 bundle（注册表 → deck）

```bash
node workflow/tools/sync-deck-components.mjs   --registry registry/index.json   --out prototype/site/components.bundle.js   --css-out prototype/site/components.bundle.css   --site prototype/site

# 检查生成物是否过期
node workflow/tools/sync-deck-components.mjs --registry registry/index.json --check
```

- 只打包 `status: core` 组件；staging/deprecated 不进入课件。
- 组件实现必须是浏览器 `.js`，并调用 `window.CoursewareComponents.register('<id>', { render, bind })`；JSX/MDX 会被拒绝。
- `component.json` 的 `styles` 会被汇总到 `components.bundle.css`。
- 页面只写组件 props；不得把组件实现复制进 `slides.js`/`index.html`。

## 10D. 语音适配器

```bash
node workflow/tools/build-narration.mjs courseware.md   --voices research/r0/voice-catalog.json   --out prototype/site/narration.json   --audio-dir prototype/site/audio --url-prefix /audio

node workflow/tools/build-audio-adapter.mjs prototype/site/narration.json   --out prototype/site/audio.js
```

- 语音引擎是逐字节复制的参考 `lesson-audio.js`；`audio.js` 只提供 `LESSON_AUTOPLAY_CONFIG` / `LESSON_NARRATION` / `LESSON_VOICE_MANIFEST` / `LESSON_VOICE_DURATIONS`。
- `build-narration` 与 `check-narration` 在写/校验音频前会断言脚本批准账本（默认 `review/script-approval.json`，可用 `--approval` 覆盖）；批准失效时不会生成音频。
- 目录与播放器来自参考外壳，不另写一套。
- 时长按 48kbps MP3 估算（进度/时钟用），播放仍以实际 audio 元素为准。

## 10. 风格包验证/冻结

```bash
node workflow/tools/validate-style-pack.mjs style-pack.full.json --check-baselines
node workflow/tools/validate-style-pack.mjs style-pack.full.json --check-baselines \
  --freeze style-pack.freeze.json
node workflow/tools/freeze-style-pack.mjs style-pack.full.json --out style-pack.freeze.json
```

- full spec 必填：`propsSchema`、`states`、`whenToUse`、`whenNotToUse`、`learningFunction`、`accessibility`、`baseline`。
- `--check-baselines` 校验 baseline 文件存在。
- `--freeze` 重算 freeze 清单的 pack + baseline 哈希并比对；工作流要求该检查通过。
- freeze 先跑校验，再写 `id/version/sourceHash/frozenAt/baselineFiles`；校验失败拒绝冻结。
- 当前 `style-pack/` 是参考源码直拷的 v2 风格包；先跑 `build-style-pack-source.mjs` 与 `check-source-fidelity.mjs --source-only`，再 freeze。
- 参考图片/音频的授权未解决前，不随风格包分发。
