import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Everything history writes lives under this dot-directory inside one book. */
export const HISTORY_DIRECTORY = '.history'
const COMMITS_FILE = 'commits.jsonl'
const OBJECTS_DIRECTORY = 'objects'

/** A day is capped at 1 MiB by the diary itself; a history object may not exceed it. */
export const MAX_HISTORY_OBJECT_BYTES = 1024 * 1024
/** Per book: retained commits, per day commits, unique object bytes and object count. */
export const MAX_HISTORY_COMMITS = 2000
export const MAX_HISTORY_COMMITS_PER_DAY = 64
export const MAX_HISTORY_OBJECT_TOTAL_BYTES = 512 * 1024 * 1024
export const MAX_HISTORY_OBJECTS = 4096
/** Compaction starts at this log size; the log is small enough to read whole.
 * A commit can add up to 2 MiB of objects, so the trigger keeps a runaway
 * sequence from drifting far past the object budget before compaction. */
export const HISTORY_COMPACT_BYTES = 16 * 1024
/** A hard read cap: a runaway log never becomes an unbounded allocation. */
const MAX_HISTORY_LOG_READ = 8 * 1024 * 1024
const MAX_SUMMARY_CHARS = 120
const MAX_TITLE_CHARS = 40
/** A single commit line must stay far below the log budget. */
const MAX_COMMIT_LINE_BYTES = 4 * 1024

export type HistoryOp =
  | 'append'
  | 'replace-day'
  | 'edit-entry'
  | 'delete-entry'
  | 'delete-day'
  | 'format'
  | 'mark'
  | 'restore'

export type HistorySource = 'webui' | 'model' | 'schedule' | 'system'

export interface HistoryRef {
  sha256: string
  bytes: number
}

export interface HistoryMark {
  level: number
  note?: string
  updatedAt: string
}

/**
 * One commit is a date's state transition. `before` and `after` are `null` for
 * "the day file did not exist"; an empty file is a real reference and distinct.
 */
export interface HistoryCommit {
  v: 1
  id: string
  date: string
  at: number
  op: HistoryOp
  source: HistorySource
  summary: string
  title?: string
  index?: number
  batch?: string
  restoredFrom?: string
  before: HistoryRef | null
  after: HistoryRef | null
  /** Present only when the commit itself changed the mark. */
  markBefore?: HistoryMark | null
  markAfter?: HistoryMark | null
}

export interface DayState {
  exists: boolean
  content: string
}

export interface CommitInput {
  date: string
  op: HistoryOp
  source: HistorySource
  summary: string
  title?: string
  index?: number
  batch?: string
  restoredFrom?: string
  before: DayState
  after: DayState
  markBefore?: HistoryMark | null
  markAfter?: HistoryMark | null
}

export interface CommitFilter {
  date?: string
  before?: number
  limit?: number
}

export interface HistoryPage {
  rows: HistoryCommit[]
  hasMore: boolean
}

export interface DeletedDay {
  date: string
  commit: HistoryCommit
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  removed: number
  truncated: boolean
  reason?: string
}

const MAX_DIFF_SOURCE_LINES = 600
const MAX_DIFF_OUTPUT_LINES = 400
const MAX_DIFF_LINE_CHARS = 400

export function historyDirectory(bookDirectory: string) {
  return join(bookDirectory, HISTORY_DIRECTORY)
}

function commitsPath(bookDirectory: string) {
  return join(historyDirectory(bookDirectory), COMMITS_FILE)
}

function objectsDirectory(bookDirectory: string) {
  return join(historyDirectory(bookDirectory), OBJECTS_DIRECTORY)
}

export function hashContent(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

/** Truncate user-facing text on code points, never in the middle of a surrogate pair. */
function clip(value: string, maximum: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > maximum ? chars.slice(0, maximum).join('') : text
}

async function writeAtomic(file: string, data: string | Buffer, mode = 0o600) {
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, data, { mode })
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
}

