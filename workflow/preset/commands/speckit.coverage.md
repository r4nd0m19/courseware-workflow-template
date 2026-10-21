---
description: 运行内容覆盖闸门，检查 content pack 的 required 项是否被脚本与分镜覆盖。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 从参数或 feature 目录读取：
   - content pack JSON
   - courseware.md（人类可读唯一内容源）
   - storyboard.yml（由脚本投影）
   - 风格包 manifest / 组件注册表
   - 可选 waivers JSON
2. 运行脚本级覆盖与内容存在性检查：
   ```bash
   node workflow/tools/check-script.mjs courseware.md <content-pack> <style-pack-manifest> registry/index.json [--waivers waivers.json]
   ```
3. 运行分镜级覆盖：
   ```bash
   node workflow/tools/check-coverage.mjs <content-pack> storyboard.yml [waivers]
   ```
4. 核对脚本与分镜一致：
   ```bash
   node workflow/tools/script-to-storyboard.mjs courseware.md --check storyboard.yml
   ```
5. 报告：
   - required 项总数、已覆盖数、缺失项（ID/类型/标题）
   - 脚本中缺失的例题/代码输出/测验选项
   - waiver 列表与理由
   - 引用不存在 ID 的错误
6. 缺失即失败；不要自动删除 content pack 项或降低 `required` 来“通过”。
7. 输出：闸门结果、缺失项、建议补页/拆页位置。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `$COURSEWARE_REVIEW_DIR/self-review-coverage.json` 和 `.md`。
- 缺失项必须修好或取得书面 waiver；`verdict` 必须为 `pass`。
- 只有自审 pass 后才进入下面的 Human Review；不得通过删除内容或降低 required 来“通过”。

## Human Review（强制）

- 主动提出审核请求：required 覆盖数、缺失项、waiver 理由。
- 明确询问：`Approve coverage? (approve / reject / request changes)`。
- 未获 `approve` 不得进入下一阶段。
