/**
 * Preset switching splits one session's history in place: the conversation row
 * always carries the CURRENT preset, so a session that switched presets still
 * returns the earlier preset's messages. These helpers carve out only the
 * segment after the most recent switch so a diary never mixes two presets.
 */

export interface NoticeSource {
  kind?: string
  plugin?: string
}

export interface NoticeSection {
  name?: string
  text?: string
}

/** The part of a stored message a preset notice is read from. */
export interface ScopeMessage {
  source?: NoticeSource
  sections?: readonly NoticeSection[]
}

/** The part of a session entry the scope helpers look at. */
export interface ScopeEntry {
  message?: ScopeMessage
}

/** The preset id a chatluna preset-switch notice targets, if this is one. */
export function presetSwitchTarget(message: ScopeMessage | undefined | null): string | undefined {
  if (message === undefined || message === null) return undefined
  const source = message.source
  if (source?.kind !== 'plugin' || source?.plugin !== 'chatluna:preset') return undefined
  const section = message.sections?.find((item) => item?.name === 'preset')
  const text = section?.text
  return typeof text === 'string' ? text : undefined
}

/**
 * Keep only the entries belonging to the requested preset's current segment.
 *
 * Conservative: after the last switch every earlier entry is discarded even if
 * it predates a round trip back to the same preset, because a stored message
 * carries no preset field of its own and could otherwise leak.
 */
export function currentPresetEntries<T extends ScopeEntry>(
  entries: readonly T[],
  preset: string,
  normalize: (value: unknown) => string
): T[] {
  let lastSwitch = -1
  let target: string | undefined
  for (let index = 0; index < entries.length; index += 1) {
    const found = presetSwitchTarget(entries[index]?.message)
    if (found !== undefined) {
      lastSwitch = index
      target = found
    }
  }
  if (lastSwitch < 0) return [...entries]
  if (normalize(target) !== normalize(preset)) return []
  return entries.slice(lastSwitch + 1)
}