/** Read one day without folding "missing" into "empty". */
export async function readDayState(bookDirectory: string, date: string): Promise<DayState> {
  const file = join(bookDirectory, `${date}.md`)
  try {
    const info = await stat(file)
    if (!info.isFile()) {
      throw Object.assign(new Error(`EISDIR: diary day is not a regular file: ${date}`), { code: 'EISDIR' })
    }
    if (info.size > MAX_HISTORY_OBJECT_BYTES) {
      throw new Error(`diary day exceeds ${MAX_HISTORY_OBJECT_BYTES} bytes: ${date}`)
    }
    return { exists: true, content: await readFile(file, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, content: '' }
    throw error
  }
}

/** Store the exact bytes once; identical content shares one object. */
export async function storeSnapshot(bookDirectory: string, content: string): Promise<HistoryRef> {
  const buffer = Buffer.from(content, 'utf8')
  if (buffer.byteLength > MAX_HISTORY_OBJECT_BYTES) {
    throw new Error(`history snapshot exceeds ${MAX_HISTORY_OBJECT_BYTES} bytes`)
  }
  const sha256 = hashContent(buffer)
  const directory = objectsDirectory(bookDirectory)
  await ensureDirectory(directory)
  const file = join(directory, sha256)
  try {
    const info = await stat(file)
    if (info.isFile() && info.size === buffer.byteLength) return { sha256, bytes: buffer.byteLength }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeAtomic(file, buffer)
  return { sha256, bytes: buffer.byteLength }
}

export async function readSnapshot(bookDirectory: string, ref: HistoryRef) {
  const file = join(objectsDirectory(bookDirectory), ref.sha256)
  const info = await stat(file)
  if (!info.isFile()) throw new Error('history snapshot is not a file')
  if (info.size > MAX_HISTORY_OBJECT_BYTES || info.size !== ref.bytes) {
    throw new Error('history snapshot does not match its recorded size')
  }
  return readFile(file, 'utf8')
}

function validRef(value: unknown): value is HistoryRef {
  if (value === null || typeof value !== 'object') return false
  const ref = value as HistoryRef
  return typeof ref.sha256 === 'string' && /^[0-9a-f]{64}$/.test(ref.sha256) && Number.isInteger(ref.bytes) && ref.bytes >= 0
}

function validMark(value: unknown): value is HistoryMark {
  if (value === null || typeof value !== 'object') return false
  const mark = value as HistoryMark
  return Number.isFinite(mark.level) && typeof mark.updatedAt === 'string'
}

function validCommit(value: unknown): value is HistoryCommit {
  if (value === null || typeof value !== 'object') return false
  const commit = value as HistoryCommit
  return commit.v === 1
    && typeof commit.id === 'string' && commit.id.length > 0
    && typeof commit.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(commit.date)
    && Number.isFinite(commit.at)
    && typeof commit.op === 'string'
    && typeof commit.source === 'string'
    && typeof commit.summary === 'string'
    && (commit.before === null || validRef(commit.before))
    && (commit.after === null || validRef(commit.after))
    && (commit.markBefore === undefined || commit.markBefore === null || validMark(commit.markBefore))
    && (commit.markAfter === undefined || commit.markAfter === null || validMark(commit.markAfter))
}

/** Log order is the commit order; a torn last line from a crash is ignored. */
export async function readCommits(bookDirectory: string): Promise<HistoryCommit[]> {
  const file = commitsPath(bookDirectory)
  let text: string
  try {
    const info = await stat(file)
    if (info.size === 0) return []
    if (info.size > MAX_HISTORY_LOG_READ) {
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(MAX_HISTORY_LOG_READ)
        await handle.read(buffer, 0, buffer.byteLength, info.size - buffer.byteLength)
        text = buffer.toString('utf8')
        // The cut point may bisect a line; the parser drops it.
        const firstNewline = text.indexOf('\n')
        text = firstNewline === -1 ? '' : text.slice(firstNewline + 1)
      } finally {
        await handle.close()
      }
    } else {
      text = await readFile(file, 'utf8')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const rows: HistoryCommit[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (validCommit(parsed)) rows.push(parsed)
    } catch {
      // A torn line is the crash boundary, not a reason to hide older commits.
    }
  }
  return rows
}

export async function appendCommit(bookDirectory: string, input: CommitInput): Promise<HistoryCommit> {
  const before = input.before.exists ? await storeSnapshot(bookDirectory, input.before.content) : null
  const after = input.after.exists ? await storeSnapshot(bookDirectory, input.after.content) : null
  const commit: HistoryCommit = {
    v: 1,
    id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    date: input.date,
    at: Date.now(),
    op: input.op,
    source: input.source,
    summary: clip(input.summary, MAX_SUMMARY_CHARS),
    ...(input.title === undefined ? {} : { title: clip(input.title, MAX_TITLE_CHARS) }),
    ...(input.index === undefined ? {} : { index: input.index }),
    ...(input.batch === undefined ? {} : { batch: input.batch }),
    ...(input.restoredFrom === undefined ? {} : { restoredFrom: input.restoredFrom }),
    before,
    after,
    ...(input.markBefore === undefined ? {} : { markBefore: input.markBefore }),
    ...(input.markAfter === undefined ? {} : { markAfter: input.markAfter })
  }
  const line = `${JSON.stringify(commit)}\n`
  if (Buffer.byteLength(line) > MAX_COMMIT_LINE_BYTES) throw new Error('history commit line is too large')
  await ensureDirectory(historyDirectory(bookDirectory))
  await appendFile(commitsPath(bookDirectory), line, { encoding: 'utf8', mode: 0o600 })
  return commit
}

export async function findCommit(bookDirectory: string, id: string) {
  const rows = await readCommits(bookDirectory)
  return rows.find((commit) => commit.id === id)
}

export async function listCommits(bookDirectory: string, filter: CommitFilter = {}): Promise<HistoryPage> {
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(filter.limit) || 50)))
  const rows = (await readCommits(bookDirectory))
    .filter((commit) => filter.date === undefined || commit.date === filter.date)
    .filter((commit) => filter.before === undefined || commit.at < filter.before)
    .reverse()
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit }
}

