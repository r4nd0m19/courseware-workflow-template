# 第三方组件与许可

本目录的判题运行时包含以下第三方组件。发布或分发课件站点时，请一并保留本文件和对应许可原文。

## browsercc 0.1.1

- 用途：在浏览器里把 C++ 编译为 WebAssembly（Clang + LLD）。
- 来源：<https://registry.npmjs.org/browsercc/-/browsercc-0.1.1.tgz>
- 许可：MIT（原文见 `licenses/browsercc-MIT.txt`；安装后 `browsercc/LICENSE` 也保留同一文本）。
- 分发方式：不提交进仓库，由 `install.mjs` 下载并校验；站点构建时按需复制。
- 包含的编译器组件：Clang/LLVM、LLD、libc++/libc 的 WASI sysroot。它们各自的许可声明随上游 browsercc 包提供；如需对外分发，请同时核对 LLVM 的 Apache-2.0 WITH LLVM-exception 与相关运行时库许可。

## @bjorn3/browser_wasi_shim 0.4.2

- 用途：浏览器内的 WASI 预览 1 实现（stdin/stdout、虚拟文件系统、退出码）。
- 来源：<https://www.npmjs.com/package/@bjorn3/browser_wasi_shim>
- 许可：MIT OR Apache-2.0（原文见 `wasi-shim/LICENSE-MIT`、`wasi-shim/LICENSE-APACHE`）。
- 分发方式：源码 `dist/*.js` 已复制到 `wasi-shim/`，随仓库提交。

## CodeMirror 6

- 用途：C++ 代码编辑器（`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`、`@codemirror/language`、`@codemirror/lang-cpp`、`@codemirror/theme-one-dark` 等）。
- 来源：<https://codemirror.net/>
- 许可：MIT，版权归 Marijn Haverbeke 及贡献者（原文见 `licenses/codemirror-MIT.txt`）。
- 分发方式：用 esbuild 打包为 `codemirror.bundle.js`，随仓库提交。

### CodeMirror 的传递依赖

打包产物同时包含以下 MIT 许可的库，许可归属其各自作者：

- `@lezer/common`、`@lezer/highlight`、`@lezer/lr`、`@lezer/cpp` — <https://lezer.codemirror.net/>
- `crelt` — <https://github.com/marijnh/crelt>
- `style-mod` — <https://github.com/marijnh/style-mod>
- `w3c-keyname` — <https://github.com/marijnh/w3c-keyname>

它们的 MIT 许可归属其各自作者；完整 MIT 文本见 `licenses/codemirror-MIT.txt`。
