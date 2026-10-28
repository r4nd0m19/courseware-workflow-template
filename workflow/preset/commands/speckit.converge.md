---
description: Beta 收敛：把试课/课堂反馈变成有证据、有归属的只读收敛报告（手动回退入口）。
---

## User Input

```text
$ARGUMENTS
```

> 生产工作流的 `converge` 步骤已经改为 shell 步骤，直接运行
> `workflow/tools/generate-converge-report.mjs`；本命令只保留为手动回退入口。
> 多课件项目：`review/` 路径用 `$COURSEWARE_REVIEW_DIR/...`，`--approvals` 用
> `$COURSEWARE_PAGE_APPROVALS`。workflow 会设置这些变量，并通过 `$ARGUMENTS`
> 传 `--lesson-slug <slug>`。

## 结构化收敛

1. 确认 Alpha 已通过，且以下文件存在：
   - `$COURSEWARE_REVIEW_DIR/self-review-alpha.json`
   - `$COURSEWARE_PAGE_APPROVALS`
   - 逐页截图目录
   - 可选的 `$COURSEWARE_REVIEW_DIR/trial-feedback.md`（老师/试课反馈原文）
2. 运行结构化收敛工具，不要自己读仓库后手写报告：

   ```bash
   node workflow/tools/generate-converge-report.mjs \
     --lesson-slug <lesson-slug> \
     --lesson "<lesson title>" \
     --script <courseware.md> \
     --sections <review-sections.yml> \
     --approvals "$COURSEWARE_PAGE_APPROVALS" \
     --alpha "$COURSEWARE_REVIEW_DIR/self-review-alpha.json" \
     --screenshots <screenshots-dir> \
     --review-dir "$COURSEWARE_REVIEW_DIR" \
     --trial-feedback "$COURSEWARE_REVIEW_DIR/trial-feedback.md"
   ```

   工具会把 Alpha 证据、试用反馈和截图清单交给一次无工具模型调用，模型只返回
   `findings`/`verdict`/`followUps` JSON；Node 校验后确定性渲染
   `$COURSEWARE_REVIEW_DIR/converge-report.md`。
3. 工具**不修改**已批准的 `courseware.md`、`deck.json`、组件或审核账本：
   任何修改都会使脚本/截图批准哈希失效。报告里的 blocker 由随后的
   `build-self-review-beta.mjs` 判定为失败，必须走正常的重开页流程。
4. 不要把 blocker 改写成已修复、关闭或豁免，除非老师明确给出豁免理由并在
   `trial-feedback.md` 中记录。
5. 不做：不修改审核结论，不跳过逐页审核，不手写 verdict 或批准账本。

## 输出

- `$COURSEWARE_REVIEW_DIR/converge-report.md`
- `$COURSEWARE_REVIEW_DIR/converge-generation.json`（模型原始判断）
- `$COURSEWARE_REVIEW_DIR/converge-generation-report.json`（尝试次数与摘要）

## 说明

工作流随后运行 `self-review-beta` / `check-self-review-beta`（确定性汇总），
不再有人工 beta gate。`ready` 只表示没有未关闭的 blocker；major/minor 仍会在
报告的后续动作里保留。