/** Deleted dates that still have a recoverable snapshot, newest first. */
export function deletedDays(commits: readonly HistoryCommit[], currentDates: ReadonlySet<string>): DeletedDay[] {
  const byDate = new Map<string, HistoryCommit>()
  for (const commit of commits) {
    if (commit.after !== null) {
      byDate.delete(commit.date)
      continue
    }
    // A mark-only commit has no text on either side; it is not a deleted day
    // and must not hide an earlier delete-day commit for the same date.
    if (commit.before === null) continue
    if (currentDates.has(commit.date)) continue
    byDate.set(commit.date, commit)
  }
  return [...byDate.values()]
    .sort((left, right) => right.at - left.at)
    .slice(0, 100)
    .map((commit) => ({ date: commit.date, commit }))
}

/** Keep the newest commit of each date, then the newest commits overall. */
function prune(commits: readonly HistoryCommit[]) {
  const perDay = new Map<string, HistoryCommit[]>()
  for (const commit of commits) {
    const list = perDay.get(commit.date)
    if (list === undefined) perDay.set(commit.date, [commit])
    else list.push(commit)
  }
  const kept: HistoryCommit[] = []
  for (const list of perDay.values()) kept.push(...list.slice(-MAX_HISTORY_COMMITS_PER_DAY))
  kept.sort((left, right) => left.at - right.at)
  return kept.slice(-MAX_HISTORY_COMMITS)
}

function refsOf(commits: readonly HistoryCommit[]) {
  const refs = new Map<string, number>()
  for (const commit of commits) {
    for (const ref of [commit.before, commit.after]) {
      if (ref !== null) refs.set(ref.sha256, Math.max(refs.get(ref.sha256) ?? 0, ref.bytes))
    }
  }
  return refs
}

/**
 * Enforce every physical bound and delete objects no retained commit references.
 * The log is rewritten atomically, so a crash leaves either the old or new set.
 */
