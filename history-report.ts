import type { DeletedDay, DiffResult, HistoryCommit, HistoryMark } from './history.ts'

/** One model-facing history page never grows past this many UTF-8 bytes. */
export const HISTORY_REPORT_BYTES = 8192
/** One model-facing diff never grows past this many UTF-8 bytes. */
export const HISTORY_DIFF_BYTES = 12_288
const MAX_DIFF_BODY_LINES = 80
const MAX_DIFF_LINE_CHARS = 240
const MAX_DELETED_ROWS = 20
const MAX_SUMMARY_CHARS = 80

const SOURCE_LABEL: Record<string, string> = {
  webui: '手工',
  model: 'AI',
  schedule: '定时',
  system: '系统'
}

const OP_LABEL: Record<string, string> = {
  append: '追加',
  'replace-day': '重写全天',
  'edit-entry': '编辑',
  'delete-entry': '删篇',
  'delete-day': '删日',
  format: '格式化',
  mark: '贴花',
  restore: '恢复'
}

const DIFF_HINT = '查看差异：diary_read action:"history_diff" id:"<commit>"。恢复：diary_manage action:"restore" id:"<commit>" side:"before"|"after"。只能恢复该日期最近一次改动，且只涉及正文与贴花；更早的版本或图片请在 WebUI 的这一天历史里处理。'
const MARK_ONLY = '（这次改动没有 Markdown 正文差异，可能只改了贴花）'

function utf8(value: string) {
  return Buffer.byteLength(value, 'utf8')
}

