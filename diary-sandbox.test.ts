import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const repo = dirname(fileURLToPath(import.meta.url))
const scratch = await mkdtemp('/tmp/chatluna-diary-test-')
const stub = join(scratch, 'stubs')
await mkdir(stub, { recursive: true })

const stubs = {
  'schema.ts': `class Builder { optional(){return this} required(){return this} default(){return this} label(){return this} description(){return this} min(){return this} max(){return this} role(){return this} collapse(){return this} }\nconst builder = () => new Builder()\nexport const Schema = { object: builder, boolean: builder, string: builder, number: builder, union: builder, array: builder, const: builder }\n`,
  'tool.ts': `export const defineTool = (definition) => definition\n`,
  'server.ts': `export class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }\n`,
  'utils.ts': `import { fileURLToPath } from 'node:url'\nconst pad = (value) => String(value).padStart(2, '0')\nexport function localTime(ts) { const d = new Date(ts); return \`\${d.getFullYear()}-\${pad(d.getMonth()+1)}-\${pad(d.getDate())} \${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}\` }\nexport function resolveFromBaseUrl(baseUrl, path) { return fileURLToPath(new URL(path, baseUrl)) }\n`
}
for (const [name, body] of Object.entries(stubs)) await writeFile(join(stub, name), body)

const schemaUrl = pathToFileURL(join(stub, 'schema.ts')).href
const toolUrl = pathToFileURL(join(stub, 'tool.ts')).href
const serverUrl = pathToFileURL(join(stub, 'server.ts')).href
const utilsUrl = pathToFileURL(join(stub, 'utils.ts')).href

let source = await readFile(join(repo, 'index.ts'), 'utf8')
source = source
  .replaceAll(`from '@chatluna/schema'`, `from ${JSON.stringify(schemaUrl)}`)
  .replaceAll(`from '@chatluna/tool'`, `from ${JSON.stringify(toolUrl)}`)
  .replaceAll(`from '@chatluna/server'`, `from ${JSON.stringify(serverUrl)}`)
  .replaceAll(`from '@chatluna/utils'`, `from ${JSON.stringify(utilsUrl)}`)
  .replaceAll(/from '(\.[^']+)'/g, (_, spec) => `from ${JSON.stringify(pathToFileURL(join(repo, spec)).href)}`)
source += `\nexport const __test = { readTool, createManageTool, diaryIndex, formatBook, removeDays, exportDays, readDay, readMarks, writeMarks, collectDayMessages, writeEntry, updateEntry, removeEntry, removeDay, restoreCommit, setMark, removeMark, readCommits, readSnapshot, revisionOf, deletedDays }\n`
const generated = join(scratch, 'index.ts')
await writeFile(generated, source)
// Runtime-selected generated module: the test rewrites @chatluna imports to
// stubs before loading, so a static import cannot express this boundary.
const S = (await import(pathToFileURL(generated).href)).__test

