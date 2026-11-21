import * as React from 'react'
import { BookOpen, Download, Loader2, Settings2, Trash2, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { apiErrorMessage, callAction, toast, useLive } from '@chatluna/ui-client/client'
import { Menu, MenuItem } from './controls'
import type { DiaryBook } from './types'
import './diary.css'

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function BookCard(props: { book: DiaryBook; onOpen(): void }) {
  const { book } = props
  const dates = useLive('diary.dates', { presetId: book.presetId })
  const days = (dates.data?.dates ?? []).map((row) => row.date)
  const [busy, setBusy] = React.useState<'export' | 'format' | 'delete'>()
  const [confirm, setConfirm] = React.useState(false)

  const exportAll = async () => {
    if (days.length === 0) return
    setBusy('export')
    try {
      const result = await callAction('diary.days.export', { presetId: book.presetId, dates: days })
      downloadText(result.filename, result.content)
      toast.success(`已导出 ${book.name}`)
    } catch (error) {
      toast.error('导出失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const formatAll = async () => {
    setBusy('format')
    try {
      const result = await callAction('diary.book.format', { presetId: book.presetId })
      toast.success('格式整理完成', { description: `${result.changed} 天有改动` })
    } catch (error) {
      toast.error('格式化失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const removeAll = async () => {
    if (days.length === 0) return
    setBusy('delete')
    try {
      const result = await callAction('diary.days.remove', { presetId: book.presetId, dates: days })
      toast.success(`已删除 ${result.removed.length} 天`)
      setConfirm(false)
    } catch (error) {
      toast.error('删除失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="diary-book">
      <button type="button" className="diary-book-main" onClick={props.onOpen}>
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

      <div className="diary-book-manage">
        <Menu label={`管理 ${book.name}`} icon={Settings2} buttonClass="diary-icon-button is-card">
          {(close) => (
            <>
              <MenuItem
                icon={busy === 'export' ? Loader2 : Download}
                label={busy === 'export' ? '导出中…' : '导出全部'}
                disabled={busy !== undefined || days.length === 0}
                onClick={() => {
                  close()
                  void exportAll()
                }}
              />
              <MenuItem
                icon={busy === 'format' ? Loader2 : Wand2}
                label={busy === 'format' ? '整理中…' : '格式化'}
                disabled={busy !== undefined}
                onClick={() => {
                  close()
                  void formatAll()
                }}
              />
              <div className="diary-menu-sep" />
              <MenuItem
                icon={Trash2}
                label="删除全部"
                danger
                disabled={busy !== undefined || days.length === 0}
                onClick={() => {
                  close()
                  setConfirm(true)
                }}
              />
            </>
          )}
        </Menu>
      </div>

      {confirm ? (
        <div className="diary-book-confirm" role="alertdialog">
          <p>
            删除《{book.name}》全部 {days.length} 天日记和贴花？不可撤销。
          </p>
          <div className="diary-inline-actions">
            <button type="button" className="diary-action is-ghost" onClick={() => setConfirm(false)} disabled={busy !== undefined}>
              取消
            </button>
            <button type="button" className="diary-action is-danger-solid" onClick={() => void removeAll()} disabled={busy !== undefined}>
              {busy === 'delete' ? '删除中…' : '删除全部'}
            </button>
          </div>
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
