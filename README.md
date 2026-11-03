# 信奥互动课件工作流模板

这是 Spec Kit 的 `courseware-production` + `courseware-shell` 工作流模板，用于在**新项目**里装好课件生产流水线：壳生成/审核 → 教学简报 → 人类可读脚本 → 概念台账 → 分镜 → 逐页组件/页面审核 → 渲染与门禁 → 壳站点。

模板只包含工作流引擎、preset、Node 门禁工具、示例、内置判题运行时和安装脚本；**不包含**具体课件的壳、风格包、用户自己的注册表、研究资料、插画或截图。模板自带 `judge-runtime/` 与暂存组件 `registry/staging/code-judge/`（安装时复制到项目），用于阶段编程题；用户自己的组件仍由项目维护。完整阶段、产物与审核点见 `工作流说明.md`。

- 工作流版本：`courseware-production` `0.46.1`（90 个顶层步骤，0 个 command/prompt 步骤）+ `courseware-shell` `0.1.0`（3 个顶层步骤）
- preset：`courseware` `0.3.16`
- 模板版本：`0.25.0`（2026-11-03）
- 人工审核只有 **3 类**：壳（`courseware-shell`，先于内容包）、整份课程脚本、每一页。`review-inputs`/`review-brief`/`review-self-study-audit`/`review-shell-art`/`review-component-plan`/`review-alpha`/`review-beta`/`gold` 的人类 gate 已移除。
- 脚本审核：`review-script` 显示自动生成的老师版 `review/<lesson>/courseware.teacher.md`，只含标题、屏幕内容、旁白、转场和一行“学生要做”摘要；交互设计与制作字段保留在 `courseware.md` 供工具使用，脚本批准账本仍绑定完整源文件。
- 页面实现：`build-page-deck-evidence` + `single-shot-generate --mode page-deck` + `apply-page-deck`；模型只返回一页 slide JSON，Node 校验后写 deck，不再由 coding agent 构建/截图。
- 0.44.1 工作流修复：新增 `declared_pages` 页数预算；校验 `audio_url_prefix` 并阻止 Git Bash 路径改写；修复 existing 组件跨页复用误报；修复脚本自审证据的 objective 与补充标签；`gate-review show` 自动定位课时 gate 目录。
- 阶段练习页（0.46.0）：脚本大纲可以把某页标为 `exercise`（`code-judge`），页面模型只返回题面、起始代码和 1–6 组公开测试，屏幕内容由 Node 渲染；`apply-page-deck` 要求题面、代码、测试和时限逐字一致，拒绝隐藏测试、`disabled` 和静态降级。阶段练习只用于课堂练习，**不锁定翻页、没有通关门禁**；最多 4 个、非首页、不连续。模板自带判题运行时与 `code-judge` 暂存组件，安装时复制到项目；首次使用判题页前运行 `node judge-runtime/install.mjs` 下载并校验约 91MB 的 browsercc（已 gitignore）。
- 0.46.1 修复：一份 AI 配置文件驱动页面自审与文本生成（`model` 用于看图审核，`textModel` 用于长文本）；新建项目没有 `.specify/feature.json` 时回退 `specs/<lesson>/spec.md`；Windows 路径、沙箱和参考提取兼容；AI 步骤超时放宽；推理模型建议 `maxTokens: 32768`、`timeoutMs: 300000`。
- Beta 收敛（0.44.0）：`generate-converge-report.mjs` 读取 Alpha/批准/截图/`review/<lesson>/trial-feedback.md`，有试用反馈时一次无工具模型调用只返回 findings/verdict/followUps；没有反馈时直接生成空报告，不调用模型。报告不修改已批准内容，未关闭 blocker 由 Beta 确定性扫描拦下。
- 脚本生成：`build-script-input` → `generate-courseware-script`（大纲 JSON → 逐页 page JSON → 校验/局部重试）→ `render-courseware-md` + `render-review-sections`；生产 workflow 的 `script` 步骤是 shell，不再调用 `speckit.script`。
- 教学简报 / 自学审核：`generate-brief` 渲染 `spec.md` + `concepts.yml`；`generate-self-study-audit` 生成 rubric/缺口/补充或新增页判断，Node 生成 `self-study-audit.json` + 报告 + `courseware.self-study.md`，并用 `check-self-study` 校验；新增页会同步 `review-sections.yml`。`brief` / `self-study-audit` 步骤不再调用 coding agent。
- 脚本生成：`build-script-input` 生成紧凑输入包（spec/content/concepts/style/registry/模板/规则/输出路径）；结构化生成器只接收这个包，不读仓库。
- 插画简报/参考适配：`build-art-brief-evidence` / `build-reference-adaptation-evidence` + `single-shot-generate.mjs`，单次模型调用，不再走 coding agent。
- 自审性能：`speckit.specify` / `speckit.script` / `speckit.self-study-audit` / `speckit.component-plan` 在 workflow 里带 `--no-self-review`，只生成产物；`self-review-brief` / `self-review-script` / `self-review-component-plan` 改为 `review-ai.mjs` 的单次文本模型调用，不再走 coding agent。
- 页面审核：默认 `page_review_scope=visual-script`，AI 只拿本页截图和已批准脚本页，判断可见内容是否与脚本一致、排版是否有问题；0.37.0 起页面证据不再跑 overflow/overlap（交给截图 AI + 老师），精确文本/quiz/概念/旁白/参考残留/截图绑定仍阻断。视觉自审通过后才进入老师逐页审核；`page_review_scope=evidence` 可回滚到完整证据包。
- 自审：`inputs`/`alpha`/`beta`/`gold` 确定性汇总；**density 与交互/组件复杂度在脚本自审阶段判定**（`density_authority=script` 默认），页面自审不再判断 density；`density_authority=page` 保留旧路径用于回滚。参考适配每课一次；高信号渲染文本确定性检查 + 散文覆盖率提示。页面自审是**单次模型调用**（证据 + 内联截图 → 结构化 JSON，无文件/命令工具），模型/端点/key 由用户配置。
- 播放器：`player.html` 固定 1440×900 画布、整体缩放；无外层工具栏，页面上只看到课件本身；宽屏两侧用课件自身背景延伸，不再留天空色空白；浏览器缩放不再重排，审核链接使用播放器。
- 许可：private（对外发布前需确认 preset 许可与素材授权）

