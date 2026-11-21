import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDiaryIndex, DIARY_INDEX_MAX_ENTRIES } from './diary-index.ts'

function day(index) {
  return {
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    level: index % 5,
    entryCount: 1,
    entries: [{ title: `标题 ${index}`, preview: `首行 ${index}` }]
  }
}

test('list pages are bounded and tell the caller where to continue', () => {
  const days = Array.from({ length: 30 }, (_, index) => day(index))
  const output = renderDiaryIndex('book', days, 1000, { budget: 5000 })
  assert.ok(output.length < 8000, `output was ${output.length} chars`)
  assert.match(output, /共 1000 天/)
  assert.match(output, /本页 \d+ 天/)
  assert.match(output, /before:"/)
})

test('one day cannot flood the index with every entry', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({ title: `条目 ${index}`, preview: '首行' }))
  const output = renderDiaryIndex('book', [{ date: '2026-11-22', entries, entryCount: 40 }], 1)
  assert.match(output, new RegExp(`等 40 条`))
  assert.doesNotMatch(output, /条目 39/)
  assert.equal(output.match(/条目 /g)?.length, DIARY_INDEX_MAX_ENTRIES)
})

test('marks on an empty day are visible without a body', () => {
  const output = renderDiaryIndex('book', [{ date: '2026-11-22', level: 4, entries: [], entryCount: 0 }], 1)
  assert.match(output, /贴花 4\/5/)
  assert.match(output, /（空）/)
})

test('an empty book is not rendered as a page', () => {
  assert.equal(renderDiaryIndex('book', [], 0), '日记簿还没有内容。')
})

test('a later page still reports the whole book and an exhausted window', () => {
  const page = renderDiaryIndex('book', [day(4), day(3)], 2, { total: 5, hasMore: true })
  assert.match(page, /共 5 天/)
  assert.match(page, /本页 2 天/)
  assert.match(page, /before:"/)

  const exhausted = renderDiaryIndex('book', [], 0, { total: 5 })
  assert.match(exhausted, /共 5 天/)
  assert.match(exhausted, /没有更早的日期/)
  assert.doesNotMatch(exhausted, /还没有内容/)
})
