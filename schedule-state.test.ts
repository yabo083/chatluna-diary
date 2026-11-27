import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SCHEDULE_REGISTRY,
  decideBook,
  emptyRegistry,
  readRegistry,
  writeRegistry
} from './schedule-state.ts'

const roots: string[] = []

async function scratch() {
  const root = await mkdtemp('/tmp/chatluna-diary-schedule-')
  roots.push(root)
  return root
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

test('registry round-trips and a damaged file stays unreadable', async () => {
  const root = await scratch()
  const registry = emptyRegistry()
  registry.books.aris = { state: 'cancelled', rev: 3 }
  registry.books.angela = { state: 'suspended', status: 'paused', rev: 1 }
  await writeRegistry(root, registry)
  assert.deepEqual(await readRegistry(root), registry)
  await writeFile(join(root, SCHEDULE_REGISTRY), '{"v":1,"books":')
  assert.equal(await readRegistry(root), null)
  assert.match(await readFile(join(root, SCHEDULE_REGISTRY), 'utf8'), /^\{"v":1/)
})

test('a paused job is adopted, never replaced', () => {
  assert.deepEqual(decideBook({ state: 'managed', jobId: 'j1', rev: 1 }, { id: 'j1', status: 'paused' }), { kind: 'none', jobId: 'j1' })
  assert.deepEqual(decideBook({ state: 'managed', jobId: 'old', rev: 1 }, { id: 'new', status: 'paused' }), { kind: 'adopt', jobId: 'new' })
  assert.deepEqual(decideBook(undefined, { id: 'legacy', status: 'paused' }), { kind: 'adopt', jobId: 'legacy' })
})

test('a user cancel survives a missing job and is never recreated', () => {
  assert.deepEqual(decideBook({ state: 'cancelled', rev: 2 }, undefined), { kind: 'none' })
  assert.deepEqual(decideBook({ state: 'cancelled', rev: 2 }, { id: 'stale', status: 'active' }), { kind: 'remove', jobId: 'stale' })
  assert.deepEqual(decideBook({ state: 'managed', jobId: 'gone', rev: 2 }, undefined), { kind: 'cancelled' })
})

test('only explicit suspension or first use creates a job', () => {
  assert.deepEqual(decideBook(undefined, undefined), { kind: 'create', status: 'active' })
  assert.deepEqual(decideBook({ state: 'suspended', status: 'paused', rev: 4 }, undefined), { kind: 'create', status: 'paused' })
  assert.deepEqual(decideBook({ state: 'suspended', rev: 4 }, { id: 'live', status: 'active' }), { kind: 'adopt', jobId: 'live' })
})

test('the registry refuses more books than its bound', async () => {
  const root = await scratch()
  const registry = emptyRegistry()
  for (let index = 0; index < 4097; index += 1) registry.books[`b${index}`] = { state: 'cancelled', rev: 0 }
  await assert.rejects(writeRegistry(root, registry), /4096/)
})