## 在 Codex 图形界面里使用

这是本项目推荐的入口：**新建项目 → 丢一个脚本 → 让 Codex 自己安装**。

1. 在 Codex 图形界面新建/打开一个空项目目录（`Ctrl+O` / `⌘O`）。
2. 把本仓库根目录的 `bootstrap-codex-courseware.sh` 复制到该项目根目录。
3. 在 Codex 对话框里输入：

   ```text
   请在当前项目根目录执行：
   bash bootstrap-codex-courseware.sh
   安装完成后运行 specify workflow info courseware-shell 和 specify workflow info courseware-production，并把结果报告给我。
   ```

4. 如果 Codex 询问是否信任该目录或是否允许执行命令，选择允许。脚本会先 `git init`，因为 Codex 需要可信任的 git 目录。
5. 安装完成后，在 Codex 中重新打开项目，或执行 **Force Reload Skills**。确认技能列表里有 `speckit-script` 等技能；Codex 里用 `$speckit-*` 调用，Claude Code 里用 `/speckit-*`。
6. 本模板不带壳；把本项目的 `shells/<shell>/`（风格包 manifest/full/freeze/source）放好后，**先跑 `courseware-shell`**：用 30 页**占位内容** + 4 音色**占位语音**做壳预览并人工审核（`review-shell`），通过后写壳批准账本；壳批准后再跑 `courseware-production` 做内容。壳审核不需要内容包。
7. 人工审核只有壳、整份脚本、每一页三类：gate 暂停后，agent 会把审核文件绝对路径或课件 URL 发给你，并用 harness 原生提问 UI（ZCode/Claude Code 的 `AskUserQuestion`；Codex 的原生 user-input / approval 提示）让你点通过/不通过；你点完后 agent 运行 `gate-review.mjs decide`，再用 `run-workflow.mjs resume` 继续。

### Codex 图形界面的限制

完整课件生产需要本机环境：Node.js、npm、Microsoft Edge TTS、Playwright/Chromium、8082 端口和本地文件系统。**Codex Web / Cloud 不能跑完整流程**；请使用 Codex 桌面应用或本地 CLI，并让项目位于 WSL/Linux/macOS 本地磁盘。

