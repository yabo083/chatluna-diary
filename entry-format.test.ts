import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiaryDay, removeDiaryEntry, updateDiaryEntry } from './entry-format.ts'

const DAY = `# 2026-11-22

## 第一页
*2026-11-22 Sat 09:15*

第一段。

第二段。

## 第二页
*2026-11-22 Sat 22:00*

第二页正文。
`

test('parse keeps entries and bodies apart', () => {
  const parsed = parseDiaryDay(DAY)
  assert.equal(parsed.header.trim(), '# 2026-11-22')
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.entries[0].title, '第一页')
  assert.equal(parsed.entries[0].time, '2026-11-22 Sat 09:15')
  assert.equal(parsed.entries[0].body, '第一段。\n\n第二段。')
  assert.equal(parsed.entries[1].body, '第二页正文。')
})

test('update replaces one entry and preserves the other raw block', () => {
  const parsed = parseDiaryDay(DAY)
  const next = updateDiaryEntry(DAY, '2026-11-22', 0, '改过的第一页', '新的正文。')
  const reparsed = parseDiaryDay(next)
  assert.equal(reparsed.entries[0].title, '改过的第一页')
  assert.equal(reparsed.entries[0].time, '2026-11-22 Sat 09:15')
  assert.equal(reparsed.entries[0].body, '新的正文。')
  assert.equal(reparsed.entries[1].raw, parsed.entries[1].raw)
  assert.equal(reparsed.entries[1].body, '第二页正文。')
})

test('remove keeps the header and the remaining entries', () => {
  const next = removeDiaryEntry(DAY, '2026-11-22', 0)
  const reparsed = parseDiaryDay(next)
  assert.equal(reparsed.entries.length, 1)
  assert.equal(reparsed.entries[0].title, '第二页')
  assert.equal(reparsed.header.trim(), '# 2026-11-22')
})

test('empty day round-trips to a dated header', () => {
  const parsed = parseDiaryDay('# 2026-11-22\n')
  assert.deepEqual(parsed.entries, [])
  const next = removeDiaryEntry('# 2026-11-22\n\n## 只剩一页\n*2026-11-22 Sat 10:00*\n\n正文。\n', '2026-11-22', 0)
  assert.equal(parseDiaryDay(next).entries.length, 0)
  assert.equal(next.trim(), '# 2026-11-22')
})

test('bad indexes are rejected', () => {
  assert.throws(() => updateDiaryEntry(DAY, '2026-11-22', 9, 'x', 'y'), RangeError)
  assert.throws(() => removeDiaryEntry(DAY, '2026-11-22', -1), RangeError)
})
