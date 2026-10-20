---
lesson: "<lesson-id>"
title: "<lesson title>"
contentPack: "<path to content-pack.json>"
stylePack: "<path to style-pack manifest.json>"
componentRegistry: "registry/index.json"
audience: "<audience / prior knowledge>"
duration: "<e.g. 45 minutes>"
status: DRAFT
scriptVersion: "0.1"
---

# 课件脚本：<lesson title>

> 这是生成课件前的**人类可读唯一内容源**。老师直接修改本文件；`storyboard.yml` 由本文件生成，不手改。
> 规则：屏幕内容与旁白分开；交互写清动作、反馈、完成条件；旁白写逐字稿；不允许 TODO/待定。
> 概念：`concepts.yml` 是核心概念的唯一台账。每个概念必须在 `introducedOn` 页的**屏幕内容**里写出术语、定义和全部 `mustAppear` 短语；只在旁白里说、只在代码声明里出现都不算。强化页与评估页要实际用到这个概念。
> 一页一个教学单元；超页在语义边界拆页，续页写 `continuedFrom` / `continued`；不允许滚动条。

## 本课概览

- **学习者 / 先修**：
- **教学目标**：O1 …；O2 …
- **常见误区**：M1 …；M2 …
- **课堂节奏**：
- **组件策略**：先查参考课件源码（`reference-verbatim`）→ 风格包/注册表复用 → 缺口写进 `componentPlan`，走 component-brief → build → review → core，不在页面里临时发明。

## S01 · <一句话标题>

**对应目标**：O1 · <可观察目标>
**内容来源**：K01
**本屏作用**：<为什么需要这一屏；与上一屏的衔接>

### 屏幕内容

<屏幕上实际出现的文字、代码、表格、图示，逐字写；旁白不要混进来。>

```text
<code / output / table>
```

### 交互设计

- **互动尝试**：<先从这个内容本身出发，写出学生要学会的动作，以及最能产生证据的互动形式；不要先选组件。每一页都必须写这一项。>
- **学习动作**：observe | locate | label | predict | trace | convert | classify | construct | modify | explain
- **内容依据**：<这个内容为什么需要这个动作；纯讲解/静态为什么不够>
- **证据**：<学生做出什么就算会了；要可观察，不要写“理解了”>
- **学生动作**：<学生具体做什么：点击 / 输入 / 拖拽 / 选择 / 改写…>
- **互动层级**：watch | answer | modify | construct | explain（watch 只能配 observe）
- **初始状态**：<看到什么；哪些控件可用>
- **成功反馈**：<做对后看到/听到什么>
- **错误反馈**：<做错后看到什么；对应哪个误区 M1>
- **完成条件**：<什么算完成；能否重试>
- **重置/重试**：<如何重置；状态是否保留>
- **无障碍**：<键盘操作、焦点顺序、ARIA、对比度、减少动画>
- **静态替代**：<不可交互时的等价静态内容；每一页都要写>
- **静态理由**：<仅当层级为 watch 时写：为什么本页没有一种互动比静态更能产生学习证据。不能写“没有现成组件”“做起来麻烦”。>

### 旁白 / 语音

> <逐字稿。一句话一段；在等待学习者操作处写 [暂停]。>
> <不要照读屏幕全文；补充解释、提示和反馈。>

### 转场

<本屏结束后如何进入下一屏；或从上一屏如何过来。>

### 制作字段

```yaml
id: S01
title: "<与标题一致>"
objectiveId: O1
objective: "<可观察目标>"
contentRefs: [K01]
components: [eyebrow-heading, rich-text]
layout: content-slide
interaction:
  type: <component-or-interaction-type>
  level: <watch|answer|modify|construct|explain>
  contentDemand: "<这个内容要求学生做什么；为什么纯讲解不够>"
  learningAction: <observe|locate|label|predict|trace|convert|classify|construct|modify|explain>
  evidence: "<学生做出什么就算会了>"
  learningFunction: "<这个互动服务哪个目标>"
  staticAlternative: "<等价静态内容>"
  whyStatic: "<仅 watch：为什么没有互动比静态更能产生学习证据>"
  misconception: M1
  component: <component-id>
componentPlan:
  - id: <component-id>
    status: existing        # reference-verbatim | existing | extend | new
    brief: component-briefs/<component-id>.md   # new/extend 必填
status: DRAFT
reviewer: ""
```

## S02 · <一句话标题>

> 复制 S01 的结构继续写。每一屏都必须有：屏幕内容、交互设计、旁白、制作字段。
> 每一页先尝试互动；只有写清「静态理由」、证明没有互动比静态更能产生学习证据时，才允许 `watch`。
> `watch` 只能配 `observe`；写了点击 / 输入 / 单步 / 改写，就必须用对应的非 watch 层级。

**对应目标**：O1 · <可观察目标>
**内容来源**：K01, E01
**本屏作用**：<…>

### 屏幕内容

<…>

### 交互设计

- **互动尝试**：<考虑过的互动形式；以及为什么它不比静态更好>
- **学习动作**：observe
- **内容依据**：<本页只承担展示/定向，不产生新的学习证据>
- **证据**：<学生能复述/指出什么>
- **学生动作**：<阅读 / 观察 / 对照>
- **互动层级**：watch
- **初始状态**：<…>
- **静态替代**：<等价静态内容>
- **静态理由**：<为什么本页没有互动优于静态；不能写“没有组件”>
- **无障碍**：<…>

### 旁白 / 语音

> <逐字稿。>

### 转场

<…>

### 制作字段

```yaml
id: S02
title: "<与标题一致>"
objectiveId: O1
objective: "<可观察目标>"
contentRefs: [K01, E01]
components: [eyebrow-heading, rich-text]
layout: content-slide
interaction:
  type: <component-or-interaction-type>
  level: watch
  contentDemand: "<本页只承担展示/定向，不产生新的学习证据>"
  learningAction: observe
  evidence: "<学生能复述/指出什么>"
  learningFunction: "<本页的展示作用>"
  staticAlternative: "<等价静态内容>"
  whyStatic: "<为什么本页没有互动优于静态>"
status: DRAFT
reviewer: ""
```