如果项目在 Windows 盘符下、通过 WSL 访问，路径会变成 `/mnt/c/...`；浏览器、TTS 和 Node 都应在同一个 WSL 环境里。建议把项目放在 WSL 家目录（如 `~/code/...`）。

## 在 ZCode 里使用

ZCode 是 Spec Kit 的内置 integration（`zcode`），技能渲染到 `.zcode/skills`。0.44.0 起 workflow 的 AI 步骤由 Node 直接调用模型，不再由 `zcode -p` 执行；`zcode -p` 只用于手动 `speckit-*` 技能。

```bash
# 在项目根目录；确保 zcode CLI 在 PATH 上
bash bootstrap-codex-courseware.sh --integration zcode

# 已有 Spec Kit 项目
specify integration install zcode
specify integration use zcode
```

安装后运行 workflow 时传 `-i integration=zcode`。人工审核仍用 ZCode 的原生 `AskUserQuestion`，不需要 MCP 面板。

一个项目可以放多个课件：内容工作流每次传 `-i lesson_slug=<slug>`，运行时状态隔离到 `review/<slug>/`、`screenshots/<slug>/`、`review/<slug>/gui-gates/`；壳工作流按 `-i shell_slug=<slug>` 把审核证据放在 `review/shells/<slug>/`，壳 gate 的 pending 在 `review/gui-gates/`。`shells/`、`registry/`、`workflow/` 共享。

审核时 agent 必须调用当前 harness 的原生提问 UI，选项只用中文 **“通过，继续”** / **“不通过，需要改”**。默认老师不懂英语和技术术语：不要出现 approve/reject/gate/verdict/content-pack/路径/命令，不要要求老师运行命令、改文件、装软件或提供 JSON。缺少资料时只问老师有没有教案、讲义、网页、Word、PDF 或图片。

安装完成后**不需要重启 ZCode**：打开 `START-HERE.md`，或直接对 agent 说 **“开始做课件”**。老师不需要使用 `speckit-*` 技能，也不需要运行任何命令。

## 页面自审模型配置（必须）

0.32.0 起页面自审不再由 coding agent 执行，而是一次直接模型调用。运行前必须提供一个支持图片输入的模型。配置优先读项目内 `.courseware/page-review.json`（已 gitignore，Windows/WSL 可共用），否则读 `~/.config/courseware/page-review.json`：

```bash
install -d -m 700 ~/.config/courseware
cat > ~/.config/courseware/page-review.json <<'JSON'
{
  "api": "anthropic-messages",
  "baseUrl": "https://你的视觉模型网关",
  "model": "支持图片输入的模型",
  "textModel": "长文本生成模型",
  "apiKeyFile": "~/.config/courseware/page-review.key",
  "maxTokens": 32768,
  "timeoutMs": 300000,
  "structuredOutput": "json"
}
JSON
chmod 600 ~/.config/courseware/page-review.json
printf '%s' '<api-key>' > ~/.config/courseware/page-review.key
chmod 600 ~/.config/courseware/page-review.key

node workflow/tools/page-review-ai.mjs --check-config
```

- `api` 支持 `anthropic-messages`（`/v1/messages`）和 `openai-chat`（`/v1/chat/completions`）。
- 也可以不用配置文件，改用 `COURSEWARE_REVIEW_API`、`COURSEWARE_REVIEW_BASE_URL`、`COURSEWARE_REVIEW_MODEL`、`COURSEWARE_REVIEW_API_KEY`。
- 模型必须支持图片；不支持会直接失败，不会退化成纯文本判断。`textModel` 只用于文本步骤，不要求图片能力。
- 同一份配置驱动所有 AI 步骤：页面自审用 `model`，简报/脚本/组件/收敛等长文本步骤用 `textModel`（缺省回退 `model`）；显式命令行参数仍优先。
- `structuredOutput` 建议 `json`；DeepSeek 兼容端点可能返回 DSML 文本，工具检测到会自动重试一次 JSON 模式。`maxTokens` 默认 8192，推理模型可能把几千 token 花在 thinking 上；长输出步骤建议 `maxTokens: 32768`、`timeoutMs: 300000`。
- ZCode 用户可以在配置里写 `"zcodeConfig": ["~/.zcode/v2/provider_config.json", "/mnt/c/Users/<you>/.zcode/v2/provider_config.json"], "zcodeProvider": "<provider-id>"`，直接复用 ZCode 已配置的 provider/model/key，不需要另外复制 key。`zcodeProvider` 取 `providerConfigRules.providerRules[].providerId`（本机示例是 `new-provider-2`，不是通用默认值）；`zcodeConfig` 是候选路径数组，Windows 用 `~`、WSL 用 `/mnt/c/...`，谁存在用谁。
- 工作流在逐页循环前运行 `check-page-review-config`，配置缺失会提前失败。
- `page-review-ai.mjs --dry-run` 可以只生成请求预览，不调用模型、不打印 key。

