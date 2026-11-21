import * as React from 'react'
import { BookOpen, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router'
import { apiErrorMessage, callAction, toast, useLive } from '@chatluna/ui-client/client'
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
        {book.description === undefined ? null : <span className="diary-book-desc">{book.description}</span>}
        <span className="diary-book-meta">
          <span className="diary-book-stats">
            {book.days} 天 · {book.marks} 个标记
          </span>
          <span className="diary-book-latest">{book.latest === null ? '还没有记录' : `最近 ${book.latest}`}</span>
        </span>
      </span>
    </button>
  )
}

/** Small global entry: per-book "write today" without opening a book. */
function GlobalManage(props: { books: DiaryBook[] }) {
  const [open, setOpen] = React.useState(false)
  const [running, setRunning] = React.useState<string>()
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const run = async (book: DiaryBook) => {
    setRunning(book.presetId)
    try {
      const result = await callAction('diary.run', { presetId: book.presetId })
      if (result.status === 'completed') toast.success(`《${book.name}》今天的日记已写入`)
      else if (result.status === 'failed' || result.status === 'cancelled') {
        toast.error(`《${book.name}》写入失败`, { description: result.error ?? result.status })
      } else {
        toast.info(`《${book.name}》任务已触发`, { description: result.status })
      }
    } catch (error) {
      toast.error(`《${book.name}》触发失败`, { description: apiErrorMessage(error) })
    } finally {
      setRunning(undefined)
    }
  }

  return (
    <div className="diary-global-manage" ref={ref}>
      <button
        type="button"
        className="diary-icon-button"
        aria-label="日记管理"
        aria-haspopup="menu"
        aria-expanded={open}
        title="日记管理"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal />
      </button>
      {open ? (
        <div className="diary-global-pop" role="menu">
          <p className="diary-global-title">日记管理</p>
          <p className="diary-global-hint">自动写入由插件设置控制；这里可以单独让某本日记写今天。</p>
          {props.books.filter((book) => book.presetId !== 'default').length === 0 ? (
            <p className="diary-hint">还没有可以自动写入的预设日记簿。</p>
          ) : (
            <ul className="diary-global-list">
              {props.books.filter((book) => book.presetId !== 'default').map((book) => (
                <li key={book.presetId}>
                  <span className="diary-global-name">{book.name}</span>
                  <button
                    type="button"
                    className="diary-action"
                    disabled={running !== undefined}
                    onClick={() => void run(book)}
                  >
                    {running === book.presetId ? <Loader2 className="diary-spin" /> : <Sparkles />}
                    {running === book.presetId ? '写作中…' : '写今天'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
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
        <div className="diary-header-side">
          <div className="diary-meta-badge" aria-label={`共 ${rows.length} 本日记`}>
            <BookOpen className="diary-meta-icon" aria-hidden="true" />
            <span>共 {rows.length} 本</span>
          </div>
          <GlobalManage books={rows} />
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
