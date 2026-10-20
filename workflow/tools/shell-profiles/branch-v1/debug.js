window.COURSEWARE_DEBUG={types:()=>slides.map(s=>s.type),go:i=>{index=Math.max(0,Math.min(slides.length-1,Number(i)||0));render();},shell:meta,get index(){return index;}};
// Host wiring for components that ask the lesson to jump (e.g. matrix-lab's 回看 button).
window.addEventListener('courseware:navigate',event=>{const target=(event.detail||{}).targetSlide;const next=slides.findIndex(s=>s.id===target);if(next>=0&&next!==index){index=next;render();}});