## 命令行安装

```bash
# 在项目根目录（默认 Codex）
bash bootstrap-codex-courseware.sh

# 或从任意位置指定项目
bash bootstrap-codex-courseware.sh --target /path/to/project

# ZCode 项目
bash bootstrap-codex-courseware.sh --integration zcode --target /path/to/project

# Claude Code 项目
bash bootstrap-codex-courseware.sh --integration claude --target /path/to/project

# 已有 Spec Kit 项目：补装所选集成并保留其他集成
bash bootstrap-codex-courseware.sh --target /path/to/project --integration zcode

# 更新工作流（覆盖已有 workflow/）
bash bootstrap-codex-courseware.sh --integration zcode --force
```

脚本会：

1. 检查 Node >= 18、npm、git；
2. 缺少 `specify` 时，用 `uv tool install specify-cli` 或 `pipx install specify-cli` 安装 Spec Kit CLI；
3. 克隆模板到临时目录；
4. 在目标目录 `git init`，写入 `.gitignore` 和 `AGENTS.md`（已存在则保留）；
5. 运行 `workflow/install.mjs --integration codex`，安装 `gui-gate` step、preset 和两个工作流（`courseware-shell` + `courseware-production`）；首次安装会把模板自带的 `judge-runtime/` 和 `registry/staging/code-judge/` 复制到项目（已有则保留）；旧版 `.zcode/config.json` 里的 `courseware-approval` 条目会被移除；
6. `npm ci` 安装 `workflow/tools` 依赖；
7. 检测 Chrome/Chromium；没有则用项目内的 `playwright-core` 下载 Chromium；
8. 跑 `smoke-test.mjs`、`specify workflow info courseware-shell` 和 `specify workflow info courseware-production` 做验证。

常用选项：

| 选项 | 作用 |
| --- | --- |
| `--repo <url\|path>` | 指定模板仓库（默认本机 `file://$HOME/code/courseware-workflow-template`） |
| `--ref <branch\|tag>` | 指定模板分支/标签 |
| `--target <dir>` | 安装到指定项目目录（默认脚本所在目录） |
| `--integration <codex\|zcode\|claude>` | 安装的集成（默认 `codex`） |
| `--no-browser` | 跳过 Chromium 下载/检测 |
| `--force` | 覆盖已有 `workflow/` |

环境变量：`COURSEWARE_TEMPLATE_REPO` 覆盖默认模板仓库；`CHROME_PATH` 指定浏览器。

## 安装后验证

```bash
specify workflow info courseware-shell        # 应显示 0.1.0、3 steps
specify workflow info courseware-production   # 应显示 0.46.1、90 steps
specify integration status                    # 应包含 codex
node workflow/tools/smoke-test.mjs            # 完整开发仓库 152/152；模板仓库 140/140（8 项依赖开发样例的检查 SKIP）
ls .agents/skills                             # 应包含 speckit-script 等
```

Windows 原生安装（不在 WSL 里）时，如果 `specify.exe` 不在 PATH，先设置 `SPECIFY_BIN` 再运行安装器和 smoke tests；安装器与包装器都识别该变量。本模板的人工 gate 端到端用例与全量 smoke 已在 Spec Kit 1.0.10（WSL）与 1.2.2（Windows）各验证一遍。

Codex 里的完整流程命令见 `AGENTS.md`。注意：

