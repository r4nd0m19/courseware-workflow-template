---
lesson: "demo-component-lesson"
title: "演示课：按需生成组件"
contentPack: "content-pack.example.json"
stylePack: "style-pack.example.json"
audience: "C++ 初学者"
duration: "10 minutes"
status: APPROVED
scriptVersion: "1.0"
---

# 课件脚本：演示课：按需生成组件

> 本示例演示脚本如何声明一个组件库缺口，以及缺口如何落到组件计划与简报。

## 本课概览

- **学习者 / 先修**：已会输出语句。
- **教学目标**：O1 能用逐格求和的方式解释边界处理。
- **常见误区**：M2 忽略第一行/第一列的边界。
- **组件策略**：`matrix-lab` 只能高亮，不能求和；本课声明新组件 `edge-sum-lab`，审核后入 core。

## S01 · 边缘求和实验

**对应目标**：O1 · 能逐格求出矩阵边缘元素之和
**内容来源**：K01, E01, Q01
**本屏作用**：让学生亲手点击边缘格子并观察累加，暴露“忽略边界”的误区。

### 屏幕内容

程序是一组指挥计算机做事的指令代码，计算机会按顺序执行。

```cpp
#include <iostream>
int main() {
    std::cout << "Hello World!";
    return 0;
}
```

输出：

```text
Hello World!
```

下面哪一行会向屏幕输出 Hello？

- A. std::cout << "Hello";
- B. std::cin >> "Hello";

矩阵边缘求和：点击所有位于第一行、最后一行、第一列或最后一列的格子。

### 交互设计

- **互动尝试**：内容要求“找出所有边缘格并求和”，最直接的证据是学生亲手选出边缘集合；静态表格只能展示答案，不能暴露漏选/多选。
- **学习动作**：modify
- **内容依据**：M2 是漏掉边界，必须让学生在矩阵上实际选一遍，才能看到漏了哪一格。
- **证据**：选中的格子集合恰好等于全部边缘格子，累计和为 26。
- **学生动作**：逐个点击矩阵边缘格子，再点击“提交求和”。
- **互动层级**：modify
- **初始状态**：矩阵可点击，选中的格子高亮，累计和显示为 0。
- **成功反馈**：选全所有边缘格子后显示“边界完整，和为 26”。
- **错误反馈**：漏选或多选时指出具体单元格，并提示误区 M2：忽略第一行/第一列的边界。
- **完成条件**：选中的格子集合恰好等于全部边缘格子；可重置后重试。
- **重置/重试**：点击“重置”清空选择与累计和，不改变矩阵数值。
- **无障碍**：方向键在格子间移动，Space 切换选中，Enter 提交；状态变化通过 aria-live 播报。
- **静态替代**：静态表格标出所有边缘格子，并给出求和算式。

### 旁白 / 语音

> 求和本身不难，难的是别漏掉边上的格子。先点第一行，再点最后一行，最后补上第一列和最后一列。
> [暂停] 如果你漏了角上的格子，想一想：它同时属于哪两条边？

### 转场

> 组件审核通过后，我们会在下一页复用它做更复杂的边界练习。

### 制作字段

```yaml
id: S01
title: "边缘求和实验"
objectiveId: O1
objective: "O1 能逐格求出矩阵边缘元素之和"
contentRefs: [K01, E01, Q01]
components: [eyebrow-heading, rich-text, edge-sum-lab]
layout: content-slide
interaction:
  type: edge-sum-lab
  level: modify
  contentDemand: "在矩阵上找出全部边缘格并求和"
  learningAction: modify
  evidence: "选中的格子集合恰好等于全部边缘格子，累计和为 26"
  learningFunction: "通过逐格点击理解边界与累加"
  staticAlternative: "静态表格标出边缘格子与求和算式"
  misconception: "忽略第一行/第一列的边界"
  component: edge-sum-lab
componentPlan:
  - id: edge-sum-lab
    status: new
    brief: component-briefs/edge-sum-lab.md
status: APPROVED
reviewer: demo
```
