function shellArt(slot,fallback){
  const art=window.COURSEWARE_SHELL_ART?.[slot];
  if(!art)return fallback();
  const src=typeof art==='string'?art:art.src;
  const alt=typeof art==='string'?'':(art.alt||'');
  const blend=typeof art==='string'?'multiply':(art.blend||'multiply');
  const className=typeof art==='string'?'pixel-student generated-mascot':(art.className||'pixel-student generated-mascot');
  return `<img class="${esc(className)}" src="${esc(src)}" alt="${esc(alt)}" style="mix-blend-mode:${esc(blend)};object-fit:contain">`;
}
