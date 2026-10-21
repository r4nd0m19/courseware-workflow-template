---
description: 从参考课件 URL/本地 HTML 抽取内容包草稿，供人工/模型复核为最终 content-pack.json。
---

## User Input

```text
$ARGUMENTS
```

> 如果老师手里只有教案、讲义、网页、Word、PDF 或 Markdown，**不要问老师要 `content-pack.json`**。请老师把源文件放进项目或给出路径；本命令负责整理成内容包草稿，再和老师逐项确认。

## Outline

1. 确认参考来源：
   - 公开 URL 或本地 HTML/目录；
   - 需要登录时，准备 Playwright `storage-state.json`，不要在本命令里处理账号密码。
2. 运行通用爬取器：
   ```bash
   node workflow/tools/crawl-reference.mjs <url-or-file> \
     --out reference-crawl --pages auto \
     [--next-selector "<css>"] [--storage-state <path>]
   ```
   它会保存每页 text/HTML/code/options/截图。
3. 运行草稿抽取：
   ```bash
   node workflow/tools/extract-content.mjs reference-crawl \
     --out content/lesson.content.json \
     --lesson-id <id> --lesson-title "<title>" --audience "<audience>"
   ```
4. 复核并修正草稿（**必须**）：
   - 封面/目录/章节页不要误判为 example；按知识点/结构重新分类。
   - 从 `pages/*.html` 或页面 JS 中补全 quiz 的正确答案与反馈；未检测到的必须人工确认，不能默认。
   - 补充 narration、steps、structure；参考内容默认 `required: true`，不可删除。
   - 标记 `sensitivity: personal` 的页面：脱敏或排除，不进入生成课件或可分享产物。
   - 将确认过的项改成 `reviewStatus: "reviewed"`。
5. 校验：
   ```bash
   node workflow/tools/validate-json.mjs workflow/schemas/content-pack.schema.json content/lesson.content.json
   ```
6. 输出：items 数量/类型分布、未解决答案、敏感页、覆盖闸门是否可进入下一步。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `$COURSEWARE_REVIEW_DIR/self-review-inputs.json` 和 `.md`。
- 检查所有 item 已复核、quiz 答案/反馈完整、无个人信息、无删减；`verdict` 必须为 `pass`。
- 有 blocking issue 时先修复并重跑；不得自行把 draft 标成 reviewed。
- 只有自审 pass 后才进入下面的 Human Review。

## Human Review（强制）

- 主动提出审核请求：items 类型分布、未解决答案、敏感页、仍需人工判断的项。
- 明确询问：`Approve content pack? (approve / reject / request changes)`。
- 未获 `approve` 不得进入 brief；不得自行把 `reviewStatus` 改成 `reviewed`。
