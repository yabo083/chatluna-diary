import * as React from 'react'
import { Link } from 'react-router'
import { useLive, type WidgetSize } from '@chatluna/ui-client/client'
import { BookOpenIcon, CalendarIcon } from 'lucide-react'
import type { DiaryBook } from './types'

function total(rows: readonly DiaryBook[], pick: (book: DiaryBook) => number) {
  return rows.reduce((sum, book) => sum + pick(book), 0)
}

function recentBooks(rows: readonly DiaryBook[]) {
  return rows
    .filter((book): book is DiaryBook & { latest: string } => book.latest !== null)
    .sort((left, right) => right.latest.localeCompare(left.latest))
}

function Stats(props: { days: number; books: number; marks: number }) {
  return (
    <div className="flex items-baseline gap-5">
      <span className="flex items-baseline gap-1.5">
        <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">{props.days}</span>
        <span className="text-xs text-muted-foreground">天</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {props.books} 本 · {props.marks} 个标记
      </span>
    </div>
  )
}

function BookRow(props: { book: DiaryBook }) {
  return (
    <li>
      <Link
        to={`/diary/${encodeURIComponent(props.book.presetId)}`}
        className="flex items-center gap-2 py-1.5 text-sm hover:text-foreground"
      >
        <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{props.book.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{props.book.days} 天</span>
        <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums">
          {props.book.latest?.slice(5) ?? '—'}
        </span>
      </Link>
    </li>
  )
}

function BookList(props: { rows: readonly DiaryBook[] }) {
  return (
    <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
      {props.rows.map((book) => (
        <BookRow key={book.presetId} book={book} />
      ))}
    </ul>
  )
}

function Empty() {
  return (
    <p className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
      <BookOpenIcon className="size-5" />
      还没有日记
    </p>
  )
}

export function DiaryWidget({ size }: { size: WidgetSize }) {
  const books = useLive('diary.books')
  const rows = books.data?.books ?? []
  const days = total(rows, (book) => book.days)
  const marks = total(rows, (book) => book.marks)
  const recent = recentBooks(rows)
  const allBooks = [...rows].sort((left, right) => (right.latest ?? '').localeCompare(left.latest ?? ''))

  if (size === 'sm') {
    return (
      <div className="flex h-full flex-col">
        <Stats days={days} books={rows.length} marks={marks} />
        <span className="mt-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarIcon className="size-3 shrink-0" />
          <span className="truncate">{recent[0]?.latest === undefined ? '还没有记录' : `最近 ${recent[0].latest}`}</span>
        </span>
      </div>
    )
  }

  if (size === 'wide') {
    return (
      <div className="flex h-full items-center gap-6">
        <Stats days={days} books={rows.length} marks={marks} />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">
          {recent.length === 0 ? (
            <span className="text-xs text-muted-foreground">还没有日记</span>
          ) : (
            recent.slice(0, 4).map((book) => (
              <Link
                key={book.presetId}
                to={`/diary/${encodeURIComponent(book.presetId)}`}
                className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-accent/50"
              >
                <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{book.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{book.latest}</span>
              </Link>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between gap-3 pb-2">
        <Stats days={days} books={rows.length} marks={marks} />
        {size === 'md' ? (
          <Link to="/diary" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
            全部
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? <Empty /> : <BookList rows={size === 'md' ? allBooks.slice(0, 1) : allBooks} />}
      <span className="mt-auto flex items-center gap-1 pt-2 text-[11px] text-muted-foreground">
        <CalendarIcon className="size-3 shrink-0" />
        <span className="truncate">{recent[0]?.latest === undefined ? '还没有记录' : `最近 ${recent[0].latest}`}</span>
      </span>
    </div>
  )
}
