---
lesson: "demo-lesson-01"
title: "演示课：程序与输出"
contentPack: "content-pack.example.json"
stylePack: "style-pack.example.json"
audience: "C++ 初学者"
duration: "15 minutes"
status: APPROVED
scriptVersion: "1.0"
---

# 课件脚本：演示课：程序与输出

## 本课概览

- **学习者 / 先修**：第一次接触 C++ 的学生；无编程经验。
- **教学目标**：O1 能用自己的话解释程序是什么，并写出、运行一个输出 Hello World 的程序。
- **常见误区**：M1 把 `cin` 当成输出语句。
- **课堂节奏**：先读定义，再看第一个程序，最后用一道辨析题检查理解。
- **组件策略**：只使用风格包已有组件，无新增组件。

## S01 · 程序是一组指令

**对应目标**：O1 · 能用自己的话解释程序是什么
**内容来源**：K01
**本屏作用**：建立“程序=按顺序执行的指令”这一第一印象。

### 屏幕内容

程序是一组指挥计算机做事的指令代码，计算机会按顺序执行。

### 交互设计

- **互动尝试**：可以让学生点击一条指令并观察执行顺序；但本页只建立“程序=按顺序的指令”第一印象，真正的可观察证据放在 S02 的输出选择，重复加互动不会产生新证据。
- **学习动作**：observe
- **内容依据**：本页是概念定向，学生只需读懂“指令 + 顺序”，不需要在此处产生操作证据。
- **证据**：能用“指令按顺序执行”复述程序的含义。
- **学生动作**：阅读正文，不操作。
- **互动层级**：watch
- **初始状态**：纯阅读页，无控件。
- **静态替代**：本屏本来就是静态阅读内容；不可交互时内容不变。
- **静态理由**：本页的定向内容没有一种互动能比静态更快建立第一印象；执行顺序的练习在 S02 的代码与输出中完成。
- **无障碍**：正文使用语义化段落，屏幕阅读器按顺序朗读；对比度达到 AA。

### 旁白 / 语音

> 先别急着写代码。想一想你每天用的软件：它们看起来会思考，其实只是把一条条指令按顺序执行。
> 这一屏要记住两个词：指令，顺序。

### 转场

> 知道了程序是什么，我们来看第一个真正的程序。

### 制作字段

```yaml
id: S01
title: "程序是一组指令"
objectiveId: O1
objective: "O1 能用自己的话解释程序是什么"
contentRefs: [K01]
components: [eyebrow-heading, rich-text]
layout: content-slide
interaction:
  type: static-reading
  level: watch
  contentDemand: "建立“程序是按顺序执行的指令”这一第一印象"
  learningAction: observe
  evidence: "能用“指令按顺序执行”复述程序的含义"
  learningFunction: "建立程序的第一印象"
  staticAlternative: "静态定义文字"
  whyStatic: "本页只做概念定向；执行顺序的操作证据在 S02 产生，重复互动不会增加证据"
status: APPROVED
reviewer: demo
```

## S02 · 第一个程序与输出

**对应目标**：O1 · 能写出并运行 Hello World
**内容来源**：E01, Q01
**本屏作用**：把“指令”落到一个可运行的程序，并用辨析题检验输出语句。

### 屏幕内容

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

### 交互设计

- **互动尝试**：内容要求区分“输出”和“输入”，最直接的证据是让学生在一对语句中选出真正输出 Hello 的那条；选择题比静态讲解更能暴露 cin/cout 混淆。
- **学习动作**：classify
- **内容依据**：M1 是 cin/cout 方向混淆，必须让学生先做一次判断，静态文字无法证明他会区分。
- **证据**：选出 A（cout）并说明 B 是输入。
- **学生动作**：从 A、B 中选择一行，然后提交。
- **互动层级**：answer
- **初始状态**：两个选项均可选，未提交，答案与反馈隐藏。
- **成功反馈**：选择 A 后显示“正确：cout 用于输出。”
- **错误反馈**：选择 B 后显示“cin 是输入，不是输出。”对应误区 M1：把 cin 当成输出。
- **完成条件**：选中 A 并提交即完成；可以重置后重试。
- **重置/重试**：点击“重试”清空选择与反馈，选项顺序不变。
- **无障碍**：Tab 进入选项组，方向键切换，Enter 提交；反馈区使用 aria-live。
- **静态替代**：静态展示代码、输出与两条选项的讲解。

### 旁白 / 语音

> 看这一行 `std::cout << "Hello World!";`。cout 读作 see-out，意思是“输出到屏幕”。
> 现在请你选一选：哪一行真的会把 Hello 送到屏幕上？[暂停]
> 如果选了 cin，注意它是 see-in，负责输入，方向正好相反。

### 转场

> 下一课我们会让程序记住数据，也就是变量。

### 制作字段

```yaml
id: S02
title: "第一个程序与输出"
objectiveId: O1
objective: "O1 能写出并运行 Hello World"
contentRefs: [E01, Q01]
components: [eyebrow-heading, code-block, quiz-single]
layout: content-slide
interaction:
  type: quiz-single
  level: answer
  contentDemand: "区分输出语句 cout 与输入语句 cin"
  learningAction: classify
  evidence: "选出 cout 并说明 cin 是输入"
  learningFunction: "练习 cout 输出语句"
  staticAlternative: "静态对照代码与输出"
  misconception: "把 cin 当成输出"
  component: quiz-single
status: APPROVED
reviewer: demo
```
