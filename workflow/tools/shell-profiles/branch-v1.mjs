// Extraction profile for 分支选择结构的简单应用 (the branching lesson).
//
// Ingestion is deliberately a byte-for-byte copy of the shell source plus a
// narrow, reviewable patch that turns the lesson's embedded slide array into a
// data hook. A profile is code: adding a new reference shell means writing a
// profile next to this one, not editing the extractor's control flow.
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
  deck: {
    // A small, self-contained preview deck: one simple slide per declared
    // native type plus the variants that use a different renderer branch
    // (numberLab kinds, code flowType, 2/3-card grids). It exists to exercise
    // the shell package itself; production decks replace deck.js entirely.
    meta: {
      title: '壳功能预览',
      brandMain: 'C++',
      brandAccent: '互动课堂',
      brandTitle: '壳功能预览',
      lessonLabel: '',
      kicker: '智创学社 · 方块世界',
      endKicker: '智创学社 · 方块世界 · 预览完成',
      monitorTitle: 'preview.cpp',
      endMonitorTitle: '预览清单',
      coverCode: 'if (shellReady) {\n  teach();\n}',
      coverOutput: '21 种页面 · 互动可操作',
      endCode: 'if (checked) {\n  ready();\n}',
      endOutput: 'All shell types OK',
      recap: ['结构页', '互动页', '综合任务', '自查'],
    },
    slides: [
      {
        type: 'hero',
        title: '壳功能预览：分支判断',
        lead: '一页一个小任务，检查封面、结构、互动与综合任务是否完整复制。',
        topics: ['结构页', '互动实验', '综合任务', '自查'],
      },
      {
        type: 'chapter',
        station: '第 1 站',
        title: '内容与结构',
        question: '这个壳能完整呈现哪些内容页？',
        lead: '先看基础版式、卡片、表格和代码讲解。',
        topics: '1. 空白内容页　2. 概念卡片　3. 知识表格　4. 写法对比',
      },
      {
        type: 'blank',
        eyebrow: '结构页 · 基础容器',
        title: '空白内容页',
        lead: '只有标题与正文容器，用来确认字体、留白和侧边学习路径。',
      },
      {
        type: 'cards',
        eyebrow: '结构页 · 两张卡片',
        title: '顺序执行与条件执行',
        sourceText: '卡片适合并排比较两个概念。两张卡片会自动切换成两栏布局。',
        cards: [
          ['顺序执行', '程序从上到下，一条接一条执行。'],
          ['条件执行', '满足条件才执行某组语句，否则跳过。'],
        ],
        callout: '这一页同时检查 sourceText、两张卡片和底部提示。',
      },
      {
        type: 'cards',
        eyebrow: '结构页 · 三张卡片',
        title: '判断的三步',
        uniform: true,
        cards: [
          ['观察', '先看条件里的变量。'],
          ['判断', '计算条件的真假。'],
          ['行动', '按真假选择执行路径。'],
        ],
        code: 'if (raining) {\n    bringUmbrella();\n}',
        callout: '三张卡片与紧凑代码块会排在同一页。',
      },
      {
        type: 'table',
        eyebrow: '结构页 · 知识表格',
        title: '关系运算符速查',
        headers: ['运算符', '含义', '例子'],
        rows: [
          ['>', '大于', '5 > 2'],
          ['<', '小于', '3 < 6'],
          ['==', '等于', '5 == 3 + 2'],
          ['!=', '不等于', '6 != 9'],
        ],
        note: '判断相等使用两个等号；一个等号表示赋值。',
      },
      {
        type: 'compare',
        eyebrow: '结构页 · 双栏对比',
        title: '单分支与双分支',
        uniform: true,
        left: ['单分支 if', '条件成立时执行一组语句。', '不成立时直接跳过。'],
        right: ['双分支 if / else', '条件成立走 if。', '条件不成立走 else。'],
      },
      {
        type: 'code',
        eyebrow: '结构页 · 代码与流程',
        title: '读入并判断奇偶',
        intro: '左侧是代码，右侧是按执行顺序排列的流程节点。',
        code: 'int n;\ncin >> n;\nif (n % 2 == 0) {\n    cout << "even";\n}',
        flow: ['读入 n', '判断 n % 2 == 0', '输出 even'],
        note: '普通代码页使用 flow 数组生成流程。',
      },
      {
        type: 'code',
        eyebrow: '结构页 · 语义框图',
        title: '单分支的 true / false',
        flowType: 'single',
        intro: 'flowType 会把右侧换成带真假分支的语义框图。',
        code: 'if (条件) {\n    语句组;\n}',
        flow: [],
        note: '条件成立执行语句组；不成立直接跳过。',
      },
      {
        type: 'code',
        eyebrow: '结构页 · 嵌套框图',
        title: '两层条件的嵌套',
        flowType: 'nested',
        intro: 'nested 变体展示第一层与第二层判断。',
        code: 'if (a > b) {\n    if (b > c) cout << "YES";\n}',
        flow: [],
        note: '两个条件都成立，才输出 YES。',
      },
      {
        type: 'chapter',
        station: '第 2 站',
        title: '互动与练习',
        question: '每个互动控件都能操作并给出反馈吗？',
        lead: '逐个点击按钮、输入数值、放置卡片。',
        topics: '1. 分支演示　2. 判断与选择　3. 数值实验　4. 逻辑与代码',
      },
      {
        type: 'rain',
        eyebrow: '互动 · 单分支演示',
        title: '今天要不要带伞？',
        intro: '点击“今天有雨”或“今天无雨”，观察流程图经过的路径。',
      },
      {
        type: 'judgment',
        eyebrow: '互动 · 判断分类',
        title: '把关系式放进正确篮子',
        items: [
          ['5 > 2', true],
          ['3 小时 < 4 公里', false],
          ['2 + 3 == 5', true],
          ['"苹果" != "苹果"', false],
        ],
      },
      {
        type: 'quiz',
        eyebrow: '互动 · 单项选择',
        title: '哪个写法表示相等？',
        question: '判断 a 和 b 是否相等，应写成：',
        options: ['a = b', 'a == b', 'a != b', 'a >= b'],
        answer: 1,
        feedback: '一个等号用于赋值，两个等号才用于比较。',
      },
      {
        type: 'quiz',
        eyebrow: '互动 · 代码选择题',
        title: '这段代码输出什么？',
        code: 'int a = 5;\nif (a > 3) {\n    cout << "A";\n}',
        question: '程序会输出什么？',
        options: ['A', '什么也不输出', '5', 'true'],
        answer: 0,
        feedback: '5 > 3 成立，因此执行 cout。',
      },
      {
        type: 'expr',
        eyebrow: '互动 · 表达式求值',
        title: '关系表达式的结果',
        intro: '先预测 0 或 1，再运行，观察 C++ 怎样输出真假。',
        question: '输出结果和你的预测一致吗？',
        cases: [
          ['1 + 2 * 3 > 6', '1'],
          ['10 % 3 == 1', '1'],
          ['5 / 2 >= 3', '0'],
        ],
      },
      {
        type: 'numberLab',
        eyebrow: '互动 · 两个独立 if',
        title: '奇偶判断：判断两次',
        kind: 'odd-single',
        default: 9,
        description: '输入一个整数，观察两个独立 if 分别判断什么。',
        code: 'int n;\ncin >> n;\nif (n % 2 == 0) cout << "even";\nif (n % 2 != 0) cout << "odd";',
        prompt: '两个 if 都会执行判断；输入 9 和 10 各试一次。',
      },
      {
        type: 'numberLab',
        eyebrow: '互动 · if / else',
        title: '奇偶判断：只判断一次',
        kind: 'odd-double',
        default: 6,
        description: '输入一个整数，观察双分支怎样在两条路径中选择。',
        code: 'int n;\ncin >> n;\nif (n % 2 == 0) {\n    cout << "even";\n} else {\n    cout << "odd";\n}',
        prompt: '输入 6、7、0，比较输出。',
      },
      {
        type: 'numberLab',
        eyebrow: '互动 · 边界条件',
        title: '公园门票的优惠边界',
        kind: 'ticket',
        default: 30,
        description: '票价 50 元；一次购票满 30 张，每张优惠 2 元。输入票数计算总价。',
        code: 'if (票数 >= 30) {\n    单价 = 48;\n} else {\n    单价 = 50;\n}',
        prompt: '输入 29、30、31，观察“满 30 张”是否包含 30。',
      },
      {
        type: 'numberLab',
        eyebrow: '互动 · 嵌套追踪',
        title: '可爱数判断',
        kind: 'cute',
        default: 48,
        description: '个位是 8，并且是 6 的倍数，才是可爱数。输入整数 x 并逐步追踪。',
        code: 'if (x % 10 == 8) {\n    if (x % 6 == 0) cout << "Yes";\n    else cout << "No";\n} else {\n    cout << "No";\n}',
        prompt: '试 48、28、12、25，观察程序在哪一步停止。',
      },
      {
        type: 'numberline',
        eyebrow: '互动 · 数轴区间',
        title: 'a > b > c 的 b 在哪里？',
      },
      {
        type: 'chainLab',
        eyebrow: '互动 · 连比实验',
        title: 'a > b > c 能直接写吗？',
        description: '输入 a、b、c，比较错误连比与正确逻辑的结果。',
        explanation: 'C++ 先计算 a > b 得到 0 或 1，再用这个结果与 c 比较，所以连比不能表达“两个条件同时成立”。',
      },
      {
        type: 'tripleLab',
        eyebrow: '互动 · 三路追踪',
        title: '严格递减判断器',
        kind: 'descending',
        defaults: [3, 2, 1],
      },
      {
        type: 'fill',
        eyebrow: '互动 · 代码填空',
        title: '补全求最大值的分支',
        description: '把每个横线处填成正确的变量，再检查答案。',
        answers: ['a', 'c', 'b', 'c'],
      },
      {
        type: 'chapter',
        station: '第 3 站',
        title: '综合任务',
        question: '把判断组合成一个小游戏？',
        lead: '先看规则，再动手实验，最后复盘。',
        topics: '1. 游戏规则　2. 两堆实验　3. 策略复盘　4. 课末自查',
      },
      {
        type: 'stoneIntro',
        eyebrow: '综合 · 任务规则',
        title: '取石子：先弄清规则',
      },
      {
        type: 'stone',
        eyebrow: '综合 · 两堆实验',
        title: '实验：两堆一样多',
        start: [3, 3],
        hint: '你先取，观察 Will 如何回应。',
        question: '你从一堆取几个，Will 就从另一堆取几个。',
        insight: '每轮结束两堆又相等，后手总能取走最后一个。',
      },
      {
        type: 'stoneSummary',
        eyebrow: '综合 · 策略复盘',
        title: '从实验到分支判断',
      },
      {
        type: 'checklist',
        eyebrow: '综合 · 课末自查',
        title: '壳功能预览清单',
        items: ['结构页正常显示', '卡片与表格能阅读', '选择题有即时反馈', '实验台能运行', '综合任务能操作'],
      },
      {
        type: 'end',
        title: '壳功能预览完成',
        lead: '21 种原生页面、互动与综合任务都已经在这个预览课件中出现。',
      },
    ],
  },
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
