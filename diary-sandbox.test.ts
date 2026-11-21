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
source += `\nexport const __test = { diaryIndex, formatBook, removeDays, exportDays, readDay, readMarks, writeMarks, collectDayMessages }\n`
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
  assert.deepEqual(await readdir(dir), ['marks.json'])
  const absent = await S.removeDays(ctxFor(root), 'del', ['2099-01-01'])
  assert.deepEqual(absent.absent, ['2099-01-01'])

  const risk = await makeBook(root, 'risk')
  await writeFile(join(risk, '2020-01-01.md'), '# 2020-01-01\n\n正文\n')
  await mkdir(join(risk, '2020-01-02.md'))
  await writeFile(join(risk, 'marks.json'), JSON.stringify({ version: 1, marks: { '2020-01-01': { level: 1, updatedAt: 'x' }, '2020-01-02': { level: 2, updatedAt: 'x' } } }))
  await assert.rejects(S.removeDays(ctxFor(root), 'risk', ['2020-01-01', '2020-01-02']), /EISDIR/)
  await rm(join(risk, '2020-01-02.md'), { recursive: true })
  const retry = await S.removeDays(ctxFor(root), 'risk', ['2020-01-01', '2020-01-02'])
  assert.deepEqual(retry.removed, [])
  assert.deepEqual(retry.absent, ['2020-01-01', '2020-01-02'])
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
