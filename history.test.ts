import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendCommit,
  compactHistory,
  deletedDays,
  diffText,
  hashContent,
  listCommits,
  readCommits,
  readDayState,
  readSnapshot,
  revisionOf
} from './history.ts'

const roots: string[] = []

async function book() {
  const root = await mkdtemp('/tmp/chatluna-diary-history-')
  roots.push(root)
  return root
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

const day = (text) => ({ exists: true, content: text })
const absent = { exists: false, content: '' }

test('a commit stores both sides once and lists newest first', async () => {
  const root = await book()
  const before = day('# 2026-11-27\n\n旧稿\n')
  const after = day('# 2026-11-27\n\n旧稿\n\n## 新篇\n\n正文\n')
  await appendCommit(root, {
    date: '2026-11-27',
    op: 'append',
    source: 'model',
    summary: '追加《新篇》',
    title: '新篇',
    before,
    after
  })
  await appendCommit(root, {
    date: '2026-11-26',
    op: 'delete-day',
    source: 'webui',
    summary: '删除整天',
    before: day('# 2026-11-26\n\n要删的\n'),
    after: absent,
    markBefore: { level: 3, updatedAt: '2026-11-26 22:00:00' },
    markAfter: null
  })
  const rows = await readCommits(root)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].date, '2026-11-27')
  assert.equal(rows[0].before?.sha256, hashContent(Buffer.from(before.content)))
  assert.equal(rows[0].after?.sha256, hashContent(Buffer.from(after.content)))
  assert.equal(await readSnapshot(root, rows[0].after!), after.content)
  assert.equal(rows[1].after, null)
  assert.equal(rows[1].markAfter, null)
  const page = await listCommits(root, { date: '2026-11-26' })
  assert.equal(page.rows.length, 1)
  assert.equal(page.hasMore, false)
  const pages = await listCommits(root, { limit: 1 })
  assert.equal(pages.rows.length, 1)
  assert.equal(pages.hasMore, true)
})

test('a deleted date is recoverable even though the day file is gone', async () => {
  const root = await book()
  await appendCommit(root, {
    date: '2026-11-20',
    op: 'delete-day',
    source: 'webui',
    summary: '删除整天',
    before: day('# 2026-11-20\n\n不想丢\n'),
    after: absent
  })
  const rows = await readCommits(root)
  const deleted = deletedDays(rows, new Set())
  assert.equal(deleted.length, 1)
  assert.equal(deleted[0].date, '2026-11-20')
  assert.equal(await readSnapshot(root, deleted[0].commit.before!), '# 2026-11-20\n\n不想丢\n')
  assert.equal(deletedDays(rows, new Set(['2026-11-20'])).length, 0)
})

test('missing and empty days stay different states', async () => {
  const root = await book()
  assert.equal((await readDayState(root, '2026-01-01')).exists, false)
  await writeFile(join(root, '2026-01-01.md'), '')
  const empty = await readDayState(root, '2026-01-01')
  assert.equal(empty.exists, true)
  assert.equal(empty.content, '')
  assert.equal(revisionOf(empty), hashContent(Buffer.from('')).slice(0, 16))
  assert.equal(revisionOf(absent), null)
})

test('compaction keeps the newest 64 commits of a day and drops orphan objects', async () => {
  const root = await book()
  for (let index = 0; index < 70; index += 1) {
    await appendCommit(root, {
      date: '2026-11-01',
      op: 'edit-entry',
      source: 'webui',
      summary: `第 ${index} 次`,
      before: day(`old ${index}\n`),
      after: day(`new ${index}\n`)
    })
  }
  const compacted = await compactHistory(root)
  assert.equal(compacted.commits, 64)
  const rows = await readCommits(root)
  assert.equal(rows.length, 64)
  assert.equal(rows[63].summary, '第 69 次')
  const objects = await readdir(join(root, '.history', 'objects'))
  assert.equal(objects.length, new Set(rows.flatMap((row) => [row.before?.sha256, row.after?.sha256]).filter(Boolean)).size)
})

test('a torn last line is ignored, not treated as an empty history', async () => {
  const root = await book()
  await appendCommit(root, {
    date: '2026-11-02',
    op: 'append',
    source: 'model',
    summary: '完好',
    before: absent,
    after: day('# 2026-11-02\n')
  })
  await writeFile(join(root, '.history', 'commits.jsonl'), `${await readFile(join(root, '.history', 'commits.jsonl'), 'utf8')}{"v":1,`)
  const rows = await readCommits(root)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].summary, '完好')
})

test('unified diff counts inserts, deletes and truncates large inputs', () => {
  const simple = diffText('a\nb\nc\n', 'a\nB\nc\n')
  assert.equal(simple.added, 1)
  assert.equal(simple.removed, 1)
  assert.deepEqual(simple.lines.map((line) => line.kind).slice(0, 4), ['context', 'del', 'add', 'context'])
  assert.equal(simple.truncated, false)

  const left = Array.from({ length: 700 }, (_, index) => `line ${index}`).join('\n')
  const right = Array.from({ length: 700 }, (_, index) => `line ${index}\nx`).join('\n')
  const large = diffText(left, right)
  assert.equal(large.truncated, true)
  assert.ok(large.lines.length <= 400)
  assert.match(large.reason ?? '', /600/)
})

test('a mark-only commit is not a recoverable deleted date', async () => {
  const root = await book()
  await appendCommit(root, {
    date: '2026-10-01',
    op: 'delete-day',
    source: 'webui',
    summary: '删除整天',
    before: day('# 2026-10-01\n\n正文\n'),
    after: absent,
    markBefore: null,
    markAfter: null
  })
  await appendCommit(root, {
    date: '2026-10-01',
    op: 'mark',
    source: 'webui',
    summary: '贴花 3/5',
    before: absent,
    after: absent,
    markBefore: null,
    markAfter: { level: 3, updatedAt: '2026-10-02 10:00:00' }
  })
  const rows = await readCommits(root)
  const deleted = deletedDays(rows, new Set())
  assert.equal(deleted.length, 1)
  assert.equal(deleted[0].commit.op, 'delete-day')

  const markOnly = await book()
  await appendCommit(markOnly, {
    date: '2026-10-02',
    op: 'mark',
    source: 'webui',
    summary: '贴花 3/5',
    before: absent,
    after: absent,
    markBefore: null,
    markAfter: { level: 3, updatedAt: '2026-10-02 10:00:00' }
  })
  assert.equal(deletedDays(await readCommits(markOnly), new Set()).length, 0)
})
