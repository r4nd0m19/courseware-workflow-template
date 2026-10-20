# Harness 集成说明

一键安装（Claude Code 或 Codex）：

```bash
node workflow/install.mjs --integration claude
node workflow/install.mjs --integration codex
```

安装器会复制 `workflow/`、初始化 Spec Kit、安装 preset/workflow、安装工具依赖、检测 Chromium 并跑 smoke tests。

本工作流与 Spec Kit 一样，**不绑定具体 coding agent harness**。所有可执行内容分成两层：

1. **Spec Kit 层**：preset 模板/命令、workflow YAML。Spec Kit 根据项目的 integration 渲染成对应 harness 的命令/技能。
2. **Harness 无关层**：`workflow/tools/*.mjs`（Node）、schema、覆盖/词表/溢出闸门。Claude Code、Codex 或终端都可以直接运行。

## 映射

| 内容 | Claude Code | Codex |
|---|---|---|
| 命令/技能安装位置 | `.claude/skills/speckit-*` | `.agents/skills/speckit-*` |
| 调用方式 | `/speckit-specify`、`/speckit-plan`、`/speckit-coverage` | `$speckit-specify`、`$speckit-plan`、`$speckit-coverage` |
| 项目内集成清单 | `.specify/integrations/claude.manifest.json` | `.specify/integrations/codex.manifest.json` |
| workflow 命令解析 | `integration: "{{ inputs.integration }}"`（默认 `auto` → 项目默认） | 同左；运行 Codex 时传 `-i integration=codex` |
| 门禁脚本 | `node workflow/tools/*.mjs` | `node workflow/tools/*.mjs` |

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

运行完整 workflow 时显式选择 Codex（`integration` 输入默认 `auto` 会跟随项目默认）：

```bash
specify workflow run courseware-production \
  -i integration=codex \
  -i lesson=... -i content_pack=... -i courseware_script=... \
  -i concepts=... -i review_sections=... -i storyboard=... \
  -i style_pack=... -i style_pack_full=... -i lesson_slug=... \
  -i art_prompts=... -i art_dir=... -i deck_data=... \
  -i deck_url=http://127.0.0.1:8082/ -i page_count=... \
  </dev/null
```

`</dev/null` 不是可选项：stdin 不是 TTY 时 Codex 会等待额外输入，省略后
`specify workflow run` 看起来会卡住。

## 已验证

- `node workflow/install.mjs --project ... --integration claude` 与 `--integration codex` 均 exit 0（复制 workflow、Spec Kit init、preset/workflow 安装、npm ci、Chromium 检测、smoke tests）。
- `specify init --integration codex` + `preset add --dev` + `workflow add --dev`：成功；`.agents/skills/speckit-coverage/SKILL.md` 等 courseware 技能存在；当前 0.8.1 的 89 步 workflow 可安装。
- Claude + Codex 双集成：`integration install codex`、`use codex`、`use claude` 后，`.agents/skills` 与 `.claude/skills` 并存；默认集成可恢复为 claude。
- `prompt` 与 `command` 两种 workflow 步骤都能通过 `codex exec` 调度；command 步骤会发送 `$speckit-<name>`，由 Codex 从 `.agents/skills` 加载。
- 在非 git 目录运行 Codex 会失败；`git init` 后可正常执行。非交互 workflow 运行需关闭 stdin。
- 门禁脚本与 harness 无关，测试结果一致。
- 截图基线（pixelmatch）与 build-screen 也属于 harness 无关层；同一组截图在两个 integration 下结果一致。

## 注意

- 运行前提：项目根目录有 `workflow/`，Node 可用；`check-overflow` 需要 Playwright Chromium。
- 如果某个 harness 不注册新命令（例如不支持 preset 新增命令），`workflow` 的 `command` 步骤会失败；此时直接运行 `workflow/tools/*.mjs` 门禁，或在 preset 安装后检查命令是否出现。
- 不同 harness 的模型/上下文窗口不同，但工作流的阶段、产物和门禁不变。
- Codex 的 sandbox / approval 来自 `~/.codex/config.toml`；本项目不覆盖用户配置。若报告写入被拒绝，先检查该配置，而不是改 workflow。
