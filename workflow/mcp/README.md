# GUI 审核闸门（MCP App）

工作流里的 13 个人工 gate 都是 `gui-gate`。在 ZCode 里跑工作流时，gate 不再要求老师打开终端：agent 调用 `courseware_gate_open`，ZCode 在对话里内联渲染审核面板；老师点击后，面板把 verdict 写回项目，MCP 服务器自动恢复（resume）Spec Kit run。

## 组成

| 路径 | 作用 |
| --- | --- |
| `workflow/steps/gui-gate/` | Spec Kit 自定义 step（`step.yml` + `__init__.py`）。非 TTY 时写 pending 请求并返回 `PAUSED`；TTY 时退化为终端提问。 |
| `workflow/mcp/approval-server.mjs` | 零依赖 MCP stdio server。提供 `courseware_gate_open`，读取 run 状态/pending 请求，校验并写入 verdict，自动 resume。 |
| `workflow/mcp/panel.template.html` | 面板源码（中文 UI、明暗主题、证据哈希、逐页轮询）。 |
| `workflow/mcp/build-panel.mjs` | 把 `@modelcontextprotocol/ext-apps` 浏览器运行时内联进模板，生成 `panel.html`。 |
| `review/gui-gates/` | 运行时状态：`pending/`、`verdicts/`、`resume/`、`server.log`、`panel-token.txt`。**不要提交。** |

`panel.html` 是构建产物（约 420 KB），已加入 `.gitignore`；安装器在 `npm ci` 后自动构建。

## 一次 gate 的流程

1. `run-workflow.mjs` 以非 TTY 运行 `specify workflow run`。`gui-gate` 收集证据（`show_file`、`artifacts`、同目录 self-review JSON 及其 `reviewedArtifacts` 哈希），计算 `digest`，写 `review/gui-gates/pending/<gateKey>.json`，返回 `PAUSED`。
2. 包装器把 `paused` 映射为退出码 3，并打印 `courseware_gate_open` 调用方式；agent 停止。
3. agent 调用 `courseware_gate_open {"runId":"..."}`。ZCode 按工具的 `_meta.ui` 加载 `ui://courseware-approval/gate.html` 并内联显示。
4. 面板每 1.5 秒调用 app-only 的 `courseware_gate_next` 刷新状态。按钮只在 pending 且 run 仍停在该 gate 时可用。
5. 老师点击 `approve` / `reject`。面板调用 app-only 的 `courseware_gate_verdict`，带上 `choice`、`nonce`、`gateKey`、`runId` 与 resource 内注入的 `panelToken`。
6. 服务器校验 token、pending、nonce、digest、run/step 状态，写 `verdicts/<gateKey>.json`，把 pending 标记为 `decided`，然后以 detached 子进程运行 `node workflow/tools/run-workflow.mjs resume <runId>`。
7. `gui-gate` 重新执行，读到一次性 verdict，标记 `consumed`，返回 `COMPLETED` 与 choice；工作流继续到下一个 gate。

逐页循环里的 `review-page` 使用同一套机制；gateKey 由当前页的证据哈希决定，因此改页后旧 verdict 自动失效。

## 安装与配置

```bash
node workflow/install.mjs --integration codex --zcode
```

安装器会：

- 把 `workflow/steps/gui-gate/` 复制到 `.specify/workflows/steps/gui-gate/`（Spec Kit 只从这里加载自定义 step，且拒绝符号链接）；
- 在 `workflow/tools` 运行 `npm ci` 后执行 `node workflow/mcp/build-panel.mjs`；
- 合并（不是覆盖）`.zcode/config.json`：

```json
{
  "mcp": {
    "servers": {
      "courseware-approval": {
        "command": "/usr/bin/node",
        "args": ["/path/to/project/workflow/mcp/approval-server.mjs"],
        "env": {
          "COURSEWARE_PROJECT_ROOT": "/path/to/project",
          "SPECIFY_BIN": "/home/me/.local/bin/specify"
        },
        "protocolVersion": "legacy"
      }
    }
  }
}
```

- Windows 下 `command` 是安装器所用的 `node.exe`，路径按 Windows 写法；
- 已有 `.zcode/` 时自动配置；没有时加 `--zcode` 创建；`--no-zcode` 跳过；
- 没有 `.zcode/` 且未加 `--zcode` 时不写配置，GUI gate 仍会暂停，但需要手工配置 server。

配置变更后需要重载 ZCode 窗口（或重启其 MCP servers）。

安装器可重复运行：`workflow/` 已存在时保留原目录，preset 已安装时改用 `specify preset update`，workflow 用 `workflow add --dev` 覆盖，`.zcode/config.json` 只合并 `courseware-approval` 条目、保留其他 server。Windows 上 `specify` 不在 PATH 时，先用 `SPECIFY_BIN` 指向 `specify.exe`（安装器、smoke tests 与 MCP server 都识别这个变量）。

## 工具

