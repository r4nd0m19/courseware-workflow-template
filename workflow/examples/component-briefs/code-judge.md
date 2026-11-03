# 组件简报：code-judge

## 1. 复用检索

- 检索命令：`node workflow/tools/search-registry.mjs --query "代码 编译 判题 测试数据" --tags "code,compiler,judge,editor"`
- 命中组件与版本：`code-anatomy`（逐行代码解剖，只读）、`quiz-bank`（选择题与答案判定）。
- 现有组件为何不够：`code-anatomy` 只能读代码、不能编辑或运行；`quiz-bank` 只能选择答案，不能编译学生写的 C++，也不能用多组输入/输出验证程序。

## 2. 缺口与决定

- 缺口描述：需要“写 C++ → 浏览器内编译 → 逐组运行公开测试 → 显示实际输出与失败类别”的完整练习闭环。
- 决定：`new`。
- 与已有组件的关系：视觉上复用壳的纸面、描边和黄色强调；不改 `code-anatomy` / `quiz-bank`，避免影响已用课件。

## 3. 学习目标与成功标准

- 对应 objectiveId：由使用页面在脚本中指定；组件本身不绑定具体课时。
- 互动层级：construct、modify。
- 学生要完成的具体动作：在编辑器里补全或修改程序，点“运行测试”，逐组查看输入、期望输出和实际输出。
- 成功标准：全部可见测试通过；答案错误、运行错误、超时和输出超限都有明确的文字提示。
- 对应误区：输出格式（尾随空格、换行）、边界数据、忘记读入、死循环。

## 4. 交互状态机

| 状态 | 事件 | 下一状态 | 反馈 | 条件 |
|---|---|---|---|---|
| idle | run | compiling | 禁用运行/恢复按钮，提示正在准备编译器 | 任意 |
| compiling | compile-failed | compile-error | 打开编译器输出，测试项保持“待运行” | 编译器返回空模块 |
| compile-error | run | compiling | 重新编译当前代码 | 任意 |
| compiling | compiled | running | 逐组运行测试，测试项显示“运行中…” | 编译器返回 WebAssembly 模块 |
| running | all-tests-pass | passed | 汇总“全部通过”，每组显示实际输出 | 全部 AC |
| running | any-test-fails | failed | 汇总首个失败类别，逐组标出错误/超时/输出超限 | 任一非 AC |
| passed | run | compiling | 代码已修改时重新编译；未修改时复用模块直接重跑 | 任意 |
| failed | run | compiling | 代码已修改时重新编译；未修改时复用模块直接重跑 | 任意 |
| passed | reset | idle | 恢复初始代码并清空结果 | 任意 |
| failed | reset | idle | 恢复初始代码并清空结果 | 任意 |

- 初始状态：`idle`
- 完成状态：`passed`
- 重试/重置：运行结束后可直接再次运行；重置回到 `idle` 并恢复 `starterCode`。
- 不可用状态：`disabled`（只读演示）；`static`（无脚本降级）。
- 运行中切换页面：组件实例被销毁时终止编译/运行 Worker，不留下后台任务。

## 5. Props API

| Prop | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| statement | string | 是 | — | 题面纯文本，保留换行 |
| starterCode | string | 否 | `""` | 初始代码，重置时恢复到这里 |
| tests | `{id,label,input,expected}[]` | 是 | — | 1–6 组公开测试；input/expected 可为空串 |
| timeLimitMs | integer | 否 | 2000 | 每组墙钟上限，200–10000 |
| compileTimeoutMs | integer | 否 | 120000 | 编译总超时，10000–300000 |
| maxOutputBytes | integer | 否 | 65536 | stdout+stderr 总上限，4096–1048576 |
| runtimeBaseUrl | string | 否 | `judge-runtime/` | 站点内运行时目录；拒绝外部协议和 `//` |
| fallbackMode | `interactive` \| `static` | 否 | `interactive` | 静态降级 |
| disabled | boolean | 否 | false | 只读演示，隐藏运行控件 |
| ariaLabel | string | 否 | 题面摘要 | 组件区域的可见名称 |

`propsSchema` 设置 `additionalProperties: false`；未知 prop 是硬错误。

## 6. 视觉状态与布局约束

- 使用的风格包 tokens：`--surface`、`--ink`、`--muted`、`--line`、`--accent`、`--accent-strong`、`--paper`，并提供壳外使用的回退值。
- 视觉状态：default / hover / focus / compiling / passed / failed / compile-error / disabled / static。
- 布局：宽屏两栏（编辑器 + 测试结果），900px 以下上下堆叠；编辑器 238px 高，测试列表最多 300px 高并在内部滚动。
- 无页面级滚动条：组件高度受控，页面仍需按整屏排版检查；不放大小字号来硬塞。
- CodeMirror 不可用时保留原生 textarea；两种编辑器共享同一份文本和重置逻辑。

## 7. 无障碍

- 键盘：Tab 进入编辑器、运行、恢复；编辑器内 Ctrl/⌘+Enter 运行；编辑器 stopPropagation，避免触发课件翻页。
- 焦点：按钮与编辑器有 3px 焦点环；编辑器切换到 CodeMirror 时保留原焦点；运行结束不强制跳转。
- ARIA：根节点 `role=region` + `aria-label`；状态 `role=status`、`aria-live=polite`；运行中 `aria-busy=true`。
- 对比度：正文 7:1，状态标签 4.5:1；通过/失败同时有文字标签。
- 减少动画：`prefers-reduced-motion` 下取消过渡与按钮上移。

## 8. 静态降级

- 无 JS / 无判题运行时：渲染题面、初始代码、每组测试的输入与期望输出，不显示运行/重置按钮。
- 降级后仍必须覆盖：题目要求、数据范围与输出格式、全部公开测试。
- `fallbackMode: "static"` 可显式用于只读展示页。

## 9. 测试计划

- 核心测试：props 校验与默认值、输出归一化、AC/WA/RE/TLE/OLE 分类、汇总优先级、HTML 转义。
- 交互测试：用假 Worker 覆盖全部通过、答案错误、编译失败、重置、Ctrl+Enter、静态视图。
- 真实编译测试：Playwright + headless Chromium，加载 `judge-runtime/`，编译并逐组运行，断言 3 组 AC。
- 视觉基线：story 页 1100×560 两处；静态页人工检查。
- 运行时门禁：`check-component-package`、`run-component-checks`、`capture-component-baselines`。

## 10. 风险与非目标

- 行为错误风险：输出比较过严（尾随空格/换行）导致误判；用归一化规则并保留行首空格。
- 性能风险：第一次编译需加载约 91MB 的 Clang/LLD WASM 与 sysroot；编译超时默认 120s，编译结果按源码缓存。
- 安全风险：学生代码在 WASI Worker 中运行，每测试一个全新 Worker，主线程超时后 terminate；输出字节有上限。
- 数据风险：测试数据对学生可见，不能防作弊或隐藏测试。
- 非目标：服务端评测、账号提交记录、隐藏测试、防篡改、Python/Java 等其它语言。
- 回滚策略：若审核未通过，删除 staging 包，页面退回 `code-anatomy` + 静态题面。

## 11. 审核

- 简报审核人：pending-page-review
- 审核日期：2026-11-03
- 结论：pending