export async function compactHistory(bookDirectory: string) {
  const rows = await readCommits(bookDirectory)
  if (rows.length === 0) {
    await unlink(commitsPath(bookDirectory)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    return { commits: 0, objects: 0, bytes: 0 }
  }
  const kept = prune(rows)
  const refs = refsOf(kept)
  let bytes = 0
  for (const size of refs.values()) bytes += size
  // Oldest-first eviction until both the byte and the object budget hold.
  while (kept.length > 0 && (bytes > MAX_HISTORY_OBJECT_TOTAL_BYTES || refs.size > MAX_HISTORY_OBJECTS)) {
    const dropped = kept.shift()
    if (dropped === undefined) break
    const unique = new Set([dropped.before?.sha256, dropped.after?.sha256].filter((hash): hash is string => hash !== undefined))
    for (const sha of unique) {
      if (kept.some((commit) => commit.before?.sha256 === sha || commit.after?.sha256 === sha)) continue
      bytes -= refs.get(sha) ?? 0
      refs.delete(sha)
    }
  }
  await writeAtomic(commitsPath(bookDirectory), kept.map((commit) => `${JSON.stringify(commit)}\n`).join(''))
  let objects = 0
  try {
    for (const file of await readdir(objectsDirectory(bookDirectory))) {
      if (!refs.has(file)) {
        await unlink(join(objectsDirectory(bookDirectory), file)).catch(() => {})
      } else {
        objects += 1
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { commits: kept.length, objects, bytes }
}

export async function maybeCompactHistory(bookDirectory: string) {
  try {
    const info = await stat(commitsPath(bookDirectory))
    if (info.size <= HISTORY_COMPACT_BYTES) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await compactHistory(bookDirectory)
}

/** Unified line diff over a bounded prefix; both sides are ordinary text. */
export function diffText(left: string, right: string): DiffResult {
  const leftLines = left === '' ? [] : left.replace(/\r\n?/g, '\n').split('\n')
  const rightLines = right === '' ? [] : right.replace(/\r\n?/g, '\n').split('\n')
  let truncated = false
  let reason: string | undefined
  let oldLines = leftLines
  let newLines = rightLines
  if (oldLines.length > MAX_DIFF_SOURCE_LINES || newLines.length > MAX_DIFF_SOURCE_LINES) {
    oldLines = oldLines.slice(0, MAX_DIFF_SOURCE_LINES)
    newLines = newLines.slice(0, MAX_DIFF_SOURCE_LINES)
    truncated = true
    reason = `只比较了前 ${MAX_DIFF_SOURCE_LINES} 行`
  }
  const rows = oldLines.length
  const columns = newLines.length
  const table = new Uint16Array((rows + 1) * (columns + 1))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * (columns + 1) + j] = oldLines[i] === newLines[j]
        ? table[(i + 1) * (columns + 1) + j + 1] + 1
        : Math.max(table[(i + 1) * (columns + 1) + j], table[i * (columns + 1) + j + 1])
    }
  }
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let clipped = false
  const push = (line: DiffLine) => {
    if (lines.length >= MAX_DIFF_OUTPUT_LINES) {
      clipped = true
      return
    }
    lines.push(line)
  }
  let i = 0
  let j = 0
  while (i < rows || j < columns) {
    if (i < rows && j < columns && oldLines[i] === newLines[j]) {
      push({ kind: 'context', oldNo: i + 1, newNo: j + 1, text: displayLine(oldLines[i]) })
      i += 1
      j += 1
      continue
    }
    const down = i < rows ? table[(i + 1) * (columns + 1) + j] : -1
    const right = j < columns ? table[i * (columns + 1) + j + 1] : -1
    if (j < columns && (i >= rows || right > down)) {
      push({ kind: 'add', oldNo: null, newNo: j + 1, text: displayLine(newLines[j]) })
      added += 1
      j += 1
    } else if (i < rows) {
      push({ kind: 'del', oldNo: i + 1, newNo: null, text: displayLine(oldLines[i]) })
      removed += 1
      i += 1
    }
  }
  if (clipped) {
    truncated = true
    reason = reason ?? `只显示前 ${MAX_DIFF_OUTPUT_LINES} 行差异`
  }
  return { lines, added, removed, truncated, ...(reason === undefined ? {} : { reason }) }
}

function displayLine(line: string) {
  const chars = Array.from(line)
  return chars.length > MAX_DIFF_LINE_CHARS ? `${chars.slice(0, MAX_DIFF_LINE_CHARS).join('')}…` : line
}

/** The client compares this with what it previewed before restoring. */
export function revisionOf(state: DayState) {
  return state.exists ? hashContent(Buffer.from(state.content, 'utf8')).slice(0, 16) : null
}