- **先跑壳工作流**：`node workflow/tools/run-workflow.mjs courseware-shell -i shell=shells/<id> -i shell_slug=<id>`；壳批准后，内容工作流开头的 `check-shell-approval` 才会通过。
- 内容工作流必须显式传 `-i integration=codex` 和 `-i shell_slug=<id>`；
- 非交互运行必须用 `node workflow/tools/run-workflow.mjs courseware-production ...`，不要直接 `specify workflow run`；退出码 3 表示停在人工 gate。agent 把审核文件/链接发给老师，用原生提问 UI 拿到明确的 approve/reject 后运行 `node workflow/tools/gate-review.mjs decide <run-id> --step <step> --choice <choice> --by teacher`，再用 `node workflow/tools/run-workflow.mjs resume <run-id>` 继续；不要在老师回答前调用 `decide`，不要传 `-i`。
- 页级工具 fail closed：`build-screen` / `check-rendered-section` / `freeze-section` 只在 `courseware-production` run 内运行；`freeze-section` 还要求同一 run 最近的 `review-page` gate 已 `approve` 且消息包含本页 section id。调试/测试必须显式加 `--manual`（`build-screen` 也可 `--alpha`），不能把批量渲染当成正常流程。逐页 `review-page` 位于嵌套循环内，Spec Kit 恢复时会重跑父 body，因此工作流用 `check-pending-gui-gate.mjs` + `SPECKIT_WORKFLOW_RUN_ID` 跳过 gate 前的重建/自审，确保老师刚点的 verdict 不会因 `reviewedAt` 改写而失效。内置 gate 的终端后备路径仍是 `node workflow/tools/run-workflow.mjs resume <run-id>`；
- 工作流需要 `concepts=...`、`style_pack=...` 等输入；模板不提供具体课件数据。

## 更新模板

本机模板仓库在 `~/code/courseware-workflow-template`。上游 `workflow/` 更新后，重新生成模板：

```bash
rsync -a --delete \
  --exclude node_modules --exclude __pycache__ \
  --exclude chrome-path.txt --exclude .cache \
  /path/to/courseware/workflow/ ~/code/courseware-workflow-template/workflow/

# 同步模板级运行时、暂存组件和文档（不复制 browsercc）
rsync -a --exclude browsercc --exclude node_modules \
  /path/to/courseware/judge-runtime/ ~/code/courseware-workflow-template/judge-runtime/
mkdir -p ~/code/courseware-workflow-template/registry/staging
rsync -a \
  /path/to/courseware/registry/staging/code-judge/ \
  ~/code/courseware-workflow-template/registry/staging/code-judge/
cp /path/to/courseware/AGENTS.md /path/to/courseware/工作流说明.md ~/code/courseware-workflow-template/

cd ~/code/courseware-workflow-template
# 更新 VERSION 后再提交
git add -A
git commit -m "chore: sync workflow"
```

不要把 `workflow/tools/node_modules`、`workflow/tools/chrome-path.txt`、`judge-runtime/browsercc/`、`.specify/`、`research/`、`shells/`、`specs/`、`generated/`、`prototype/`、`screenshots/`、`review/` 或任何凭据提交进模板。

## 发布

远端仓库：`https://github.com/r4nd0m19/courseware-workflow-template`（私有，`main`）。

推送前先做一次素材/许可/隐私复核：preset 的 `license: private`、壳与参考素材授权、截图和个人信息。日常更新：

```bash
git push origin main
```

公开仓库前另做一次审查，并确认 GitHub secret scanning / push protection / Dependabot 已开启。没有用户明确授权，不要主动推送到任何外部服务。

## 安全

- 账号、密码、登录会话只存在 `tools/r0/credentials.local.json`（600）和 `/tmp`；不要读取、打印、提交。
- `research/raw/`、`research/r0/mirror/`、`research/r0/screenshots/` 含第三方内容、本机路径或个人信息，不得进入可分享产物。
- 参考课件里的姓名、头像、平台信息不得进入风格包、截图或课件。
- 生成的插画在授权问题解决前只在本地使用。
- 提交会经过全局 gitleaks 钩子；不要设置仓库级 `core.hooksPath` 覆盖全局机制。
