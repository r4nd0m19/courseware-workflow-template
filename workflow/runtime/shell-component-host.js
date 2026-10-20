/* Shell component host: mounts registry components on declarative slides.
 *
 * Deck slide shape:
 *   { "type": "blank", "component": "quiz-bank", "props": { ... } }
 *
 * The shell renderer paints the page head and an empty body for `blank`; this
 * host fills the body with the registered component, then binds it inside the
 * same slide container. It is a deck-level adapter: the extracted shell source
 * stays untouched and components remain data-only in the deck.
 */
(function () {
  'use strict';

  const data = window.COURSEWARE_SHELL_DATA || {};
  const slides = Array.isArray(data.slides) ? data.slides : [];
  if (!slides.some((slide) => slide.component)) return;

  // lesson.js numbers every content slide under the last chapter. A deck with
  // no chapter slides has no station to number against, so drop that derived
  // field instead of labeling every page "0.1".
  if (!slides.some((slide) => slide.type === 'chapter')) {
    for (const slide of slides) {
      if (slide.type !== 'hero' && slide.type !== 'end') delete slide.section;
    }
  }

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));

  function slideTitle(slide) {
    return slide.section ? `${slide.section} ${slide.title}` : slide.title;
  }

  function mountComponentSlide() {
    const page = Number(document.querySelector('#slide')?.dataset.page || 0) - 1;
    const slide = slides[page];
    if (!slide || !slide.component) return;

    const inner = document.querySelector('#slide .slide-inner');
    if (!inner) return;

    const registry = window.CoursewareComponents;
    const component = registry && typeof registry.get === 'function' ? registry.get(slide.component) : null;
    const heading = `<div class="eyebrow">${escapeHtml(slide.eyebrow || '')}</div><h2>${escapeHtml(slideTitle(slide))}</h2>`;

    if (!component || typeof component.render !== 'function') {
      inner.innerHTML = `${heading}<div class="callout">组件 ${escapeHtml(slide.component)} 未注册，无法显示本页。</div>`;
      return;
    }

    const props = slide.props && typeof slide.props === 'object' ? slide.props : {};
    inner.innerHTML = heading + component.render(props);
    if (typeof component.bind === 'function') component.bind(inner, props);
    if (typeof window.fitLessonContent === 'function') window.fitLessonContent();
  }

  const baseRender = window.render;
  if (typeof baseRender !== 'function') return;

  window.render = function () {
    const result = baseRender.apply(this, arguments);
    mountComponentSlide();
    return result;
  };

  // lesson.js already painted once before this script loaded; repaint so the
  // first component page is mounted through the wrapper as well.
  window.render();
})();
