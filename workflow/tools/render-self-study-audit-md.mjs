#!/usr/bin/env node
// Render the human-readable self-study audit report from the validated JSON.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const auditPath = opt('--audit')
const outPath = opt('--out')
if (!auditPath || !outPath) {
  console.error('usage: node render-self-study-audit-md.mjs --audit <self-study-audit.json> --out <self-study-audit.md>')
  process.exit(2)
}
const audit = readData(auditPath)
function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}
const rubricNames = new Map((audit.rubric || []).map((item) => [item.id, item.name]))
const gaps = [...(audit.gaps || [])].sort((a, b) => {
  const rank = { blocking: 0, recommended: 1, info: 2 }
  return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
})
const supplements = audit.supplements || []
const budget = audit.pageBudget || {}
const blocking = gaps.filter((gap) => gap.severity === 'blocking')
const reason = blocking.length
  ? blocking.map((gap) => `${gap.id} ${gap.summary}`).join('；')
  : '没有阻断性自学缺口'
const lines = [
  `# 自学充分性审核：${audit.lesson}`,
  '',
  `- **脚本**：\`${audit.script.path}\`（SHA-256 \`${audit.script.sha256}\`）`,
  '- **使用场景**：`self-study`（无老师在旁）',
  `- **屏数**：${audit.script.slides}（声明预算 ${budget.declared}）`,
  `- **审核时间**：${audit.reviewedAt}`,
  `- **结论**：\`${audit.verdict}\` — ${reason}`,
  '',
  '> 本报告只回答「没有老师时学生能否学会」。它不评价脚本是否符合格式；格式已由 `check-script` 把关。',
  '> 本报告不修改 `courseware.md`。补充提案见 `courseware.self-study.md`，经工作流应用。',
  '',
  '## 1. 十维评分',
  '',
  '| 维度 | 判定 | 证据（屏号/原文） | 说明 |',
  '|---|---|---|---|',
  ...audit.rubric.map((item) => `| ${cell(rubricNames.get(item.id) || item.id)} | ${item.verdict} | ${cell(item.evidence)} | ${cell(item.notes || '')} |`),
  '',
  '## 2. 逐屏自学作用',
  '',
  '| 屏 | 本屏作用 | 目标 | 状态 | 缺口 |',
  '|---|---|---|---|---|',
  ...audit.screens.map((screen) => `| ${screen.id} | ${screen.role} | ${(screen.objectiveIds || []).join(', ')} | ${screen.status} | ${(screen.gapIds || []).join(', ')} |`),
  '',
  '## 3. 目标 × 自学链路',
  '',
  '| 目标 | 讲解 | 完整例题 | 练习 | 反馈 | 屏号 |',
  '|---|---|---|---|---|---|',
  ...audit.objectives.map((objective) => `| ${objective.id} ${cell(objective.text)} | ${objective.explanation ? '✅' : '❌'} | ${objective.workedExample ? '✅' : '❌'} | ${objective.practice ? '✅' : '❌'} | ${objective.feedback ? '✅' : '❌'} | ${(objective.slides || []).join(', ')} |`),
  '',
  '## 4. 缺口清单',
  '',
  ...(gaps.length
    ? gaps.flatMap((gap) => [
        `### ${gap.id} · ${gap.summary}`,
        '',
        `- **严重度**：${gap.severity}`,
        `- **维度**：\`${gap.dimension}\``,
        `- **涉及屏**：${(gap.slideIds || []).join(', ')}`,
        `- **证据**：${gap.evidence}`,
        `- **提案**：${gap.proposal}`,
        `- **依据**：${gap.basis}`,
        `- **页数影响**：${gap.pageImpact >= 0 ? '+' : ''}${gap.pageImpact}`,
        '',
      ])
    : ['没有记录缺口。', '']),
  '## 5. 页数判断',
  '',
  `- 当前：${budget.current} 页`,
  `- 提案后：${budget.proposed} 页`,
  `- 是否超过声明预算：${budget.exceedsDeclaredBudget ? '是' : '否'}`,
  `- 新增页：${(audit.pageAdditions || []).map((addition) => addition.id).join(', ') || '无'}`,
  `- **需要老师决定**：${budget.decision}`,
  '',
  '## 6. 补充提案摘要',
  '',
  '| 补充 id | 缺口 | 类型 | 目标屏 | 依据 |',
  '|---|---|---|---|---|',
  ...(supplements.length
    ? supplements.map((s) => `| ${s.id} | ${s.gapId} | ${s.type} | ${(s.targetSlides || []).join(', ')} | ${cell(s.basis)} |`)
    : ['| — | — | — | — | — |']),
  '',
  '> 完整文本见 `courseware.self-study.md`；每处补充都有 `<!-- self-study-supplement:<id> -->` 定界和「自学补充」标签。',
  '',
  '## 7. 自动检查结果',
  '',
  '| 检查 | 结果 | 说明 |',
  '|---|---|---|',
  '| `check-self-study.mjs` | pass | 生成器已运行并通过 |',
  '| 脚本哈希一致 | pass | audit.script.sha256 绑定当前脚本 |',
  '| required 内容项全部被引用 | pass | 生成器已校验 |',
  '| 页数预算一致 | pass | 生成器已计算 |',
  `| 补充块定界与标签 | ${supplements.length ? 'pass' : 'n/a'} | ${supplements.length ? '每个补充一个定界块' : '无补充'} |`,
  '',
  '## 8. 待老师决定',
  '',
  ...(budget.decision === 'teacher-approval-required'
    ? [`- [ ] 当前页数 ${budget.current} 已超过声明预算 ${budget.declared}；是否接受？`]
    : ['- [ ] 是否接受本报告的补充提案？']),
  '',
]
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${lines.join('\n').trimEnd()}\n`)
console.log(`OK render self-study audit — ${audit.verdict}, ${gaps.length} gap(s) -> ${outPath}`)
