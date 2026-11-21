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
  latest: string | null
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
  }

  interface States {
    'diary.books': { books: DiaryBook[] }
    'diary.dates': { dates: DiaryDateRow[] }
    'diary.marks': { marks: DiaryMark[] }
    'diary.entry': DiaryEntryView | null
  }
}
