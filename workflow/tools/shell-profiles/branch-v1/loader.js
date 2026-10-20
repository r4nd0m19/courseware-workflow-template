const shellData=window.COURSEWARE_SHELL_DATA||{};
const meta=Object.assign({
  brandMain:'C++',
  brandAccent:'互动课堂',
  lessonLabel:'',
  kicker:'智创学社 · 方块世界',
  endKicker:'智创学社 · 方块世界 · 探索完成',
  monitorTitle:'Lesson.cpp',
  endMonitorTitle:'本课收获',
  coverCode:'if (condition) {\n  choose();\n}',
  coverOutput:'condition → choice → action',
  endCode:'if (learned) {\n  create();\n}',
  endOutput:'See you next time!',
  recap:['会观察','会判断','会实践','会总结']
},shellData.meta||{});
const slides=Array.isArray(shellData.slides)?shellData.slides:[];
{
  let station=0,section=0;
  slides.forEach(slide=>{
    if(slide.type==='chapter'){station=Number((String(slide.station||'').match(/\d+/)||[0])[0]);section=0;}
    else if(slide.type!=='hero'&&slide.type!=='end')slide.section=`${station}.${++section}`;
  });
}
const chapterLabels=slides.filter(s=>s.type==='chapter').map(s=>s.title);
const chapterIndexes=slides.map((s,i)=>s.type==='chapter'?i:-1).filter(i=>i>=0);
