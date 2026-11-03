# 纯浏览器判题运行时

`code-judge` 组件在课件页面里编译并运行学生写的 C++。编译和执行都发生在学生自己的浏览器里：没有服务器提交，没有账号，也不需要联网（安装完成后）。

## 组成

| 路径 | 作用 |
|---|---|
| `browsercc/` | browsercc 0.1.1：Clang/LLD 的 WASM 构建和 sysroot。**不提交进仓库**，由安装脚本下载。 |
| `wasi-shim/` | `@bjorn3/browser_wasi_shim` 0.4.2，提供 WASI 文件描述符和 stdin/stdout。 |
| `codemirror.bundle.js` | CodeMirror 6 的浏览器 bundle（C++ 高亮、Tab、Ctrl/⌘+Enter）。 |
| `compile-worker.js` | 模块 Worker：调用 `browsercc.compile()`，把编译好的 `WebAssembly.Module` 发回主线程。 |
| `run-worker.js` | 每组测试一个全新的模块 Worker：用 WASI 运行程序、喂 stdin、收集 stdout/stderr、限制输出字节。 |
| `install.mjs` | 下载并校验 browsercc；幂等，可重复运行。 |

## 安装

```bash
node judge-runtime/install.mjs
```

脚本从 npm 下载 `browsercc@0.1.1` 的 tarball，校验整个 tarball 和每个文件的 SHA-256，只复制运行时需要的文件。约 91MB（不含未使用的 `stdc++.h.pch`）。

常用参数：

```bash
node judge-runtime/install.mjs --check          # 只检查，不下载
node judge-runtime/install.mjs --force          # 重新安装
node judge-runtime/install.mjs --from <dir>     # 从已解压的 browsercc 包复制（离线）
```

`--from` 可以指向 npm 包解压目录，也可以指向它的上级目录；安装器会自动找 `dist/`。设置 `COURSEWARE_JUDGE_RUNTIME_FROM` 与 `--from` 等价。

安装器在 `browsercc/INSTALL.json` 记录版本、tarball 哈希和每个文件的哈希。`browsercc/` 已加入 `.gitignore`；不要把它提交到公开仓库。

## 站点集成

`workflow/tools/build-shell-site.mjs` 会读取 deck：

- 没有 `code-judge` 页：不复制运行时。
- 有 `code-judge` 页：按页面的 `props.runtimeBaseUrl`（默认 `judge-runtime/`）把整个运行时复制进站点，使用硬链接，失败时回退为普通复制。
- 运行时缺失或被截断：构建直接失败，并提示运行 `node judge-runtime/install.mjs`。

`runtimeBaseUrl` 必须是站点内的普通相对目录；外部 URL、`//`、绝对路径和包含 `..` 的路径都会被拒绝。组件在浏览器里也会再校验一次。

`workflow/tools/shell-lib.mjs` 的预览服务器已为 `.wasm` 和 `.tar` 返回正确的 MIME 类型（`application/wasm`、`application/x-tar`）。其它静态服务器也必须这样配置，否则 Clang/LLD 无法流式编译 WASM。

## 运行模型与边界

- 编译总超时默认 120 秒（第一次要加载 Clang、LLD 和 sysroot，通常数秒）；每组测试默认 2 秒墙钟上限。
- 编译成功后，`WebAssembly.Module` 通过结构化克隆发给主线程；改代码前重复运行会复用模块，不重复编译。
- 每组测试在独立 Worker 中运行，主线程超时后 `terminate()`，不会把死循环留在页面上。
- 单次运行的 stdout + stderr 默认上限 64KB；超出报“输出超限”。
- 输出比较忽略 CRLF/LF、行尾空格和末尾空行，保留行首空格。
- 测试数据写在 deck 的 props 里，学生可以看到、也可以改浏览器内存。它适合课堂练习和即时反馈，**不是正式 OJ**：不能隐藏测试、不能防作弊、不保存提交记录。
- 学生代码只能通过 WASI 访问 Worker 内的虚拟文件描述符；不提供网络、`child_process`、`require`、`eval` 或浏览器存储桥。

## 测试

```bash
node workflow/tools/run-component-checks.mjs --package registry/staging/code-judge --project-root .
node workflow/tools/test-code-judge.mjs
```

`run-component-checks` 包含核心测试、假 Worker 交互测试和真实编译测试。真实编译测试需要先安装 `browsercc/`，在 sandbox 中会自动跳过。`test-code-judge` 覆盖站点集成：准备壳站点、打包组件、复制运行时、在 headless Chromium 里实际编译并跑完全部测试。

## 第三方许可

见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `licenses/`、`wasi-shim/LICENSE-*`、`browsercc/LICENSE`。
