import * as React from 'react'
import { History, RotateCcw, X } from 'lucide-react'
import { apiErrorMessage, callAction, toast, useLive } from '@chatluna/ui-client/client'
import type { DiaryCommitRow, DiaryDeletedDay, DiaryDiff } from './types'
import './diary.css'

const SOURCE_LABEL: Record<string, string> = {
  webui: '手工',
  model: 'AI',
  schedule: '定时',
  system: '系统'
}

const OP_LABEL: Record<string, string> = {
  append: '追加',
  'replace-day': '重写',
  'edit-entry': '编辑',
  'delete-entry': '删篇',
  'delete-day': '删日',
  format: '整理',
  mark: '贴花',
  restore: '恢复'
}

function when(at: number) {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function dateLabel(date: string) {
  const today = new Date().toLocaleDateString('sv-SE')
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE')
  if (date === today) return `${date} 今天`
  if (date === yesterday) return `${date} 昨天`
  return date
}

function CommitRow(props: { row: DiaryCommitRow; active: boolean; onSelect(): void }) {
  const { row } = props
  return (
    <button
      type="button"
      className={props.active ? 'diary-history-row is-active' : 'diary-history-row'}
      onClick={props.onSelect}
      aria-pressed={props.active}
    >
      <span className="diary-history-row-top">
        <time dateTime={new Date(row.at).toISOString()}>{when(row.at)}</time>
        <span className={`diary-history-source is-${row.source}`}>{SOURCE_LABEL[row.source] ?? row.source}</span>
        <span className="diary-history-op">{OP_LABEL[row.op] ?? row.op}</span>
        <span className="diary-history-size">
          {row.afterExists ? bytes(row.afterBytes) : '已删除'}
        </span>
      </span>
      <span className="diary-history-summary">{row.summary}</span>
    </button>
  )
}

function DeletedRow(props: { row: DiaryDeletedDay; active: boolean; onSelect(): void }) {
  return (
    <button
      type="button"
      className={props.active ? 'diary-history-deleted is-active' : 'diary-history-deleted'}
      onClick={props.onSelect}
      aria-pressed={props.active}
    >
      <span className="diary-history-deleted-date">{props.row.date}</span>
      <span className="diary-history-deleted-meta">
        {when(props.row.at)} · {bytes(props.row.bytes)}
      </span>
      <span className="diary-history-deleted-action">可找回</span>
    </button>
  )
}

export function DiaryHistoryDrawer(props: {
  open: boolean
  presetId: string
  date?: string
  onClose(): void
  onRestored(date: string): void
}) {
  const [scope, setScope] = React.useState<'day' | 'book'>(props.date === undefined ? 'book' : 'day')
  const [limit, setLimit] = React.useState(100)
  const [selected, setSelected] = React.useState<{ id: string; date: string }>()
  const [diff, setDiff] = React.useState<DiaryDiff>()
  const [diffBusy, setDiffBusy] = React.useState(false)
  const [diffError, setDiffError] = React.useState<string>()
  const [confirm, setConfirm] = React.useState<'before' | 'after'>()
  const [restoring, setRestoring] = React.useState(false)
  const params = scope === 'day' && props.date !== undefined
    ? { presetId: props.presetId, date: props.date, limit }
    : { presetId: props.presetId, limit }
  const page = useLive('diary.history', params)

  React.useEffect(() => {
    if (!props.open) return
    setScope(props.date === undefined ? 'book' : 'day')
    setLimit(100)
    setSelected(undefined)
    setDiff(undefined)
    setConfirm(undefined)
  }, [props.open, props.date, props.presetId])

  React.useEffect(() => {
    if (!props.open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])

  const rows = page.data?.rows ?? []
  const deleted = page.data?.deleted ?? []

  React.useEffect(() => {
    if (!props.open) return
    if (rows.length === 0 && deleted.length === 0) {
      setSelected(undefined)
      return
    }
    if (selected === undefined) {
      const first = rows[0] ?? deleted[0]
      if (first !== undefined) setSelected({ id: first.id, date: first.date })
      return
    }
    const known = rows.some((row) => row.id === selected.id) || deleted.some((row) => row.id === selected.id)
    if (!known) {
      setSelected(undefined)
      setDiff(undefined)
    }
  }, [props.open, rows, deleted, selected])

  React.useEffect(() => {
    if (selected === undefined) {
      setDiff(undefined)
      setDiffError(undefined)
      return
    }
    let active = true
    setDiffBusy(true)
    setDiffError(undefined)
    callAction('diary.history.diff', { presetId: props.presetId, id: selected.id })
      .then((result) => {
        if (active) setDiff(result)
      })
      .catch((error) => {
        if (active) setDiffError(apiErrorMessage(error))
      })
      .finally(() => {
        if (active) setDiffBusy(false)
      })
    return () => {
      active = false
    }
  }, [selected, props.presetId])

  if (!props.open) return null

  const groups = new Map<string, DiaryCommitRow[]>()
  for (const row of rows) {
    const list = groups.get(row.date)
    if (list === undefined) groups.set(row.date, [row])
    else list.push(row)
  }

  const select = (id: string, date: string) => {
    setSelected({ id, date })
    setConfirm(undefined)
  }

  const restore = async (side: 'before' | 'after') => {
    if (selected === undefined) return
    setRestoring(true)
    try {
      const revision = scope === 'day' && page.data !== undefined
        ? (page.data.revision ?? '')
        : undefined
      const result = await callAction('diary.history.restore', {
        presetId: props.presetId,
        date: selected.date,
        id: selected.id,
        side,
        ...(revision === undefined ? {} : { revision })
      })
      toast.success(result.changed ? '已恢复历史版本' : '当前已经是这个版本')
      setConfirm(undefined)
      props.onRestored(selected.date)
      props.onClose()
    } catch (error) {
      toast.error('恢复失败', { description: apiErrorMessage(error) })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="diary-history-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose()
    }}>
      <aside className="diary-history-drawer" role="dialog" aria-modal="true" aria-label="日记修改历史">
        <header className="diary-history-head">
          <div>
            <p className="diary-kicker">HISTORY</p>
            <h2>
              <History className="diary-icon" aria-hidden="true" />
              修改历史
            </h2>
            <p className="diary-history-subtitle">每次写入、编辑和删除都会留底，可对比后恢复。</p>
          </div>
          <button type="button" className="diary-icon-button" aria-label="关闭历史记录" onClick={props.onClose}>
            <X />
          </button>
        </header>

        <div className="diary-history-scope" role="tablist" aria-label="历史范围">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'day'}
            className={scope === 'day' ? 'is-active' : undefined}
            disabled={props.date === undefined}
            onClick={() => {
              setScope('day')
              setSelected(undefined)
            }}
          >
            本日
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'book'}
            className={scope === 'book' ? 'is-active' : undefined}
            onClick={() => {
              setScope('book')
              setSelected(undefined)
            }}
          >
            整本
          </button>
          {scope === 'day' && props.date !== undefined ? <span className="diary-history-date">{props.date}</span> : null}
        </div>

        <div className="diary-history-body">
          {page.status === 'loading' && page.data === undefined ? (
            <p className="diary-hint">正在读取历史……</p>
          ) : (
            <>
              {scope === 'book' && deleted.length > 0 ? (
                <section className="diary-history-section">
                  <h3>可找回的已删除日期</h3>
                  <div className="diary-history-deleted-list">
                    {deleted.map((row) => (
                      <DeletedRow
                        key={row.id}
                        row={row}
                        active={selected?.id === row.id}
                        onSelect={() => select(row.id, row.date)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {rows.length === 0 && deleted.length === 0 ? (
                <div className="diary-history-empty">
                  <History className="diary-icon" aria-hidden="true" />
                  <p>还没有改动记录。</p>
                  <span>之后的写入、编辑与删除都会出现在这里。</span>
                </div>
              ) : (
                <section className="diary-history-section">
                  <h3>{scope === 'day' ? '这一天的改动' : '全部改动'}</h3>
                  {[...groups].map(([date, list]) => (
                    <div className="diary-history-group" key={date}>
                      <p className="diary-history-date-header">{dateLabel(date)}</p>
                      <ol className="diary-history-timeline">
                        {list.map((row) => (
                          <li key={row.id}>
                            <CommitRow row={row} active={selected?.id === row.id} onSelect={() => select(row.id, row.date)} />
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  {page.data?.hasMore === true ? (
                    <button
                      type="button"
                      className="diary-action is-ghost"
                      disabled={limit >= 200}
                      onClick={() => setLimit((value) => Math.min(200, value + 100))}
                    >
                      加载更早的记录
                    </button>
                  ) : null}
                </section>
              )}

              {selected === undefined ? null : (
                <section className="diary-diff-panel" aria-label="文本改动对比">
                  <header className="diary-diff-head">
                    <span>{diff?.summary ?? '改动对比'}</span>
                    <span className="diary-diff-stat">
                      <span className="is-plus">+{diff?.added ?? 0}</span>
                      <span className="is-minus">-{diff?.removed ?? 0}</span>
                    </span>
                  </header>
                  {diffError !== undefined ? (
                    <p className="diary-history-error">无法载入对比：{diffError}</p>
                  ) : diffBusy || diff === undefined ? (
                    <p className="diary-hint">正在计算差异……</p>
                  ) : (
                    <>
                      <div className="diary-diff-lines">
                        {diff.lines.map((line, index) => (
                          <div key={`${line.kind}-${index}`} className={`diary-diff-line is-${line.kind}`}>
                            <span className="diary-diff-gutter">{line.oldNo ?? ''}</span>
                            <span className="diary-diff-gutter">{line.newNo ?? ''}</span>
                            <span className="diary-diff-prefix">
                              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                            </span>
                            <span className="diary-diff-code">{line.text}</span>
                          </div>
                        ))}
                      </div>
                      {diff.truncated ? <p className="diary-hint">{diff.reason ?? '改动过长，只显示了一部分。'}</p> : null}
                      {diff.lines.length === 0 ? <p className="diary-hint">这次改动没有正文差异。</p> : null}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {selected === undefined ? null : (
          <footer className="diary-history-foot">
            {confirm === undefined ? (
              <div className="diary-inline-actions">
                <button type="button" className="diary-action is-ghost" onClick={props.onClose}>关闭</button>
                {diff?.afterExists === true ? (
                  <>
                    <button type="button" className="diary-action is-ghost" onClick={() => setConfirm('before')}>
                      <RotateCcw />
                      撤销这次改动
                    </button>
                    <button type="button" className="diary-action is-primary" onClick={() => setConfirm('after')}>
                      <RotateCcw />
                      恢复为此版本
                    </button>
                  </>
                ) : (
                  <button type="button" className="diary-action is-primary" onClick={() => setConfirm('before')}>
                    <RotateCcw />
                    找回删除的内容
                  </button>
                )}
              </div>
            ) : (
              <div className="diary-inline-confirm" role="alertdialog">
                <p>
                  {confirm === 'before' ? '恢复到这次改动之前的版本吗？' : '恢复到这次改动之后的版本吗？'}
                  当前内容会先留底，不会被直接丢掉。
                </p>
                <div className="diary-inline-actions">
                  <button type="button" className="diary-action is-ghost" disabled={restoring} onClick={() => setConfirm(undefined)}>
                    取消
                  </button>
                  <button type="button" className="diary-action is-primary" disabled={restoring} onClick={() => void restore(confirm)}>
                    {restoring ? '恢复中…' : '确认恢复'}
                  </button>
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  )
}
