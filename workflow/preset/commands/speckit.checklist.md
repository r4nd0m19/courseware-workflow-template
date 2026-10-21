---
description: 生成教学评审清单，并运行脚本、组件、覆盖率与页面硬门禁。
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 读取 `spec.md`、`courseware.md`、`component-plan.md`、`plan.md`、`storyboard.yml`、内容包、注册表和 `.specify/templates/checklist-template.md`。
2. 生成 checklist，覆盖：
   - 课件脚本完整性（屏幕内容/交互/旁白/转场/制作字段；无占位符）
   - 组件复用与生成（检索记录、简报、状态机测试、无障碍、降级、注册状态）
   - 内容覆盖（required 项、知识点/例题/测验/讲解/代码/步骤/旁白）
   - §6 页面级硬项（P2–P6、P10）
   - §6 互动级硬项（I1–I6、I9）
   - 技术门禁（脚本、投影一致性、schema、词表+注册表、覆盖、教学、无滚动条、截图）
3. 对程序可判项运行对应工具，把结果填进 checklist；人工项留给老师勾选。
4. 任何硬项失败必须显式标红；豁免需写理由/批准人/日期。
5. 输出 checklist 路径、自动项结果、待人工项、阻断项。

## Self-review（强制，人工审核前）

- 按 `specify preset resolve self-review-template` 解析到的模板 写 `$COURSEWARE_REVIEW_DIR/self-review-checklist.json` 和 `.md`。
- 汇总自动检查结果；有 blocking issue 时先修复并重跑；`verdict` 必须为 `pass`。
- 只有自审 pass 后才进入下面的 Human Review。

## Human Review（强制）

- 按 `specify preset resolve review-template` 解析到的模板 写 `review.md`，产物为 checklist + 自动检查结果。
- 主动提出审核请求：硬项通过/失败、组件注册与复用、待人工勾选项、豁免申请。
- 明确询问：`Approve checklist? (approve / reject / request changes)`。
- 未获 `approve` 不得进入下一阶段。
