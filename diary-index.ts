/**
 * Pure rendering for the lightweight diary index. Keeping the byte budget and
 * pagination here makes the physical bound easy to test without a ChatLuna
 * context or a real book directory.
 */

export interface DiaryIndexEntry {
  title: string
  preview: string
}

export interface DiaryIndexDay {
  date: string
  level?: number
  entryCount?: number
  entries: DiaryIndexEntry[]
}

export interface DiaryIndexOptions {
  budget?: number
  total?: number
  hasMore?: boolean
}

/** The output is one page of metadata; never diary bodies. */
export const DIARY_INDEX_MAX_CHARS = 24_000
export const DIARY_INDEX_MAX_ENTRIES = 8
export const DIARY_INDEX_DEFAULT_LIMIT = 30
export const DIARY_INDEX_MAX_LIMIT = 100

export function renderDiaryIndex(book, days, total, options: DiaryIndexOptions = {}) {
  const bookTotal = options.total ?? total
  if (bookTotal === 0) return '日记簿还没有内容。'
  if (total === 0 || days.length === 0) return `日记簿 ${book} 共 ${bookTotal} 天；这一页没有更早的日期。`
  const budget = options.budget ?? DIARY_INDEX_MAX_CHARS
  const lines = []
  let used = 0
  let included = 0
  for (const day of days) {
    const shown = day.entries.slice(0, DIARY_INDEX_MAX_ENTRIES)
    const entryCount = day.entryCount ?? day.entries.length
    const entryText = shown.length === 0
      ? '（空）'
      : shown.map((entry) => {
        const title = Array.from(String(entry.title)).slice(0, 40).join('')
        const preview = Array.from(String(entry.preview)).slice(0, 50).join('')
        return `${title}${preview === '' ? '' : ` — ${preview}`}`
      }).join(' / ')
    const omitted = entryCount > shown.length ? ` …等 ${entryCount} 条` : ''
    const level = Number(day.level)
    const badge = Number.isFinite(level) ? ` [贴花 ${level}/5]` : ''
    const line = `- ${day.date}${badge}: ${entryText}${omitted}`
    if (included > 0 && used + line.length + 1 > budget) break
    lines.push(line)
    used += line.length + 1
    included += 1
  }
  const nextBefore = included < total || (options.hasMore === true && included > 0)
    ? days[included - 1]?.date
    : undefined
  const header = `日记簿 ${book} 共 ${bookTotal} 天；本页 ${lines.length} 天（新→旧）：`
  const nav = nextBefore === undefined
    ? ''
    : `\n还有更早的日期：再次调用 diary_read 的 list，传 before:"${nextBefore}"。`
  return `${header}\n${lines.join('\n')}${nav}`
}