/** Control characters would let a summary forge a `next=` line. */
function escapeText(value: string) {
  return String(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function clip(value: string, maximum: number) {
  const chars = Array.from(value)
  return chars.length > maximum ? `${chars.slice(0, maximum).join('')}…` : value
}

function bytes(value: number) {
  if (value < 1024) return `${value}B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`
  return `${(value / 1024 / 1024).toFixed(1)}MB`
}

function timeOf(at: number) {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function side(commit: HistoryCommit) {
  const before = commit.before === null ? '不存在' : bytes(commit.before.bytes)
  const after = commit.after === null ? '已删除' : bytes(commit.after.bytes)
  return `${before}→${after}`
}

function markSummary(mark: HistoryMark | null | undefined) {
  if (mark === undefined) return ''
  if (mark === null) return ' 贴花:移除'
  return ` 贴花:${mark.level}/5${mark.note === undefined ? '' : `(${clip(escapeText(mark.note), MAX_SUMMARY_CHARS)})`}`
}

/** Last-resort byte trim; used only when even the empty skeleton is too big. */
function fit(value: string, cap: number) {
  if (utf8(value) <= cap) return value
  const suffix = '\n（历史输出已截断）'
  const room = cap - utf8(suffix)
  let out = ''
  let used = 0
  for (const char of value) {
    const size = utf8(char)
    if (used + size > room) break
    out += char
    used += size
  }
  return `${out}${suffix}`
}

/**
 * One bounded page for the model, newest first. `commits` is already sliced by
 * the caller; this function only decides how many rows fit. `next` is the id
 * to pass as the next cursor, or absent for the end of the book. A summary can
 * never inject its own `next=` line because control characters are escaped.
 *
 * If the byte budget trims the page, `next` is replaced by the id of the last
 * row actually printed so no commit is skipped.
 */
export function renderHistoryReport(
  book: string,
  commits: readonly HistoryCommit[],
  deleted: readonly DeletedDay[],
  options: { date?: string; next?: string; cap?: number } = {}
) {
  const cap = options.cap ?? HISTORY_REPORT_BYTES
  const header = `日记历史 · ${escapeText(book)} · ${options.date ?? '整本'} · ${commits.length} 条`
  const rows = commits.map((commit) => {
    const mark = commit.markAfter !== undefined ? commit.markAfter : commit.markBefore
    return `- ${commit.id} · ${commit.date} ${timeOf(commit.at)} · ${SOURCE_LABEL[commit.source] ?? escapeText(commit.source)} · ${OP_LABEL[commit.op] ?? escapeText(commit.op)} · ${clip(escapeText(commit.summary), MAX_SUMMARY_CHARS)} · ${side(commit)}${markSummary(mark)}`
  })
  const deletedRows = options.date === undefined
    ? deleted.slice(0, MAX_DELETED_ROWS).map((row) =>
      `- ${row.date} · ${row.commit.id} · ${bytes(row.commit.before?.bytes ?? 0)} · ${clip(escapeText(row.commit.summary), 60)}`)
    : []

  const build = (shown: number, deletedShown: number) => {
    const parts: string[] = [header]
    if (shown > 0) parts.push(...rows.slice(0, shown))
    if (shown < rows.length) parts.push(`（另有 ${rows.length - shown} 条本次未显示，按 next 继续）`)
    const lastPrinted = shown > 0 ? commits[shown - 1].id : undefined
    const nextId = shown < commits.length ? lastPrinted : options.next
    parts.push(`next=${nextId ?? 'none'}`)
    if (deletedShown > 0) {
      parts.push('', `可找回的已删除日期（${deleted.length}）：`, ...deletedRows.slice(0, deletedShown))
      if (deletedShown < deleted.length) parts.push(`（另有 ${deleted.length - deletedShown} 个已删除日期未列出）`)
    }
    parts.push('', DIFF_HINT)
    return parts.join('\n')
  }

  let shown = rows.length
  let deletedShown = deletedRows.length
  let text = build(shown, deletedShown)
  // Deleted dates are a convenience; commits win when the page is tight.
  while (utf8(text) > cap && deletedShown > 0) {
    deletedShown -= 1
    text = build(shown, deletedShown)
  }
  while (utf8(text) > cap && shown > 0) {
    shown -= 1
    text = build(shown, deletedShown)
  }
  return utf8(text) > cap ? fit(text, cap) : text
}

/**
 * One bounded diff for the model. Line numbers and prefixes follow git's view,
 * changed lines are shown before context when the row cap bites, and the whole
 * result stays inside `cap` UTF-8 bytes. An unchanged text is reported as a
 * mark-only change; a missing commit is the caller's NOT_FOUND, not this.
 */
export function renderHistoryDiff(commit: HistoryCommit, diff: DiffResult, cap = HISTORY_DIFF_BYTES) {
  const head = [
    `历史差异 · ${commit.date} ${timeOf(commit.at)} · ${SOURCE_LABEL[commit.source] ?? escapeText(commit.source)} · ${OP_LABEL[commit.op] ?? escapeText(commit.op)} · ${clip(escapeText(commit.summary), MAX_SUMMARY_CHARS)}`,
    `前: ${commit.before === null ? '不存在' : bytes(commit.before.bytes)} · 后: ${commit.after === null ? '已删除' : bytes(commit.after.bytes)} · +${diff.added} -${diff.removed}${diff.truncated ? '（已截断）' : ''}`
  ]
  if (diff.reason !== undefined) head.push(`（${escapeText(diff.reason)}）`)
  const markOnly = diff.added === 0 && diff.removed === 0 && !diff.truncated
  const picked = markOnly
    ? []
    : diff.lines.length > MAX_DIFF_BODY_LINES
      ? [
        ...diff.lines.filter((line) => line.kind !== 'context'),
        ...diff.lines.filter((line) => line.kind === 'context')
      ].slice(0, MAX_DIFF_BODY_LINES)
      : diff.lines
  const body = picked.map((line) => {
    const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
    const number = line.kind === 'add' ? line.newNo : line.oldNo
    return `${prefix}${number ?? ''} ${clip(escapeText(line.text), MAX_DIFF_LINE_CHARS)}`
  })

  const build = (shown: number) => {
    const parts = [...head, ...body.slice(0, shown)]
    if (markOnly) parts.push(MARK_ONLY)
    else if (shown < diff.lines.length) parts.push(`（还有 ${diff.lines.length - shown} 行未显示）`)
    return parts.join('\n')
  }

  const fixed = utf8(build(0))
  let shown = 0
  let used = fixed
  for (const line of body) {
    const size = utf8(line) + 1
    // Reserve room for the omission note so the tail is never cut.
    if (used + size + 48 > cap) break
    used += size
    shown += 1
  }
  let text = build(shown)
  while (utf8(text) > cap && shown > 0) {
    shown -= 1
    text = build(shown)
  }
  return utf8(text) > cap ? fit(text, cap) : text
}
