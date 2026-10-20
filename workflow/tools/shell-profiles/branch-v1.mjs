// Extraction profile for 分支选择结构的简单应用 (the branching lesson).
//
// Ingestion is deliberately a byte-for-byte copy of the shell source plus a
// narrow, reviewable patch that turns the lesson's embedded slide array into a
// data hook. A profile is code: adding a new reference shell means writing a
// profile next to this one, not editing the extractor's control flow.
import previewDeck from './branch-v1/preview-deck.mjs'
import previewNarration from './branch-v1/preview-narration.mjs'

export default {
  id: 'branch-v1',
  name: '方块世界 · 分支选择壳',
  description: '智创学社方块世界风格：顶栏/底栏、侧边学习路径、像素角色、语音时间轴。',
  reference: {
    entry: 'index.html',
    assetsDir: 'assets',
  },
  copy: {
    files: ['index.html', 'styles.css', 'lesson.js', 'narration-plan.js', 'voice-manifest.js'],
    // Only shell chrome/background art. The reference narration (520 clips)
    // and per-lesson voice samples stay out of the shell library.
    assetFiles: [
      'assets/arrow-left.svg',
      'assets/arrow-right.svg',
      'assets/footer-pause.svg',
      'assets/footer-play.svg',
      'assets/maximize.svg',
      'assets/minimize.svg',
      'assets/pixel-landscape.svg',
      'assets/tech-body.png',
      'assets/tech-cover.png',
      'assets/tech-end.png',
    ],
  },
  lesson: {
    contentStart: 'const slides = [',
    contentEnd: 'const $=s=>document.querySelector(s);',
    loaderFile: 'loader.js',
    replaceLines: [
      { match: /^function sidebar\(\)/, file: 'sidebar.js' },
      { match: /^  if\(s\.type==='hero'\)return /, file: 'hero.js' },
      { match: /^  if\(s\.type==='end'\)return /, file: 'end.js' },
    ],
    insertBefore: [{ marker: 'function renderContent(s){', file: 'shell-art.js' }],
    insertBeforeTail: [{ marker: 'render();syncFullscreen();', file: 'debug.js' }],
    replacements: [
      {
        find: 'const narrationPlan=window.BRANCH_NARRATION_PLAN;',
        replace: 'const narrationPlan=window.COURSEWARE_NARRATION_PLAN||window.BRANCH_NARRATION_PLAN;',
      },
      {
        find: 'const voiceManifest=window.BRANCH_VOICE_MANIFEST;',
        replace: `const voiceManifest=window.COURSEWARE_VOICE_MANIFEST||window.BRANCH_VOICE_MANIFEST;
document.title=meta.title||document.title;
if($('#brand'))$('#brand').innerHTML=\`\${esc(meta.brandMain||'C++')} <span>\${esc(meta.brandTitle||meta.brandAccent||'')}</span>\`;`,
      },
      {
        find: "const s=slides[index];$('#slide').className=",
        replace: "const s=slides[index]||{type:'blank',title:'—',lead:''};$('#slide').className=",
      },
      {
        // Interactive pages must hold at the end of narration; auto playback
        // otherwise advances before the learner can touch the component.
        find: 'if(!segment){running=false;activeSegmentIndex=-1;position=duration;updateClock();if(auto&&index<slides.length-1){index++;render();}return}',
        replace: `if(!segment){
    running=false;activeSegmentIndex=-1;position=duration;updateClock();
    if(auto&&index<slides.length-1){
      // Interactive pages hold after narration: the learner decides when the
      // task is done and clicks 下一页. Linear pages keep auto-advancing.
      if(isInteractivePage(slides[index]))notify('本页可以自由操作；完成后点“下一页”继续。');
      else{index++;render();}
    }
    return
  }`,
      },
      {
        find: 'function pageSegments(pageIndex=index){',
        replace: `// A component page is a hands-on page: narration may finish before the learner
// has finished the task. Auto mode must not advance past it on its own.
function isInteractivePage(slide){return Boolean(slide&&slide.component);}
function pageSegments(pageIndex=index){`,
      },
    ],
  },
  htmlReplacements: [
    {
      find: '<button id="autoMode" class="mode-button" type="button">自动播放</button>',
      replace: '<button id="autoMode" class="mode-button" type="button" title="自动播放：逐页朗读；互动页读完后停住，操作完成再点下一页">自动播放</button>',
    },
  ],
  deck: previewDeck,
  previewNarration,
  slideTypes: [
    'hero', 'chapter', 'blank', 'end',
    'rain', 'cards', 'judgment', 'table', 'quiz', 'expr', 'code',
    'numberLab', 'compare', 'numberline', 'chainLab', 'tripleLab',
    'fill', 'stoneIntro', 'stone', 'stoneSummary', 'checklist',
  ],
  components: [
    { id: 'cover-hero', type: 'hero', name: '封面页', category: 'cover', whenToUse: '课件第一页', whenNotToUse: '不要重复用于章节', learningFunction: '建立主题与学习预期', states: ['default'] },
    { id: 'cover-chapter', type: 'chapter', name: '章节页', category: 'cover', whenToUse: '进入新章节', whenNotToUse: '内容较多时不要代替内容页', learningFunction: '组织学习路径', states: ['default'] },
    { id: 'cover-end', type: 'end', name: '结束页', category: 'cover', whenToUse: '课件最后一页', whenNotToUse: '不要用于章节小结', learningFunction: '回顾与收束', states: ['default'] },
    { id: 'blank-content', type: 'blank', name: '空白内容页', category: 'content', whenToUse: '仅用于外壳预览或占位', whenNotToUse: '正式课件不要使用空白页', learningFunction: '预览版式', states: ['default'] },
    { id: 'rain-branch', type: 'rain', name: '下雨分支演示', category: 'interactive', whenToUse: '讲解单分支选择', whenNotToUse: '不要用于多分支嵌套', learningFunction: '观察条件成立与跳过', states: ['default', 'rain', 'no-rain'] },
    { id: 'cards', type: 'cards', name: '概念卡片', category: 'content', whenToUse: '并排比较两到三个概念', whenNotToUse: '不要塞入长段落', learningFunction: '概念对照', states: ['default'] },
    { id: 'judgment', type: 'judgment', name: '判断对错', category: 'assessment', whenToUse: '快速检查真假判断', whenNotToUse: '不要用于多步推理', learningFunction: '形成性评价', states: ['default', 'answered'] },
    { id: 'table', type: 'table', name: '知识表格', category: 'content', whenToUse: '罗列运算符、规则或对照项', whenNotToUse: '不要超过六行核心信息', learningFunction: '结构化知识', states: ['default'] },
    { id: 'quiz-single', type: 'quiz', name: '单选题', category: 'assessment', whenToUse: '检查单个知识点', whenNotToUse: '不要用于开放讨论', learningFunction: '即时反馈', states: ['default', 'selected', 'correct', 'wrong'] },
    { id: 'expr-runner', type: 'expr', name: '表达式求值器', category: 'interactive', whenToUse: '演示关系/逻辑表达式的结果', whenNotToUse: '不要用于整段代码执行', learningFunction: '观察求值过程', states: ['default', 'evaluated'] },
    { id: 'code-block', type: 'code', name: '代码讲解块', category: 'content', whenToUse: '展示并逐步讲解代码', whenNotToUse: '不要整页只有代码', learningFunction: '代码阅读', states: ['default'] },
    { id: 'number-lab', type: 'numberLab', name: '数值实验台', category: 'interactive', whenToUse: '通过输入观察条件结果', whenNotToUse: '不要用于非数值条件', learningFunction: '变量与条件实验', states: ['default', 'run'] },
    { id: 'compare', type: 'compare', name: '双栏对比', category: 'content', whenToUse: '对比两种写法或两条路径', whenNotToUse: '不要用于三项以上并列', learningFunction: '辨析差异', states: ['default'] },
    { id: 'number-line', type: 'numberline', name: '数轴区间', category: 'interactive', whenToUse: '展示数值区间与边界', whenNotToUse: '不要用于非连续数值', learningFunction: '建立区间直觉', states: ['default', 'highlight'] },
    { id: 'chain-lab', type: 'chainLab', name: '逻辑链实验', category: 'interactive', whenToUse: '演示 && / || 的组合结果', whenNotToUse: '不要一次展示过多变量', learningFunction: '逻辑组合', states: ['default', 'run'] },
    { id: 'triple-lab', type: 'tripleLab', name: '三路分支实验', category: 'interactive', whenToUse: '演示 if / else if / else', whenNotToUse: '不要用于单分支内容', learningFunction: '多路选择', states: ['default', 'run'] },
    { id: 'fill', type: 'fill', name: '代码填空', category: 'assessment', whenToUse: '补全关键运算符或条件', whenNotToUse: '不要一次挖空过多', learningFunction: '程序建构', states: ['default', 'checked'] },
    { id: 'stone-intro', type: 'stoneIntro', name: '情境任务引入', category: 'content', whenToUse: '引出综合任务', whenNotToUse: '不要用于知识讲授', learningFunction: '任务驱动', states: ['default'] },
    { id: 'stone-game', type: 'stone', name: '取石子游戏', category: 'interactive', whenToUse: '综合运用分支判断', whenNotToUse: '不要用于低年级无基础场景', learningFunction: '策略与条件推理', states: ['default', 'playing', 'ended'] },
    { id: 'stone-summary', type: 'stoneSummary', name: '游戏复盘', category: 'summary', whenToUse: '总结互动中的判断链', whenNotToUse: '不要脱离前面的互动单独使用', learningFunction: '反思与归纳', states: ['default'] },
    { id: 'checklist', type: 'checklist', name: '自查清单', category: 'summary', whenToUse: '课末自评', whenNotToUse: '不要用于知识新授', learningFunction: '元认知', states: ['default', 'checked'] },
  ],
  layouts: [
    { id: 'cover', description: '封面/结束页：左侧标题，右侧显示器与像素角色' },
    { id: 'chapter', description: '章节页：左侧章节卡，右侧黑板问题' },
    { id: 'content-with-sidebar', description: '内容页：左侧学习路径，右侧内容区' },
    { id: 'two-column', description: '双栏内容：概念对照/代码与说明' },
    { id: 'interactive-lab', description: '互动实验：控制区 + 结果区' },
    { id: 'assessment', description: '练习与即时反馈' },
    { id: 'summary', description: '总结、复盘与自查' },
  ],
  fidelity: {
    shellSelectors: ['.app', '.topbar', '.footer', '#slide', '#outline', '.voice-picker', '.time-track', '.pixel-student'],
    requiredCss: ['@keyframes page-enter', '.pixel-student', '.cover-monitor', '.chapter-scene'],
    // Every slide type is structurally anchored by the slide container; the
    // specialized selectors are kept for types with a distinctive root.
    typeSelectors: {
      hero: ['.cover', '.cover-copy h1', '.cover-monitor'],
      chapter: ['.chapter-scene', '.chapter-copy h1', '.chapter-board'],
      end: ['.cover', '.recap', '.cover-monitor'],
      ...Object.fromEntries(
        ['blank', 'rain', 'cards', 'judgment', 'table', 'quiz', 'expr', 'code', 'numberLab', 'compare', 'numberline', 'chainLab', 'tripleLab', 'fill', 'stoneIntro', 'stone', 'stoneSummary', 'checklist']
          .map((type) => [type, ['.slide-inner']]),
      ),
    },
  },
  // The reference uses a coarse pixel grid. Generated models render smooth
  // anti-aliased edges, so downscale to a small logical sprite and upscale
  // with nearest-neighbor before shipping the PNG.
  artPostprocess: {
    pixelate: { targetHeight: 64, scale: 8 },
  },
  illustrations: [
    {
      slot: 'cover',
      reference: 'reference/cover-mascot.png',
      selector: '.pixel-student',
      className: 'pixel-student generated-mascot',
      alt: '方块世界像素角色',
      ratio: '1:1',
      size: '1k',
      blend: 'multiply',
      prompt: 'Redraw this blocky pixel-art character as a DIFFERENT individual in the same art style: same chunky pixel grid, same limited warm palette family, same full-body standing pose language and same clean silhouette. Change the face, hairstyle, outfit colors and one accessory so it is clearly not the reference character. The character should hold a small glowing branching arrow sign (a choice between two paths), suitable for a C++ branching-lessons courseware cover. Centered full body, plain pure white background, no text, no border, no drop shadow, no umbrella, no rain. Do not copy the reference image exactly.',
    },
    {
      slot: 'end',
      reference: 'reference/end-mascot.png',
      selector: '.pixel-student',
      className: 'pixel-student pixel-explorer generated-mascot',
      alt: '方块世界像素探险角色',
      ratio: '1:1',
      size: '1k',
      blend: 'multiply',
      prompt: 'Redraw this blocky pixel-art character as a DIFFERENT individual in the same art style: same chunky pixel grid, same limited green-and-earth palette family, same full-body standing pose language and same clean silhouette. Change the face, hairstyle, outfit colors and one accessory so it is clearly not the reference character. The character is a young explorer holding a folded map and a small flag, suitable for the ending page of a C++ courseware lesson. Centered full body, plain pure white background, no text, no border, no drop shadow. Do not copy the reference image exactly.',
    },
  ],
}
