// Dummy narration plan for the shell preview.
//
// This is fixture audio, not lesson audio. One short phrase per page and four
// provider voices make the timeline, play/pause, pause segments and voice
// switcher observable. The MP3 files live in ./preview-audio/ and carry their
// own hash/duration ledger (preview-audio/manifest.json); regenerate with
// `node workflow/tools/make-preview-voice.mjs --profile branch-v1 --force`.
export default {
  label: '占位语音',
  contentMarker: '占位',
  voices: [
    { id: 'xiaolai', name: '小来老师', providerVoice: 'zh-CN-XiaoxiaoNeural' },
    { id: 'xiaochuang', name: '小创老师', providerVoice: 'zh-CN-YunyangNeural' },
    { id: 'xiaozhi', name: '小智', providerVoice: 'zh-CN-YunxiaNeural' },
    { id: 'xiaowei', name: '小未', providerVoice: 'zh-CN-XiaoyiNeural' },
  ],
  phrases: [
    { id: 'p01', text: '占位语音一。这是壳功能预览，页面上的文字全部是占位内容。' },
    { id: 'p02', text: '占位语音二。请检查基础版式、留白和内容层级。' },
    { id: 'p03', text: '占位语音三。请检查卡片、表格和对比布局。' },
    { id: 'p04', text: '占位语音四。请检查代码块和流程图的显示。' },
    { id: 'p05', text: '占位语音五。请点击按钮，检查互动反馈。' },
    { id: 'p06', text: '占位语音六。请运行实验，观察数值和步骤变化。' },
    { id: 'p07', text: '占位语音七。请检查复盘、自查和总结区域。' },
    { id: 'p08', text: '占位语音八。请切换角色音色，确认四个占位语音都能播放。' },
  ],
  // One phrase per preview slide (30 slides). Length is checked at extraction
  // against the deck so a new slide cannot silently lose its narration.
  pagePhrases: [
    'p01', 'p02', 'p02', 'p03', 'p03', 'p03', 'p03', 'p04', 'p04', 'p04',
    'p02', 'p05', 'p05', 'p05', 'p05', 'p06', 'p06', 'p06', 'p06', 'p06',
    'p03', 'p06', 'p06', 'p05', 'p02', 'p05', 'p06', 'p07', 'p08', 'p07',
  ],
  // A short silent segment on hands-on pages exercises the pause branch of the
  // timeline without changing what the learner can do.
  pagePauses: {
    11: 1.2, 12: 1.2, 13: 1.2, 14: 1.2, 15: 1.2, 16: 1.2, 17: 1.2, 18: 1.2,
    19: 1.2, 21: 1.2, 22: 1.2, 23: 1.2, 25: 1.2, 26: 1.2, 28: 1.2,
  },
}
