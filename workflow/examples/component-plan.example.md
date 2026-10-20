# 组件计划：demo-component-lesson

## 1. 复用检索

| 需求（来自哪屏 / 哪个学习动作） | 检索词 / tags / level | 命中组件 | 是否满足 | 不满足的原因 |
|---|---|---|---|---|
| S01 点击矩阵边缘格子并累计求和 | matrix, edge, sum, modify | matrix-lab@1.0.0 | 否 | 只能高亮单元格；没有逐格累计、提交与错误反馈 |

检索命令：

```bash
node workflow/tools/search-registry.mjs --registry examples/registry/index.json \
  --query "matrix edge sum" --tags "matrix,edge" --level modify
```

## 2. 缺口

| ID | 学习动作 | 互动层级 | 现有组件为何不够 | 决定 | 简报 |
|---|---|---|---|---|---|
| edge-sum-lab | 点击边缘格子并累计求和 | modify | matrix-lab 只高亮，没有求和状态、提交与漏选反馈 | new | component-briefs/edge-sum-lab.md |

## 3. 复用映射

| Slide | 需要的学习动作 | 组件 | 来源 |
|---|---|---|---|
| S01 | 点击边缘格子并累计求和 | edge-sum-lab | new（审核后入 core） |

## 4. 风险与非目标

- 行为风险：漏选/多选的判定必须与状态机一致，避免把角上格子重复计数。
- 视觉风险：矩阵在 1366×768 下也必须单屏显示，不出现滚动条。
- 非目标：本组件不做矩阵转置、旋转等扩展操作。
