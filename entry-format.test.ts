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

test('body headings and fenced examples do not split an entry', () => {
  const source = `# 2026-11-22

## 真正的标题
*2026-11-22 Sat 09:15*

开头。

## 正文里的小节

内容。

\`\`\`md
## 代码示例
\`\`\`

结尾。
`
  const parsed = parseDiaryDay(source)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].title, '真正的标题')
  assert.match(parsed.entries[0].body, /## 正文里的小节/)
  assert.match(parsed.entries[0].body, /## 代码示例/)
})

test('CRLF days parse the byline and body', () => {
  const parsed = parseDiaryDay('# 2026-11-22\r\n\r\n## 标题\r\n*2026-11-22 Sat 09:15*\r\n\r\n正文。\r\n')
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].time, '2026-11-22 Sat 09:15')
  assert.equal(parsed.entries[0].body, '正文。')
})