| 工具 | 可见性 | 用途 |
| --- | --- | --- |
| `courseware_gate_open` | 模型 + 面板 | 按 `runId`（或最近的 pending）打开面板；返回公开 gate 数据，**不含 token**。 |
| `courseware_gate_next` | 仅面板 | 轮询 pending/decided 或 run 状态；发现已决定的 gate 时触发补偿性 resume。 |
| `courseware_gate_verdict` | 仅面板 | 写入 verdict；要求 token、nonce、gateKey、runId 与合法 choice。 |

模型侧只应调用 `courseware_gate_open`。`courseware_gate_verdict` 在面板 resource 之外没有 token，工具结果与日志也不会输出 token。

## 信任边界

- verdict 与 `runId` / `stepId` / `gateKey` / `digest` / `nonce` 绑定，一次性消费；重复 resume 不会重放。
- 嵌套的逐页 gate 有额外的 resume guard。Spec Kit 在嵌套步骤暂停后重跑父 body（引擎源码注明精确嵌套 resume 尚未实现），页 body 会重写 AI 自审的 `reviewedAt`，从而改变 digest、使刚点的 verdict 失效。`workflow/tools/check-pending-gui-gate.mjs` 用 `SPECKIT_WORKFLOW_RUN_ID` 认出同一 run 的 pending/decided gate，页循环跳过重建与自审后再进入 gate；只影响“是否重复做 gate 前的工作”，不改变 verdict 的哈希/一次性校验。
- `show_file`、显式 `artifacts`、sibling self-review 的每个 `reviewedArtifacts` 都校验哈希。self-review 过期时 gate 直接失败（fail closed），不会让人“顺手批准旧证据”。
- `gui-gate` 拒绝 `verdict_input`。工作流不使用 `-i` 预填 gate 答案；一次 `-i approve` 会持久化并可能自动回答循环里的后续页，这是必须堵住的旁路。
- 本地文件无法密码学地证明“某个真人按了键”：能读项目文件的人也能读 `panel-token.txt`。这里保证的是正常 agent 工具面没有 verdict 入口、暂停的 gate 不能被当成批准、verdict 不能跨 run/nonce/证据复用。真正的边界是老师在自己面前的 ZCode 面板点击，agent 不代答、不伪造。
- 不要手工写 `review/gui-gates/verdicts/*.json`、改 pending 或 run state；这些是运行时状态，不是审批账本。

## 调试与测试

```bash
# 构建面板（改了 template 之后）
node workflow/mcp/build-panel.mjs

# 单元/端到端：暂停 → pending → MCP open/verdict → 自动 resume → completed
node workflow/tools/test-gui-gate.mjs

# 嵌套 gate resume：gate 前证据反复改写时，guard 仍保留原 verdict
node workflow/tools/test-gui-gate-resume.mjs

# 全量门禁（包含上面的端到端）
node workflow/tools/smoke-test.mjs
```

- `review/gui-gates/server.log`：MCP server 的工具调用与 resume 决策；
- `review/gui-gates/resume/<runId>.log`：自动 resume 的完整 stdout/stderr；
- `COURSEWARE_GATE_NO_RESUME=1`：只记录 verdict、不自动 resume（测试/排查用）；
- `COURSEWARE_GATE_STATE_DIR=<dir>`：覆盖状态目录（测试隔离用）；
- `COURSEWARE_PROJECT_ROOT=<dir>`：服务器找不到项目根时显式指定；
- `SPECIFY_BIN=<path>`：`specify` 不在 PATH 时（例如 Windows PyInstaller 安装）显式指定；
- `COURSEWARE_GATE_NONINTERACTIVE=1`：内部标记，包装器在非 TTY 运行时设置，`gui-gate` 据此跳过终端提问。Windows 把被忽略的 stdin 映射到 NUL，Python 的 `isatty()` 在 NUL 上仍可能返回 True，所以不能只靠 `isatty()` 判断。交互式运行时包装器会清空该标记。

## 限制与兼容

- Spec Kit 1.0.10（WSL）与 1.2.2（Windows 测试项目）都通过自定义 step 加载；`approve-script.mjs` 只检查 gate 步骤的 status/choice/run id，因此 `gui-gate` 与既有审批账本兼容。
- 面板依赖 ZCode 的 MCP Apps 支持（`text/html;profile=mcp-app`、`_meta.ui`、ext-apps RPC）。其他 MCP 客户端可以调用 `courseware_gate_open`，但不一定能内联渲染；此时仍可用交互式终端后备路径回答。
- Spec Kit 目前没有精确的嵌套 resume（引擎把嵌套步骤记为 `step_offset=-1`，恢复时重跑父 body）。工作流的页循环用 resume guard 规避；直接用 `specify workflow resume`（不经过 `run-workflow.mjs`）时 shell 步骤拿不到 `SPECKIT_WORKFLOW_RUN_ID`，guard 会保守地返回 `resume=false`，即回到旧的“重跑页 body”行为。GUI 自动 resume 与文档给出的终端 resume 都经过包装器，因此不受影响。
- 面板的按钮事件只存在于 MCP App 运行时；agent 无法从工具结果里拿到 token。
