# 组件计划：<lesson>

> 先查参考源码 → 再查风格包/注册表 → 最后才新建。每个交互需求都要有检索记录；`new` / `extend` 必须有简报，不得在页面里临时发明组件。
> 组件计划先于分镜；分镜只能使用参考源码类型、风格包或已入 core 的组件。
> 风格包里标 `kind: generated` 的条目只是设计语汇（当前风格包暂缓收录），实现必须来自注册表 core；不能把它当作 `reference-verbatim` 直接使用。

## 1. 复用检索

### 1.1 参考源码检索（第一优先）

| 需求（来自哪屏 / 哪个学习动作） | 参考类型 / 选择器 | 参考文件 / 哈希 | 是否可直接复制 | 说明 |
|---|---|---|---|---|
| S02 单选题作答 | `quiz-single` / `.quiz-box` | `SOURCE.json` / `fidelity.json` | 是（reference-verbatim） | DOM/CSS 直接复用 |
| S03 虚拟键盘按键 | `virtual-keyboard` / `.virtual-keyboard` | `SOURCE.json` / `fidelity.json` | 是（reference-verbatim） | DOM/CSS 直接复用 |

### 1.2 注册表检索

| 需求（来自哪屏 / 哪个学习动作） | 检索词 / tags / level | 命中组件 | 是否满足 | 不满足的原因 |
|---|---|---|---|---|
| S03 矩阵下标点击 | matrix, index, modify | matrix-lab@1.0.0 | 是 | — |
| S05 边缘求和 | edge, sum, modify | matrix-lab@1.0.0 | 否 | 只能高亮，不能求和与逐步反馈 |

检索命令：

```bash
node workflow/tools/search-registry.mjs --registry registry/index.json \
  --query "<学习动作>" --tags "<tag1,tag2>" --level <watch|answer|modify|construct|explain>
```

## 2. 缺口

| ID | 学习动作 | 互动层级 | 现有组件为何不够 | 决定 | 简报 |
|---|---|---|---|---|---|
| edge-sum-lab | 点击边缘格子，得到逐步求和反馈 | modify | matrix-lab 只高亮，没有求和状态与错误反馈 | new | component-briefs/edge-sum-lab.md |

没有缺口时写：

| ID | 学习动作 | 互动层级 | 现有组件为何不够 | 决定 | 简报 |
|---|---|---|---|---|---|
| — | — | — | 现有组件已覆盖 | 无 | — |

## 3. 复用映射

| Slide | 需要的学习动作 | 组件 | 来源 |
|---|---|---|---|
| S02 | 选择正确答案 | quiz-single | reference-verbatim |
| S03 | 虚拟键盘输入 | virtual-keyboard | reference-verbatim |
| S04 | 点击矩阵下标并观察下标 | matrix-lab | registry（generated，需 core；当前暂缓） |
| S05 | 边缘求和 | edge-sum-lab | new（审核后入 core） |

> `registry（generated）` 表示实现包已入注册表 core；若只存在于风格包设计语汇中，先走 brief → build → review → core，再写进本表。

## 4. 风险与非目标

- 新组件的行为错误风险：
- 视觉/基线风险：
- 不准备做的能力（non-goals）：
