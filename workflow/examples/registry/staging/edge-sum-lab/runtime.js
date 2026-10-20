// Example runtime for the registry fixture. Browser-native; no bundler.
(function () {
  function renderTable(values) {
    const rows = (values || [])
      .map(
        (row, r) =>
          `<tr>${row
            .map((value, c) => `<td data-row="${r}" data-col="${c}" tabindex="0">${value}</td>`)
            .join('')}</tr>`,
      )
      .join('')
    return `<div class="edge-sum-lab"><table role="grid"><tbody>${rows}</tbody></table><p class="edge-sum-feedback" aria-live="polite"></p></div>`
  }

  window.CoursewareComponents.register('edge-sum-lab', {
    render(s) {
      return renderTable(s.values)
    },
    bind(root, s) {
      const feedback = root.querySelector('.edge-sum-feedback')
      const cells = [...root.querySelectorAll('td[data-row]')]
      const edge = new Set()
      const total = (s.values || []).length - 1
      ;(s.values || []).forEach((row, r) =>
        row.forEach((_, c) => {
          if (r === 0 || c === 0 || r === total || c === row.length - 1) edge.add(`${r}:${c}`)
        }),
      )
      cells.forEach((cell) => {
        cell.addEventListener('click', () => {
          const on = cell.getAttribute('aria-selected') !== 'true'
          cell.setAttribute('aria-selected', on ? 'true' : 'false')
          if (feedback) feedback.textContent = on ? '已选中一个格子。' : '已取消选择。'
        })
      })
      if (feedback) feedback.textContent = '选择所有边界格子。'
    },
  })
})()
