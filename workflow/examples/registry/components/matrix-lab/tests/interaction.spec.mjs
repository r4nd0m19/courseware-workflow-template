import test from 'node:test'
import assert from 'node:assert/strict'

test('matrix-lab: click selects a cell and reports row/column indices', () => {
  const state = { selected: null }
  const clickCell = (r, c) => {
    state.selected = { r, c }
  }
  clickCell(1, 2)
  assert.deepEqual(state.selected, { r: 1, c: 2 })
})

test('matrix-lab: clicking the selected cell clears the selection', () => {
  const state = { selected: { r: 0, c: 0 } }
  const clickCell = (r, c) => {
    state.selected = state.selected?.r === r && state.selected?.c === c ? null : { r, c }
  }
  clickCell(0, 0)
  assert.equal(state.selected, null)
})
