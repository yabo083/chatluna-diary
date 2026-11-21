/** A day is one Markdown file with a date header and zero or more `## title` entries. */

export interface DiaryEntryBlock {
  title: string
  /** Original byline, e.g. `2026-11-22 Sun 02:45`; editable entries keep it. */
  time: string
  body: string
  /** Original block, used to keep untouched entries byte-for-byte. */
  raw: string
  start: number
  end: number
}

export interface ParsedDiaryDay {
  /** Everything before the first entry, normally `# YYYY-MM-DD`. */
  header: string
  entries: DiaryEntryBlock[]
}

const TITLE = /^##[ \t]+(.+)$/
const TIME = /^\*([^*\n]+)\*$/

/**
 * Parse line-by-line instead of using one greedy regex: entry bodies are
 * Markdown and may contain blank lines, so a body ends only at the next `## `
 * line or EOF.
 */
export function parseDiaryDay(markdown: string): ParsedDiaryDay {
  const lines = markdown.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  const starts: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (TITLE.test(lines[index])) starts.push(index)
  }

  if (starts.length === 0) {
    return { header: markdown, entries: [] }
  }

  const entries = starts.map((start, entryIndex) => {
    const endLine = starts[entryIndex + 1] ?? lines.length
    const title = TITLE.exec(lines[start])?.[1].trim() ?? ''
    const time = TIME.exec(lines[start + 1] ?? '')?.[1].trim() ?? ''
    let bodyStart = start + 2
    if ((lines[bodyStart] ?? '') === '') bodyStart += 1
    let bodyEnd = endLine
    while (bodyEnd > bodyStart && (lines[bodyEnd - 1] ?? '').trim() === '') bodyEnd -= 1
    const blockStart = offsets[start]
    const blockEnd = entryIndex + 1 < starts.length ? offsets[starts[entryIndex + 1]] : markdown.length
    return {
      title,
      time,
      body: lines.slice(bodyStart, bodyEnd).join('\n'),
      raw: markdown.slice(blockStart, blockEnd),
      start: blockStart,
      end: blockEnd
    }
  })

  return { header: markdown.slice(0, offsets[starts[0]]), entries }
}

function formatEntry(entry: Pick<DiaryEntryBlock, 'title' | 'time' | 'body'>) {
  return `## ${entry.title}\n*${entry.time}*\n\n${entry.body.trimEnd()}\n`
}

function renderDay(header: string, entries: readonly DiaryEntryBlock[], date: string) {
  const head = header.trimEnd() || `# ${date}`
  if (entries.length === 0) return `${head}\n`
  return `${head}\n\n${entries.map((entry) => entry.raw.trimEnd()).join('\n\n')}\n`
}

/** Replace one entry's title/body; its original byline and every other block stay untouched. */
export function updateDiaryEntry(markdown: string, date: string, index: number, title: string, body: string) {
  const parsed = parseDiaryDay(markdown)
  if (!Number.isInteger(index) || index < 0 || index >= parsed.entries.length) {
    throw new RangeError('entry does not exist')
  }
  const entries = parsed.entries.map((entry, current) =>
    current === index ? { ...entry, title, body, raw: formatEntry({ ...entry, title, body }) } : entry
  )
  return renderDay(parsed.header, entries, date)
}

/** Remove one entry. The date header is kept so a mark on an empty day still has a file. */
export function removeDiaryEntry(markdown: string, date: string, index: number) {
  const parsed = parseDiaryDay(markdown)
  if (!Number.isInteger(index) || index < 0 || index >= parsed.entries.length) {
    throw new RangeError('entry does not exist')
  }
  return renderDay(
    parsed.header,
    parsed.entries.filter((_, current) => current !== index),
    date
  )
}

/** New entries use the same block shape as the writer. */
export function formatNewEntry(title: string, time: string, body: string) {
  return formatEntry({ title, time, body })
}
