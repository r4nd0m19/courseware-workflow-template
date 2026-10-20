# Harness 集成说明

一键安装（Claude Code、Codex 或 ZCode）：

```bash
node workflow/install.mjs --integration claude
node workflow/install.mjs --integration codex
node workflow/install.mjs --integration zcode
```

安装器会复制 `workflow/`、初始化 Spec Kit、安装 preset/workflow、安装工具依赖、检测 Chromium 并跑 smoke tests。

本工作流与 Spec Kit 一样，**不绑定具体 coding agent harness**。所有可执行内容分成两层：

1. **Spec Kit 层**：preset 模板/命令、workflow YAML。Spec Kit 根据项目的 integration 渲染成对应 harness 的命令/技能。
2. **Harness 无关层**：`workflow/tools/*.mjs`（Node）、schema、覆盖/词表/溢出闸门。Claude Code、Codex 或终端都可以直接运行。

## 映射

| 内容 | Claude Code | Codex | ZCode |
|---|---|---|---|
| 命令/技能安装位置 | `.claude/skills/speckit-*` | `.agents/skills/speckit-*` | `.zcode/skills/speckit-*` |
| 调用方式 | `/speckit-specify`、`/speckit-plan`、`/speckit-coverage` | `$speckit-specify`、`$speckit-plan`、`$speckit-coverage` | `$speckit-*` 或 `/skill <name>` |
| 项目内集成清单 | `.specify/integrations/claude.manifest.json` | `.specify/integrations/codex.manifest.json` | `.specify/integrations/zcode.manifest.json` |
| workflow 命令解析 | `integration: "{{ inputs.integration }}"`（默认 `auto` → 项目默认） | 同左；运行 Codex 时传 `-i integration=codex` | 同左；运行 ZCode 时传 `-i integration=zcode` |
| AI 步骤执行 CLI | `claude -p` | `codex exec` | `zcode -p` |
| 门禁脚本 | `node workflow/tools/*.mjs` | `node workflow/tools/*.mjs` | `node workflow/tools/*.mjs` |

## 不依赖的东西

- 不依赖 `.claude/settings.json`、Stop hook、Claude Code 专有 skill 格式。
- 不依赖 Codex 专有 prompt 格式；preset 命令是普通 Markdown，由 Spec Kit 渲染。
- 门禁失败通过进程退出码表达，任何能运行 shell 的 harness 都可接。

## 在已有项目启用 Codex（Claude 保留）

```bash
# 1. 安装 Codex 集成（multi-install safe；不会删掉 Claude）
specify integration install codex --script sh

# 2. 让 preset 把 courseware 技能渲染到 .agents/skills
#    use 只改默认集成；切回后 Codex 技能仍然保留
specify integration use codex
specify integration use claude

# 3. 确认
ls .agents/skills/speckit-script/SKILL.md
specify integration status
```

Codex 需要可信目录：`codex exec` 在非 git 目录会直接报
`Not inside a trusted directory and --skip-git-repo-check was not specified`。
本项目采用 `git init` + `.gitignore`（不自动提交）；如果不想建仓库，也可以让
`SPECKIT_INTEGRATION_CODEX_EXECUTABLE` 指向一个注入
`--skip-git-repo-check` 的包装脚本，但这是额外适配层，不作为默认路径。

运行完整 workflow 时显式选择 Codex（`integration` 输入默认 `auto` 会跟随项目默认）。非交互运行必须经 `run-workflow.mjs`：

```bash
node workflow/tools/run-workflow.mjs courseware-production \
  -i integration=codex \
  -i lesson=... -i content_pack=... -i courseware_script=... \
  -i concepts=... -i review_sections=... -i storyboard=... \
  -i style_pack=... -i style_pack_full=... -i lesson_slug=... \
  -i art_prompts=... -i art_dir=... -i deck_data=... \
  -i deck_url=http://127.0.0.1:8082/ -i page_count=...
```

包装器已忽略 stdin，不需要再写 `</dev/null`。它在 gate 处返回 **exit 3**（Spec Kit 原生返回 `paused` + exit 0），并打印 `specify workflow resume <run_id>`。agent 看到 exit 3 必须停止；老师在自己的终端用 `node workflow/tools/run-workflow.mjs resume <run_id>` 交互式回答 gate。

## 在 ZCode 中启用

```bash
# 新项目
node workflow/install.mjs --project /path/to/project --integration zcode

# 已有 Spec Kit 项目
cd /path/to/project
specify integration install zcode
specify integration use zcode
```

ZCode 的技能在 `.zcode/skills`；workflow 的 `prompt` / `command` 步骤由 `zcode -p` 执行。运行 workflow 时传 `-i integration=zcode`。`zcode` CLI 必须在 PATH 上（Windows 常见位置：`C:\Users\<you>\.local\bin\zcode.cmd`）。

