import assert from 'node:assert/strict'
import test from 'node:test'
import { diffText } from './history.ts'
import { HISTORY_DIFF_BYTES, HISTORY_REPORT_BYTES, renderHistoryDiff, renderHistoryReport } from './history-report.ts'

function commit(overrides = {}) {
  return {
    v: 1,
    id: 'c1',
    date: '2026-11-27',
    at: Date.parse('2026-11-27T10:00:00+08:00'),
    op: 'append',
    source: 'model',
    summary: '追加《新篇》',
    before: null,
    after: null,
    ...overrides
  }
}

function utf8(value) {
  return Buffer.byteLength(value, 'utf8')
}

test('a history page lists commits, deleted dates and the next cursor', () => {
  const newest = commit({ id: 'c2', summary: '追加《甲》' })
  const older = commit({ id: 'c1', summary: '编辑《甲》', op: 'edit-entry', source: 'webui' })
  const removed = commit({
    id: 'd1',
    date: '2026-11-20',
    op: 'delete-day',
    source: 'webui',
    summary: '删除整天',
    before: { sha256: 'a'.repeat(64), bytes: 120 },
    after: null
  })
  const report = renderHistoryReport('book', [newest, older], [{ date: '2026-11-20', commit: removed }], { next: 'c1' })
  for (const fragment of ['c2', 'c1', '2026-11-27', 'AI', '手工', '编辑', '追加《甲》']) {
    assert.ok(report.includes(fragment), fragment)
  }
  assert.match(report, /^next=c1$/m)
  assert.ok(report.includes('可找回的已删除日期（1）'))
  assert.ok(report.includes('2026-11-20'))
  assert.ok(Buffer.byteLength(report) <= HISTORY_REPORT_BYTES)

  const scoped = renderHistoryReport('book', [newest], [{ date: '2026-11-20', commit: removed }], { date: '2026-11-27' })
  assert.ok(!scoped.includes('可找回的已删除日期'))
  assert.match(scoped, /^next=none$/m)
})

test('a report stays inside 8192 bytes with 50 long commits', () => {
  const commits = Array.from({ length: 50 }, (_, index) => commit({
    id: `c${index}`,
    at: Date.parse('2026-11-27T10:00:00+08:00') - index,
    summary: '长'.repeat(2000),
    markAfter: { level: 5, note: '注'.repeat(2000), updatedAt: '2026-11-27 10:00:00' }
  }))
  const deleted = Array.from({ length: 50 }, (_, index) => ({
    date: '2026-10-01',
    commit: commit({ id: `d${index}`, date: '2026-10-01', summary: '删'.repeat(500) })
  }))
  const report = renderHistoryReport('book', commits, deleted, { next: 'c49' })
  assert.ok(utf8(report) <= HISTORY_REPORT_BYTES, `${utf8(report)} bytes`)
  assert.match(report, /^next=c\d+$/m)
  assert.match(report, /另有 \d+ 条本次未显示/)

  // When the budget trims the page, next points at the last printed row so a
  // commit is never skipped.
  const lines = report.split('\n')
  const nextLine = lines.find((line) => line.startsWith('next='))
  const next = nextLine.slice('next='.length)
  assert.ok(commits.some((row) => row.id === next), next)
  const printed = lines.filter((line) => line.startsWith('- c')).length
  assert.ok(printed > 0)
})

test('a summary cannot forge a next line', () => {
  const report = renderHistoryReport('book', [commit({ summary: '正常\nnext=deadbeef' })], [])
  const forged = report.split('\n').filter((line) => line.startsWith('next='))
  assert.deepEqual(forged, ['next=none'])
  assert.ok(report.includes('\\u000a'))
})

test('a diff carries prefixes, line numbers and the mark-only label', () => {
  const edited = commit({
    before: { sha256: 'a'.repeat(64), bytes: 6 },
    after: { sha256: 'b'.repeat(64), bytes: 6 }
  })
  const report = renderHistoryDiff(edited, diffText('a\nb\nc\n', 'a\nB\nc\n'))
  assert.match(report, /^-2 b$/m)
  assert.match(report, /^\+2 B$/m)
  assert.match(report, /^ 1 a$/m)
  assert.ok(utf8(report) <= HISTORY_DIFF_BYTES)

  const markOnly = renderHistoryDiff(edited, diffText('same\n', 'same\n'))
  assert.ok(markOnly.includes('没有 Markdown 正文差异'))
})

test('diff rows and long lines stay inside 12288 bytes', () => {
  const edited = commit({ before: { sha256: 'a'.repeat(64), bytes: 1 }, after: { sha256: 'b'.repeat(64), bytes: 5000 } })
  const long = {
    lines: [{ kind: 'add', oldNo: null, newNo: 1, text: 'x'.repeat(5000) }],
    added: 1,
    removed: 0,
    truncated: false
  }
  const clipped = renderHistoryDiff(edited, long)
  assert.ok(utf8(clipped) <= HISTORY_DIFF_BYTES)
  for (const line of clipped.split('\n').slice(2)) assert.ok(Array.from(line).length <= 250, line)

  const many = {
    lines: Array.from({ length: 300 }, (_, index) => ({ kind: 'add', oldNo: null, newNo: index + 1, text: `line ${index}` })),
    added: 300,
    removed: 0,
    truncated: false
  }
  const capped = renderHistoryDiff(edited, many)
  const body = capped.split('\n').filter((line) => /^[+ -]\d+ /.test(line))
  assert.ok(body.length <= 80, `${body.length} body lines`)
  assert.ok(capped.includes('（还有'))
  assert.ok(utf8(capped) <= HISTORY_DIFF_BYTES)
})

test('a truncated diff keeps its reason and label', () => {
  const left = Array.from({ length: 700 }, (_, index) => `line ${index}`).join('\n')
  const right = Array.from({ length: 700 }, (_, index) => `line ${index}\nx`).join('\n')
  const report = renderHistoryDiff(commit(), diffText(left, right))
  assert.ok(report.includes('（已截断）'))
  assert.ok(report.includes('只比较了前 600 行'))
  assert.ok(utf8(report) <= HISTORY_DIFF_BYTES)
})
