import test from 'node:test'
import assert from 'node:assert/strict'

function edgeCells(rows, cols) {
  const cells = new Set()
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) cells.add(`${r},${c}`)
    }
  }
  return cells
}

test('edge-sum-lab: 3×3 has 8 unique edge cells (corners counted once)', () => {
  assert.equal(edgeCells(3, 3).size, 8)
})

test('edge-sum-lab: selected set equals edge set on success', () => {
  const target = edgeCells(3, 3)
  const selected = new Set(target)
  assert.deepEqual([...selected].sort(), [...target].sort())
})

test('edge-sum-lab: missing a corner cell is incorrect', () => {
  const target = edgeCells(3, 3)
  const selected = new Set(target)
  selected.delete('0,0')
  assert.notDeepEqual([...selected].sort(), [...target].sort())
})

test('edge-sum-lab: selecting all cells is incorrect', () => {
  const target = edgeCells(3, 3)
  const selected = new Set(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2', '2,0', '2,1', '2,2'])
  assert.notDeepEqual([...selected].sort(), [...target].sort())
})
