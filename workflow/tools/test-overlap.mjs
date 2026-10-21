#!/usr/bin/env node
import { overlapSize, rectsOverlap } from './overlap-lib.mjs'

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL overlap geometry: ${message}`)
    process.exit(1)
  }
}

const a = { left: 0, top: 0, right: 100, bottom: 100 }
const b = { left: 90, top: 50, right: 200, bottom: 150 }
const size = overlapSize(a, b)
assert(size.width === 10 && size.height === 50, `unexpected overlap size ${JSON.stringify(size)}`)
assert(rectsOverlap(a, b), 'a 10x50 overlap must fail')

const far = { left: 120, top: 0, right: 200, bottom: 100 }
assert(!rectsOverlap(a, far), 'separated rectangles must pass')

const sliver = { left: 98, top: 0, right: 200, bottom: 100 }
assert(!rectsOverlap(a, sliver), 'a narrow 2px sliver must be tolerated')

console.log('OK overlap geometry')
