// Shared deterministic renderer for one courseware.md slide.
//
// Used by the full script renderer and by self-study page additions so a new
// slide has exactly the same headings, labels and machine YAML as a generated
// page.
import YAML from 'yaml'

export function cleanOneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function machineFor(outlinePage, page) {
  const design = page.interactionDesign
  const interaction = {
    type: outlinePage.interaction.type,
    level: outlinePage.interaction.level,
    contentDemand: cleanOneLine(design.contentDemand),
    learningAction: design.learningAction,
    evidence: cleanOneLine(design.evidence),
    learningFunction: cleanOneLine(design.learningFunction),
    staticAlternative: cleanOneLine(design.staticAlternative),
  }
  if (outlinePage.interaction.component) interaction.component = outlinePage.interaction.component
  if (design.level === 'watch') interaction.whyStatic = cleanOneLine(design.whyStatic)
  const misconception = design.misconception || outlinePage.interaction.misconception
  if (misconception) interaction.misconception = misconception
  const machine = {
    id: page.id,
    title: page.title,
    objectiveId: outlinePage.objectiveId,
    objective: outlinePage.objective,
    contentRefs: outlinePage.contentRefs,
    components: outlinePage.components,
    layout: outlinePage.layout,
    interaction,
    status: 'DRAFT',
  }
  if (outlinePage.componentPlan?.length) machine.componentPlan = outlinePage.componentPlan
  if (page.exercise) machine.exercise = page.exercise
  if (outlinePage.continuedFrom) machine.continuedFrom = outlinePage.continuedFrom
  if (outlinePage.continued) machine.continued = true
  return machine
}

function fenced(value, lang = '') {
  const text = String(value ?? '').replace(/\r\n/g, '\n')
  const runs = text.match(/`+/g) || []
  const size = Math.max(3, ...runs.map((run) => run.length + 1))
  const fence = '`'.repeat(size)
  return `${fence}${lang}\n${text.replace(/\n+$/, '')}\n${fence}`
}

// The visible half of a staged exercise is generated, never model-written:
// statement, starter code and every visible test stay in sync with the deck
// props that code-judge receives. There is deliberately no navigation gate.
export function renderExerciseScreen(exercise) {
  const tests = Array.isArray(exercise.tests) ? exercise.tests : []
  const lines = [
    '**阶段练习**',
    '',
    String(exercise.statement || '').trim(),
    '',
    '**起始代码**',
    '',
    fenced(exercise.starterCode || '', 'cpp'),
    '',
    '**测试数据（全部可见）**',
  ]
  for (const [index, test] of tests.entries()) {
    const label = cleanOneLine(test.label || `测试 ${index + 1}`)
    lines.push(
      '',
      `**测试 ${index + 1} · ${label}**`,
      '',
      '输入：',
      '',
      String(test.input || '') ? fenced(test.input) : '（无输入）',
      '',
      '期望输出：',
      '',
      String(test.expected || '') ? fenced(test.expected) : '（无输出）',
    )
  }
  return lines.join('\n')
}

export function screenContentForPage(page) {
  return page.exercise ? renderExerciseScreen(page.exercise) : String(page.screenContent || '')
}

export function renderInteractionDesign(page) {
  const design = page.interactionDesign
  const lines = [
    ['互动尝试', design.attempt],
    ['学习动作', design.learningAction],
    ['内容依据', design.contentDemand],
    ['证据', design.evidence],
    ['学习功能', design.learningFunction],
    ['互动层级', design.level],
    ['初始状态', design.initialState],
    ['学生动作', design.studentAction],
  ]
  if (design.level !== 'watch') {
    lines.push(
      ['成功反馈', design.successFeedback],
      ['错误反馈', design.errorFeedback],
      ['完成条件', design.completion],
      ['重置/重试', design.reset],
    )
  }
  lines.push(['无障碍', design.accessibility], ['静态替代', design.staticAlternative])
  if (design.level === 'watch') lines.push(['静态理由', design.whyStatic])
  if (design.misconception) lines.push(['对应误区', design.misconception])
  return lines
    .filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => `- **${label}**：${cleanOneLine(value)}`)
    .join('\n')
}

export function renderNarration(paragraphs) {
  return (paragraphs || [])
    .map((paragraph) =>
      String(paragraph)
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join('\n'),
    )
    .join('\n>\n')
}

export function renderSlideBlock(outlinePage, page) {
  return [
    `## ${outlinePage.id} · ${outlinePage.title}`,
    '',
    `**对应目标**：${outlinePage.objectiveId} · ${cleanOneLine(outlinePage.objective)}`,
    `**内容来源**：${(outlinePage.contentRefs || []).join(', ')}`,
    `**本屏作用**：${cleanOneLine(outlinePage.purpose)}`,
    '',
    '### 屏幕内容',
    '',
    screenContentForPage(page).trim(),
    '',
    '### 交互设计',
    '',
    renderInteractionDesign(page),
    '',
    '### 旁白 / 语音',
    '',
    renderNarration(page.narration || []),
    '',
    '### 转场',
    '',
    String(page.transition || '').trim(),
    '',
    '### 制作字段',
    '',
    '```yaml',
    YAML.stringify(machineFor(outlinePage, page), { lineWidth: 0 }).trimEnd(),
    '```',
    '',
  ].join('\n')
}
