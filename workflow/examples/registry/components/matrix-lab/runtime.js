// Example runtime for the registry fixture. Browser-native; no bundler.
(function () {
  function renderMatrix(values) {
    const rows = (values || [])
      .map(
        (row, r) =>
          `<tr>${row
            .map((value, c) => `<td data-row="${r}" data-col="${c}" tabindex="0">${value}</td>`)
            .join('')}</tr>`,
      )
      .join('')
    return `<table class="matrix-lab" role="grid"><tbody>${rows}</tbody></table>`
  }

  window.CoursewareComponents.register('matrix-lab', {
    render(s) {
      return renderMatrix(s.values)
    },
    bind(root) {
      const table = root.querySelector('.matrix-lab')
      if (!table) return
      table.addEventListener('click', (event) => {
        const cell = event.target.closest('td[data-row]')
        if (!cell) return
        const selected = cell.getAttribute('aria-selected') === 'true'
        table.querySelectorAll('td[aria-selected="true"]').forEach((td) => {
          td.setAttribute('aria-selected', 'false')
        })
        cell.setAttribute('aria-selected', selected ? 'false' : 'true')
      })
      table.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.target.click()
        }
      })
    },
  })
})()
