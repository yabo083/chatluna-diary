export interface DiaryDateRow {
  date: string
}

export interface DiaryMark {
  date: string
  level: number
  note?: string
  updatedAt: string
}

export interface DiaryBook {
  presetId: string
  name: string
  description?: string
  days: number
  marks: number
  history: boolean
  latest: string | null
}

export interface DiaryCommitRow {
  id: string
  date: string
  at: number
  op: string
  source: 'webui' | 'model' | 'schedule' | 'system'
  summary: string
  title?: string
  index?: number
  beforeExists: boolean
  afterExists: boolean
  beforeBytes: number
  afterBytes: number
}

export interface DiaryDeletedDay {
  date: string
  id: string
  at: number
  summary: string
  bytes: number
}

export interface DiaryHistoryPage {
  rows: DiaryCommitRow[]
  deleted: DiaryDeletedDay[]
  hasMore: boolean
  head: string | null
  revision: string | null
}

export interface DiaryDiffLine {
  kind: 'context' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface DiaryDiff {
  id: string
  date: string
  at: number
  op: string
  source: string
  summary: string
  beforeExists: boolean
  afterExists: boolean
  lines: DiaryDiffLine[]
  added: number
  removed: number
  truncated: boolean
  reason?: string
}

export type DiaryScheduleMode = 'managed' | 'cancelled' | 'disabled' | 'unavailable' | 'unmanaged'

export interface DiaryScheduleView {
  presetId: string
  mode: DiaryScheduleMode
  status: 'active' | 'paused' | 'done' | 'failed' | 'pending' | null
  cron: string
  jobId?: string
  next?: number
  pending?: boolean
  rev?: number
}

export interface DiaryEntryRow {
  index: number
  digest: string
  title: string
  time: string
  body: string
}

export interface DiaryEntryView {
  date: string
  /** null when the day file does not exist yet. */
  revision: string | null
  markdown: string
  mark: Omit<DiaryMark, 'date'> | null
  entries: DiaryEntryRow[]
}

declare module '@chatluna/ui-client/client' {
  interface Actions {
    'diary.media': (input: { presetId?: string; file: string }) => Promise<{ mime: string; data: string }>
    'diary.entry.save': (input: {
      presetId?: string
      date: string
      title: string
      body: string
      index?: number
      revision?: string
      digest?: string
    }) => Promise<{ date: string; title: string; appended?: boolean; index?: number }>
    'diary.entry.remove': (input: {
      presetId?: string
      date: string
      index: number
      revision?: string
      digest?: string
    }) => Promise<{ date: string; index: number }>
    'diary.day.remove': (input: { presetId?: string; date: string; revision?: string }) => Promise<{ date: string }>
    'diary.day.write': (input: { presetId?: string; date: string; markdown: string; revision?: string }) => Promise<{ date: string; revision: string }>
    'diary.days.export': (input: { presetId?: string; dates: string[] }) => Promise<{ filename: string; content: string }>
    'diary.days.remove': (input: { presetId?: string; dates: string[] }) => Promise<{ removed: string[] }>
    'diary.book.format': (input: { presetId?: string }) => Promise<{ dates: string[]; changed: number }>
    'diary.mark.save': (input: { presetId?: string; date: string; level: number; note?: string }) => Promise<DiaryMark>
    'diary.mark.remove': (input: { presetId?: string; date: string }) => Promise<{ date: string; removed: boolean }>
    'diary.run': (input: { presetId?: string }) => Promise<{
      status: 'completed' | 'failed' | 'cancelled' | 'running' | 'started' | 'skipped' | string
      background?: string
      error?: string
      result?: unknown
      wrote?: boolean
      durationMs?: number
      detail?: unknown
    }>
    'diary.history.diff': (input: { presetId?: string; id: string }) => Promise<DiaryDiff>
    'diary.history.restore': (input: {
      presetId?: string
      date: string
      id: string
      side: 'before' | 'after'
      revision?: string
    }) => Promise<{ changed: boolean; date: string; revision: string | null }>
    'diary.schedule.pause': (input: { presetId?: string }) => Promise<DiaryScheduleView>
    'diary.schedule.resume': (input: { presetId?: string }) => Promise<DiaryScheduleView>
    'diary.schedule.cancel': (input: { presetId?: string }) => Promise<DiaryScheduleView>
    'diary.schedule.enable': (input: { presetId?: string }) => Promise<DiaryScheduleView>
  }

  interface States {
    'diary.books': { books: DiaryBook[] }
    'diary.dates': { dates: DiaryDateRow[] }
    'diary.marks': { marks: DiaryMark[] }
    'diary.entry': DiaryEntryView | null
    'diary.history': DiaryHistoryPage
    'diary.schedule': DiaryScheduleView
  }
}
