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

export interface DiaryEntryView {
  date: string
  markdown: string
  mark: Omit<DiaryMark, 'date'> | null
}

declare module '@chatluna/ui-client/client' {
  interface Actions {
    'diary.media': (input: { presetId?: string; file: string }) => Promise<{ mime: string; data: string }>
  }

  interface States {
    'diary.books': { books: DiaryBook[] }
    'diary.dates': { dates: DiaryDateRow[] }
    'diary.marks': { marks: DiaryMark[] }
    'diary.entry': DiaryEntryView | null
  }
}