## 新项目：Codex GUI 一键安装（模板仓库）

Codex 图形界面里新建项目后，不需要手工跑一串命令：把模板仓库里的
`bootstrap-codex-courseware.sh` 放到项目根目录，让 Codex 执行即可。

1. 在 Codex 图形界面新建/打开空项目目录（`Ctrl+O` / `⌘O`）。
2. 复制 `bootstrap-codex-courseware.sh` 到项目根目录。
3. 在 Codex 对话框输入：

   ```text
   请在当前项目根目录执行：
   bash bootstrap-codex-courseware.sh
   安装完成后运行 specify workflow info courseware-production，并把结果报告给我。
   ```

4. 允许 Codex 执行命令/信任目录。脚本会 `git init`（Codex 需要可信 git 目录），写入
   `.gitignore` / `AGENTS.md`（已存在则保留），安装 Spec Kit、preset、workflow、Node
   依赖和 Chromium，最后跑 smoke test 与 `specify workflow info`。
5. 重启 Codex 或 **Force Reload Skills**，确认 `.agents/skills/speckit-script/SKILL.md`
   可见；之后用 `$speckit-*` 调用。

本机模板仓库：`~/code/courseware-workflow-template`（默认 `--repo`，可用
`COURSEWARE_TEMPLATE_REPO` 或 `--repo <url>` 覆盖）。模板只含工作流，不含具体课件的
壳、注册表、研究资料和插画；新项目要把自己的 `shells/<shell>/` 放好后再跑完整流程。
模板当前是本地私有仓库，未推送到外部；发布前需确认 preset 许可、壳/参考素材授权和
截图脱敏。

## 已验证

- `node workflow/install.mjs --project ... --integration claude` 与 `--integration codex` 均 exit 0（复制 workflow、Spec Kit init、preset/workflow 安装、npm ci、Chromium 检测、smoke tests）。
- `specify init --integration codex` + `preset add --dev` + `workflow add --dev`：成功；`.agents/skills/speckit-coverage/SKILL.md` 等 courseware 技能存在；当前 0.14.1 的 91 步 workflow 可安装，13 个 `gui-gate` 由 `.specify/workflows/steps/gui-gate/` 加载。
- 人工审核：13 个 gate 在非 TTY 运行时写哈希绑定的 pending 请求并退出 3。agent 把审核文件/链接发给老师，用 harness 的原生提问 UI（ZCode/Claude Code 的 `AskUserQuestion`；Codex 用其原生 user-input / approval 提示）拿到明确的 approve/reject，再用 `node workflow/tools/gate-review.mjs decide` 记录，最后用 `node workflow/tools/run-workflow.mjs resume <runId>` 继续。完整端到端见 `tools/test-gui-gate.mjs`；旧版 `install.mjs --zcode` 会移除遗留的 `courseware-approval` MCP server 条目。
- Claude + Codex 双集成：`integration install codex`、`use codex`、`use claude` 后，`.agents/skills` 与 `.claude/skills` 并存；默认集成可恢复为 claude。
- `prompt` 与 `command` 两种 workflow 步骤都能通过 `codex exec` 调度；command 步骤会发送 `$speckit-<name>`，由 Codex 从 `.agents/skills` 加载。
- 在非 git 目录运行 Codex 会失败；`git init` 后可正常执行。非交互 workflow 运行经 `run-workflow.mjs`，gate 的 `paused` 映射为 exit 3；直接 `specify workflow run` 仍是 exit 0。
- 门禁脚本与 harness 无关，测试结果一致。
- 截图基线（pixelmatch）与 build-screen 也属于 harness 无关层；同一组截图在两个 integration 下结果一致。
- 模板仓库 bootstrap 在全新空目录（`/tmp/codex-courseware-test`）实测：克隆模板、`git init`、`specify init --integration codex`、preset/workflow 安装、`npm ci`、Chromium 检测、smoke 69/69（1 项 shell 检查因项目无壳而跳过）全部通过；`codex exec` 读取 `AGENTS.md` 后返回 `0.8.1，89 步`。

## 注意

- 运行前提：项目根目录有 `workflow/`，Node 可用；`check-overflow` 需要 Playwright Chromium。
- 如果某个 harness 不注册新命令（例如不支持 preset 新增命令），`workflow` 的 `command` 步骤会失败；此时直接运行 `workflow/tools/*.mjs` 门禁，或在 preset 安装后检查命令是否出现。
- 不同 harness 的模型/上下文窗口不同，但工作流的阶段、产物和门禁不变。
- Codex 的 sandbox / approval 来自 `~/.codex/config.toml`；本项目不覆盖用户配置。若报告写入被拒绝，先检查该配置，而不是改 workflow。