after(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function ctxFor(root, extra = {}) {
  return {
    baseUrl: pathToFileURL(root + '/').href,
    logger: { info() {}, warn() {} },
    get(name) { return extra[name] },
    ...extra
  }
}

function dateAt(offset) {
  return new Date(Date.UTC(2020, 0, 1 + offset)).toISOString().slice(0, 10)
}

async function makeBook(root, preset) {
  const dir = join(root, 'data/chatluna/diary', preset)
  await mkdir(dir, { recursive: true })
  return dir
}

async function addDays(root, preset, count, size = 40) {
  const dir = await makeBook(root, preset)
  const body = 'x'.repeat(size)
  for (let index = 0; index < count; index += 1) {
    const date = dateAt(index)
    await writeFile(join(dir, `${date}.md`), `# ${date}\n\n## 测试 ${index}\n*2020-01-01 Wed 10:00*\n\n${body}\n`)
  }
  return dir
}

test('diary_read list paginates and reports the whole book', async () => {
  const root = await mkdtemp(join(scratch, 'list-'))
  const dir = await addDays(root, 'list', 120, 80)
  await writeFile(join(dir, '2020-02-02.md'), '# 2020-02-02\n\n' + 'Y'.repeat(1024 * 1024 + 1))
  await writeFile(join(dir, '2020-02-03.md'), Buffer.alloc(1024 * 1024, 'Z'))
  await writeFile(join(dir, 'marks.json'), JSON.stringify({ version: 1, marks: { '2019-12-31': { level: 3, updatedAt: 'x' } } }))
  const ctx = ctxFor(root)
  const first = await S.diaryIndex(ctx, 'list', undefined, 30)
  assert.ok(first.length < 24_000)
  assert.match(first, /共 121 天/)
  assert.match(first, /本页 30 天/)
  assert.match(first, /before:"/)
  const page = await S.diaryIndex(ctx, 'list', '2020-02-05', 10)
  assert.match(page, /文件过大/)
  const old = await S.diaryIndex(ctx, 'list', '2019-01-01', 30)
  assert.match(old, /共 121 天/)
  assert.match(old, /没有更早的日期/)
  assert.doesNotMatch(old, /还没有内容/)
})

test('readDay accepts exactly 1 MiB and rejects one byte over', async () => {
  const root = await mkdtemp(join(scratch, 'read-'))
  const dir = await makeBook(root, 'default')
  await writeFile(join(dir, '2020-01-01.md'), Buffer.alloc(1024 * 1024, 'A'))
  await writeFile(join(dir, '2020-01-02.md'), Buffer.alloc(1024 * 1024 + 1, 'A'))
  const ctx = ctxFor(root)
  assert.equal(Buffer.byteLength(await S.readDay(ctx, 'default', '2020-01-01')), 1024 * 1024)
  await assert.rejects(S.readDay(ctx, 'default', '2020-01-02'), /exceeds 1048576 bytes/)
})

test('format picks up a date created during its scan and skips oversized days', async () => {
  const root = await mkdtemp(join(scratch, 'format-'))
  const dir = await addDays(root, 'fmt', 200, 10)
  await writeFile(join(dir, '2021-01-01.md'), '# 2021-01-01\n\n' + 'Q'.repeat(1024 * 1024 + 1))
  await writeFile(join(dir, '2021-01-02.md'), '# 2021-01-02\n\n第一行  \n第二行\n\n```md\n## 代码标题\n\n空行\n```\n')
  // Integration boundary: a real concurrent fs write is what triggers the
  // late-date pass; deterministic timers cannot inject this fs interleaving.
  setTimeout(() => { void writeFile(join(dir, '2021-01-03.md'), '晚到的正文\n') }, 0)
  const result = await S.formatBook(ctxFor(root), 'fmt')
  assert.equal(result.skipped, 1)
  assert.equal(result.pending, 0)
  assert.ok(result.dates.includes('2021-01-03'))
  assert.match(await readFile(join(dir, '2021-01-03.md'), 'utf8'), /^# 2021-01-03/)
  assert.match(await readFile(join(dir, '2021-01-02.md'), 'utf8'), /## 代码标题/)
})

test('delete is idempotent and converges after an unlink failure', async () => {
  const root = await mkdtemp(join(scratch, 'delete-'))
  const dir = await addDays(root, 'del', 120, 20)
  await writeFile(join(dir, 'marks.json'), JSON.stringify({ version: 1, marks: { '2020-01-01': { level: 2, updatedAt: 'x' } } }))
  const dates = Array.from({ length: 120 }, (_, index) => dateAt(index))
  const result = await S.removeDays(ctxFor(root), 'del', dates)
  assert.deepEqual(result.removed, dates)
  assert.deepEqual((await readdir(dir)).sort(), ['.history', 'marks.json'])
  const delHistory = await S.readCommits(dir)
  assert.equal(delHistory.length, 120)
  assert.ok(delHistory.every((commit) => commit.op === 'delete-day' && commit.after === null))
  const absent = await S.removeDays(ctxFor(root), 'del', ['2099-01-01'])
  assert.deepEqual(absent.absent, ['2099-01-01'])

  const risk = await makeBook(root, 'risk')
  await writeFile(join(risk, '2020-01-01.md'), '# 2020-01-01\n\n正文\n')
  await mkdir(join(risk, '2020-01-02.md'))
  await writeFile(join(risk, 'marks.json'), JSON.stringify({ version: 1, marks: { '2020-01-01': { level: 1, updatedAt: 'x' }, '2020-01-02': { level: 2, updatedAt: 'x' } } }))
  await assert.rejects(S.removeDays(ctxFor(root), 'risk', ['2020-01-01', '2020-01-02']), /EISDIR/)
  // History is written before anything is unlinked, so the failed batch left
  // both marks and the readable day in place; removing the directory lets the
  // same batch finish, and the next call reports both dates as absent.
  const history = await S.readCommits(risk)
  assert.ok(history.some((commit) => commit.date === '2020-01-01' && commit.before?.sha256))
  await rm(join(risk, '2020-01-02.md'), { recursive: true })
  const retry = await S.removeDays(ctxFor(root), 'risk', ['2020-01-01', '2020-01-02'])
  assert.deepEqual(retry.removed, ['2020-01-01', '2020-01-02'])
  const settled = await S.removeDays(ctxFor(root), 'risk', ['2020-01-01', '2020-01-02'])
  assert.deepEqual(settled.removed, [])
  assert.deepEqual(settled.absent, ['2020-01-01', '2020-01-02'])
})

test('export obeys both char and byte budgets', async () => {
  const root = await mkdtemp(join(scratch, 'export-'))
  await addDays(root, 'exp', 120, 1024)
  const dates = Array.from({ length: 120 }, (_, index) => dateAt(index))
  const full = await S.exportDays(ctxFor(root), 'exp', dates)
  assert.ok(full.content.length > 100_000)
  await assert.rejects(S.exportDays(ctxFor(root), 'exp', dates, 48_000), /size limit/)
  const big = await makeBook(root, 'big')
  for (let index = 0; index < 2; index += 1) {
    const date = dateAt(index)
    await writeFile(join(big, `${date}.md`), `# ${date}\n\n` + 'B'.repeat(40_000))
  }
  await assert.rejects(S.exportDays(ctxFor(root), 'big', [dateAt(0), dateAt(1)], Infinity, 50_000), /size limit/)
})

test('context stops at the retained-message cap and at a short deadline', async () => {
  const root = await mkdtemp(join(scratch, 'context-'))
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: `s-${index}`,
    preset: 'default',
    conversationKey: `web:user:${index}`,
    origin: 'message',
    messageCount: 2000,
    lastActiveAt: Date.now()
  }))
  let active = 0
  let peak = 0
  const makeView = (delay) => ({
    read: async () => {
      active += 1
      peak = Math.max(peak, active)
      // Integration boundary: the code compares against real Date.now() inside
      // a Promise.race, so a real short delay is the behavior under test.
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      active -= 1
      return Array.from({ length: 200 }, (_, i) => ({
        time: Date.now(),
        kind: 'message',
        message: { id: `${Math.random()}-${i}`, role: 'user', content: [{ type: 'text', text: '消息' }] }
      }))
    }
  })
  const capCtx = ctxFor(root, {
    conversations: { list: async () => ({ rows, next: undefined }) },
    sessions: { view: async () => makeView(0) },
    presets: { list: () => [{ id: 'default', name: '默认' }] }
  })
  const capped = await S.collectDayMessages(capCtx, 'default', date)
  assert.equal(capped.messages.length, 2000)
  assert.equal(capped.truncated, true)
  assert.ok(peak <= 8)

  active = 0
  peak = 0
  const slowCtx = ctxFor(root, {
    conversations: { list: async () => ({ rows, next: undefined }) },
    sessions: { view: async () => makeView(100) },
    presets: { list: () => [{ id: 'default', name: '默认' }] }
  })
  const started = performance.now()
  const timed = await S.collectDayMessages(slowCtx, 'default', date, 20)
  assert.equal(timed.truncated, true)
  assert.ok(performance.now() - started < 500)
  assert.ok(peak <= 8)
  // Let the in-flight page reads observe cancellation and decrement.
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(active, 0)
})

test('oversized marks are ignored on read and quarantined on repair', async () => {
  const root = await mkdtemp(join(scratch, 'marks-'))
  const dir = await makeBook(root, 'marks')
  await writeFile(join(dir, 'marks.json'), 'x'.repeat(1024 * 1024 + 1))
  const ctx = ctxFor(root)
  assert.deepEqual(await S.readMarks(ctx, 'marks'), {})
  assert.deepEqual(await S.readMarks(ctx, 'marks', true), {})
  assert.ok((await readdir(dir)).some((name) => name.startsWith('marks.json.corrupt-')))
})

function toolCall(ctx, preset) {
  return {
    caller: ctx,
    actor: { platform: 'webui', user: 'web-test' },
    agent: { options: { presetId: preset } }
  }
}

function rawCommit(overrides = {}) {
  return {
    v: 1,
    id: 'c1',
    date: '2020-05-01',
    at: 1_600_000_000_000,
    op: 'append',
    source: 'model',
    summary: '追加',
    before: null,
    after: null,
    ...overrides
  }
}

async function writeCommits(dir, rows) {
  const history = join(dir, '.history')
  await mkdir(history, { recursive: true })
  await writeFile(join(history, 'commits.jsonl'), rows.map((row) => `${JSON.stringify(row)}\n`).join(''))
}

test('diary_read history pages by commit id with a same-ms tie-break', async () => {
  const root = await mkdtemp(join(scratch, 'tool-history-'))
  const dir = await makeBook(root, 'paging')
  await writeCommits(dir, [
    rawCommit({ id: 'b', at: 1000 }),
    rawCommit({ id: 'a', at: 1000 }),
    rawCommit({ id: 'c', at: 1000 })
  ])
  const ctx = ctxFor(root, { chatluna_webui: { refresh() {} } })
  const call = toolCall(ctx, 'paging')

  const first = await S.readTool.run({ action: 'history', historyLimit: 2 }, call)
  assert.match(first, /^- a /m)
  assert.match(first, /^- b /m)
  assert.match(first, /^next=b$/m)
  assert.equal(first.split('\n').filter((line) => line.startsWith('- c ')).length, 0)

  const second = await S.readTool.run({ action: 'history', historyLimit: 2, cursor: 'b' }, call)
  assert.match(second, /^- c /m)
  assert.match(second, /^next=none$/m)

  await assert.rejects(
    S.readTool.run({ action: 'history', cursor: 'nope' }, call),
    (error) => error.code === 'INVALID_ARGUMENT'
  )
})

test('diary_read history_diff returns a bounded diff and NOT_FOUND for unknown ids', async () => {
  const root = await mkdtemp(join(scratch, 'tool-diff-'))
  const dir = await makeBook(root, 'diff')
  const ctx = ctxFor(root, { chatluna_webui: { refresh() {} } })
  const call = toolCall(ctx, 'diff')
  await S.writeEntry(ctx, 'diff', { date: '2020-06-01', title: '甲', body: '第一版正文' }, true, undefined, 'webui')
  await S.updateEntry(ctx, 'diff', '2020-06-01', 0, { title: '甲', body: '第二版正文' }, {}, 'webui')
  const edit = (await S.readCommits(dir)).at(-1)

  const text = await S.readTool.run({ action: 'history_diff', id: edit.id }, call)
  assert.ok(text.includes('历史差异'))
  assert.match(text, /^\+/m)
  assert.ok(text.includes('第二版正文'))

  await assert.rejects(
    S.readTool.run({ action: 'history_diff', id: 'missing' }, call),
    (error) => error.code === 'NOT_FOUND'
  )
})

test('diary_manage restore is guarded by both content and marks', async () => {
  const root = await mkdtemp(join(scratch, 'tool-restore-'))
  const dir = await makeBook(root, 'restore-tool')
  const ctx = ctxFor(root, { chatluna_webui: { refresh() {} } })
  const call = toolCall(ctx, 'restore-tool')
  const manage = S.createManageTool()

  await S.writeEntry(ctx, 'restore-tool', { date: '2020-07-01', title: '丙', body: '正文' }, true, undefined, 'webui')
  await S.setMark(ctx, 'restore-tool', { date: '2020-07-01', level: 3, note: '重要' }, 'webui')
  await S.setMark(ctx, 'restore-tool', { date: '2020-07-01', level: 5, note: '更重要' }, 'webui')
  const mark5 = (await S.readCommits(dir)).at(-1)

  const message = await manage.run({ action: 'restore', id: mark5.id, side: 'before' }, call)
  assert.ok(message.includes('2020-07-01'))
  assert.equal((await S.readMarks(ctx, 'restore-tool'))['2020-07-01'].level, 3)

  // The same commit is no longer the newest mark state of that day.
  await assert.rejects(
    manage.run({ action: 'restore', id: mark5.id, side: 'before' }, call),
    (error) => error.code === 'CONFLICT'
  )

  // Content guard: only the newest edit's opposite side may be applied.
  await S.writeEntry(ctx, 'restore-tool', { date: '2020-07-02', title: '丁', body: '第一版' }, true, undefined, 'webui')
  const created = (await S.readCommits(dir)).at(-1)
  await S.updateEntry(ctx, 'restore-tool', '2020-07-02', 0, { title: '丁', body: '第二版' }, {}, 'webui')
  await assert.rejects(
    manage.run({ action: 'restore', id: created.id, side: 'before' }, call),
    (error) => error.code === 'CONFLICT'
  )

  // A corrupt marks file refuses the restore instead of reading as empty.
  await writeFile(join(dir, 'marks.json'), '{')
  await assert.rejects(
    manage.run({ action: 'restore', id: mark5.id, side: 'before' }, call),
    (error) => error.code === 'CONFLICT' && /unreadable/.test(error.message)
  )
})

test('history and restore reject scheduled callers', async () => {
  const root = await mkdtemp(join(scratch, 'tool-schedule-'))
  const dir = await makeBook(root, 'scheduled')
  const ctx = ctxFor(root, {
    chatluna_webui: { refresh() {} },
    schedule: { list: () => [{ id: 'job1', owner: { id: 'chatluna-diary' }, key: 'chatluna-diary:scheduled' }] }
  })
  const call = {
    caller: ctx,
    actor: { platform: 'webui', user: 'web-test' },
    agentId: 'schedule:job1',
    agent: { options: { participantId: 'schedule:job1', presetId: 'scheduled' } }
  }
  await S.writeEntry(ctx, 'scheduled', { date: '2020-08-01', title: '戊', body: '正文' }, true, undefined, 'webui')
  const created = (await S.readCommits(dir)).at(-1)

  await assert.rejects(S.readTool.run({ action: 'history' }, call), (error) => error.code === 'FORBIDDEN')
  await assert.rejects(
    S.readTool.run({ action: 'history_diff', id: created.id }, call),
    (error) => error.code === 'FORBIDDEN'
  )
  const manage = S.createManageTool()
  await assert.rejects(
    manage.run({ action: 'restore', id: created.id, side: 'before' }, call),
    (error) => error.code === 'FORBIDDEN'
  )
})

test('a deleted day, its text and its mark are recoverable from history', async () => {
  const root = await mkdtemp(join(scratch, 'history-delete-'))
  const dir = await makeBook(root, 'restore')
  const ctx = ctxFor(root)
  const file = join(dir, '2020-03-01.md')
  await S.writeEntry(ctx, 'restore', { date: '2020-03-01', title: '甲', body: '第一版正文' }, true, undefined, 'webui')
  await S.setMark(ctx, 'restore', { date: '2020-03-01', level: 4, note: '重要' }, 'webui')
  const original = await readFile(file, 'utf8')
  await S.removeDay(ctx, 'restore', '2020-03-01', undefined, 'webui')
  assert.equal(await S.readDay(ctx, 'restore', '2020-03-01'), '')

  const rows = await S.readCommits(dir)
  const deletion = rows[rows.length - 1]
  assert.equal(deletion.op, 'delete-day')
  assert.equal((await S.deletedDays(rows, new Set())).length, 1)

  const restored = await S.restoreCommit(ctx, 'restore', deletion.id, 'before', null, 'webui')
  assert.equal(restored.changed, true)
  assert.equal(await readFile(file, 'utf8'), original)
  const marks = await S.readMarks(ctx, 'restore')
  assert.equal(marks['2020-03-01'].level, 4)
  const after = await S.readCommits(dir)
  assert.equal(after[after.length - 1].op, 'restore')
  assert.equal(after[after.length - 1].restoredFrom, deletion.id)
})

test('an edit is restorable to before and after, with a revision guard', async () => {
  const root = await mkdtemp(join(scratch, 'history-edit-'))
  const dir = await makeBook(root, 'edit')
  const ctx = ctxFor(root)
  await S.writeEntry(ctx, 'edit', { date: '2020-04-02', title: '乙', body: '旧正文' }, true, undefined, 'webui')
  const first = (await S.readCommits(dir))[0]
  await S.updateEntry(ctx, 'edit', '2020-04-02', 0, { title: '乙', body: '新正文' }, {}, 'webui')
  const edit = (await S.readCommits(dir)).at(-1)
  assert.equal(edit.op, 'edit-entry')

  const current = await readFile(join(dir, '2020-04-02.md'), 'utf8')
  await assert.rejects(
    S.restoreCommit(ctx, 'edit', edit.id, 'before', 'deadbeef', 'webui'),
    (error) => error.code === 'CONFLICT'
  )
  const back = await S.restoreCommit(ctx, 'edit', edit.id, 'before', S.revisionOf({ exists: true, content: current }), 'webui')
  assert.equal(back.changed, true)
  assert.match(await readFile(join(dir, '2020-04-02.md'), 'utf8'), /旧正文/)
  const forwardRevision = S.revisionOf({ exists: true, content: await readFile(join(dir, '2020-04-02.md'), 'utf8') })
  const forward = await S.restoreCommit(ctx, 'edit', first.id, 'after', forwardRevision, 'webui')
  assert.equal(forward.changed, false)
})

test('a mark is not persisted when the day cannot be read', async () => {
  const root = await mkdtemp(join(scratch, 'mark-read-'))
  const dir = await makeBook(root, 'mark-read')
  await writeFile(join(dir, '2020-09-01.md'), Buffer.alloc(1024 * 1024 + 1, 'A'))
  const ctx = ctxFor(root)
  await assert.rejects(
    S.setMark(ctx, 'mark-read', { date: '2020-09-01', level: 3 }, 'webui'),
    /exceeds .* bytes/
  )
  assert.deepEqual(await S.readMarks(ctx, 'mark-read'), {})
  assert.equal((await S.readCommits(dir)).length, 0)
})
