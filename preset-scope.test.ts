import test from 'node:test'
import assert from 'node:assert/strict'

import { currentPresetEntries, presetSwitchTarget } from './preset-scope.ts'
import type { ScopeEntry, ScopeMessage } from './preset-scope.ts'

/** Mirrors `bookId` in index.ts: unsafe or empty ids fall back to `default`. */
const normalize = (value: unknown): string => {
  const id = typeof value === 'string' ? value.trim() : ''
  return id === '' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? 'default' : id
}

interface Fixture extends ScopeEntry {
  label: string
  message: ScopeMessage
}

const human = (label: string): Fixture => ({ label, message: { source: { kind: 'user' } } })
const reply = (label: string): Fixture => ({ label, message: { source: { kind: 'assistant' } } })

function notice(kind: string, plugin: string, preset?: string): Fixture {
  const sections: Array<{ name: string; text: string }> = preset === undefined ? [] : [{ name: 'preset', text: preset }]
  return { label: `notice:${kind}:${plugin}:${preset ?? ''}`, message: { source: { kind, plugin }, sections } }
}

const presetSwitch = (preset: string): Fixture => notice('plugin', 'chatluna:preset', preset)

const ids = (entries: Fixture[]): string[] => entries.map((entry) => entry.label)

test('presetSwitchTarget reads only chatluna preset notices', () => {
  assert.equal(presetSwitchTarget(presetSwitch('alice').message), 'alice')
  assert.equal(presetSwitchTarget(notice('plugin', 'chatluna:other', 'alice').message), undefined)
  assert.equal(presetSwitchTarget(notice('tool', 'chatluna:preset', 'alice').message), undefined)
  assert.equal(presetSwitchTarget(notice('plugin', 'chatluna:preset').message), undefined)
  assert.equal(presetSwitchTarget(undefined), undefined)
  assert.equal(presetSwitchTarget(null), undefined)
})

test('no switch keeps every entry', () => {
  const entries = [human('a'), reply('b'), human('c')]
  assert.deepEqual(ids(currentPresetEntries(entries, 'alice', normalize)), ['a', 'b', 'c'])
})

test('a switch to another preset yields nothing', () => {
  const entries = [human('a'), presetSwitch('bob'), reply('b')]
  assert.deepEqual(currentPresetEntries(entries, 'alice', normalize), [])
})

test('a switch to the requested preset keeps only what follows', () => {
  const entries = [human('a'), presetSwitch('alice'), reply('b'), human('c')]
  assert.deepEqual(ids(currentPresetEntries(entries, 'alice', normalize)), ['b', 'c'])
})

test('switch away and back keeps only the last segment', () => {
  const entries = [
    human('old-1'),
    presetSwitch('bob'),
    reply('bob-1'),
    presetSwitch('alice'),
    human('new-1'),
    reply('new-2')
  ]
  assert.deepEqual(ids(currentPresetEntries(entries, 'alice', normalize)), ['new-1', 'new-2'])
})

test('non-switch plugin notices do not cut the segment', () => {
  const entries = [human('a'), notice('plugin', 'chatluna:something'), reply('b')]
  // Unrelated notices are kept in place; the collector drops plugin messages
  // later, so what matters is that the segment itself was not cut.
  assert.deepEqual(ids(currentPresetEntries(entries, 'alice', normalize)), ['a', 'notice:plugin:chatluna:something:', 'b'])
})

test('an invalid switch target normalizes instead of mixing', () => {
  const entries = [human('a'), presetSwitch('not a valid id!'), reply('b')]
  assert.deepEqual(currentPresetEntries(entries, 'alice', normalize), [])
  assert.deepEqual(ids(currentPresetEntries(entries, 'default', normalize)), ['b'])
})

test('an empty switch target still cuts the segment', () => {
  const entries = [human('a'), presetSwitch(''), reply('b')]
  assert.deepEqual(currentPresetEntries(entries, 'alice', normalize), [])
  assert.deepEqual(ids(currentPresetEntries(entries, 'default', normalize)), ['b'])
})

test('a trailing switch leaves no entries', () => {
  const entries = [human('a'), reply('b'), presetSwitch('alice')]
  assert.deepEqual(currentPresetEntries(entries, 'alice', normalize), [])
})

test('inputs are not mutated', () => {
  const entries = [human('a'), presetSwitch('bob'), reply('b')]
  const snapshot = entries.map((entry) => ({ ...entry }))
  currentPresetEntries(entries, 'alice', normalize)
  assert.deepEqual(entries, snapshot)
})
