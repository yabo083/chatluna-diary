import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The book-level registry that makes pause/cancel survive restarts. */
export const SCHEDULE_REGISTRY = '.schedule-v1.json'
const MAX_BOOKS = 4096
const MAX_BOOK_ID_BYTES = 255

export type BookMode = 'managed' | 'cancelled' | 'suspended'

export interface BookRow {
  state: BookMode
  /** The job id this generation owns; missing means "no live job". */
  jobId?: string
  /** Status to reuse after an internal suspension (plugin disabled/reloaded). */
  status?: 'active' | 'paused'
  rev: number
}

export interface ScheduleRegistry {
  v: 1
  rev: number
  books: Record<string, BookRow>
}

export interface JobView {
  id: string
  key?: string
  status: string
}

export type BookDecision =
  | { kind: 'create'; status: 'active' | 'paused' }
  | { kind: 'adopt'; jobId: string }
  | { kind: 'none'; jobId?: string }
  | { kind: 'cancelled' }
  | { kind: 'remove'; jobId?: string }

export function emptyRegistry(): ScheduleRegistry {
  return { v: 1, rev: 0, books: {} }
}

function validRow(value: unknown): value is BookRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as BookRow
  return (row.state === 'managed' || row.state === 'cancelled' || row.state === 'suspended')
    && (row.jobId === undefined || typeof row.jobId === 'string')
    && (row.status === undefined || row.status === 'active' || row.status === 'paused')
    && Number.isFinite(row.rev)
}

/** A damaged registry is returned as `null`: callers must not silently re-adopt. */
export async function readRegistry(root: string): Promise<ScheduleRegistry | null> {
  const file = join(root, SCHEDULE_REGISTRY)
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const registry = parsed as ScheduleRegistry
    if (registry.v !== 1 || typeof registry.books !== 'object' || registry.books === null) return null
    for (const row of Object.values(registry.books)) if (!validRow(row)) return null
    return { v: 1, rev: Number.isFinite(registry.rev) ? registry.rev : 0, books: registry.books }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
    return null
  }
}

export async function writeRegistry(root: string, registry: ScheduleRegistry) {
  const keys = Object.keys(registry.books)
  if (keys.length > MAX_BOOKS) throw new Error(`schedule registry exceeds ${MAX_BOOKS} books`)
  for (const key of keys) {
    if (Buffer.byteLength(key) > MAX_BOOK_ID_BYTES) throw new Error('schedule registry book id is too long')
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const file = join(root, SCHEDULE_REGISTRY)
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify({ ...registry, v: 1 })}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * Decide what one book needs, from the registry row and the live job holding
 * its key. A paused job is adopted, never replaced; a cancelled book is never
 * recreated; a managed book whose job vanished was cancelled by the user.
 */
export function decideBook(row: BookRow | undefined, job: JobView | undefined): BookDecision {
  if (row?.state === 'cancelled') {
    return job === undefined ? { kind: 'none' } : { kind: 'remove', jobId: job.id }
  }
  if (job !== undefined) {
    if (row?.jobId === job.id) return { kind: 'none', jobId: job.id }
    return { kind: 'adopt', jobId: job.id }
  }
  if (row?.state === 'managed') return { kind: 'cancelled' }
  if (row?.state === 'suspended') return { kind: 'create', status: row.status ?? 'active' }
  return { kind: 'create', status: 'active' }
}
