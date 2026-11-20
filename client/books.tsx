import * as React from 'react'
import { BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useLive } from '@chatluna/ui-client/client'
import type { DiaryBook } from './types'
import './diary.css'

function BookCard(props: { book: DiaryBook; onOpen(): void }) {
  const { book } = props
  return (
    <button type="button" className="diary-book" onClick={props.onOpen}>
      <span className="diary-book-body">
        <span className="diary-book-head">
          <BookOpen className="diary-book-icon" aria-hidden="true" />
          <span className="diary-book-name">{book.name}</span>
        </span>
        {book.description === undefined ? null : (
          <span className="diary-book-desc">{book.description}</span>
        )}
        <span className="diary-book-meta">
          <span className="diary-book-stats">
            {book.days} 天 · {book.marks} 个标记
          </span>
          <span className="diary-book-latest">
            {book.latest === null ? '还没有记录' : `最近 ${book.latest}`}
          </span>
        </span>
      </span>
    </button>
  )
}

export function DiaryBooksPage() {
  const books = useLive('diary.books')
  const navigate = useNavigate()
  const rows = books.data?.books ?? []

  return (
    <div className="diary-page diary-books-page variant-depth">
      <header className="diary-header">
        <div className="diary-title">
          <p className="diary-kicker">DIARY</p>
          <h1>日记簿</h1>
          <p className="diary-subtitle">每个预设，一本自己的日记。</p>
        </div>
        <div className="diary-meta-badge" aria-label={`共 ${rows.length} 本日记`}>
          <BookOpen className="diary-meta-icon" aria-hidden="true" />
          <span>共 {rows.length} 本</span>
        </div>
      </header>

      {books.status === 'loading' ? (
        <p className="diary-hint diary-books-hint">正在加载日记簿……</p>
      ) : rows.length === 0 ? (
        <p className="diary-empty">还没有日记簿。先创建一个预设。</p>
      ) : (
        <div className="diary-books-grid">
          {rows.map((book) => (
            <BookCard
              key={book.presetId}
              book={book}
              onOpen={() => void navigate(`/diary/${encodeURIComponent(book.presetId)}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
