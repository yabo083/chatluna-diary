import * as React from 'react'
import MarkdownIt from 'markdown-it-ts'
import { apiErrorMessage, callAction, toast, useLive } from '@chatluna/ui-client/client'
import { Calendar, Check, ChevronLeft, ChevronRight, Download, ListChecks, Plus, Stamp, Trash2, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import type { DiaryDateRow, DiaryEntryRow, DiaryMark } from './types'
import { calendarBadge } from './calendar-meta'
import { EntryMenu, InlineConfirm, InlineEntryForm, MarkEditor } from './controls'
import { MarkStamp, type MarkLevel } from './stickers'
import './diary.css'
import './styles/variant-signature.css'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

// Diary-local images are fetched with the session token, so render a blank
// placeholder instead of letting the browser request an unsupported scheme.
// Any other image is blocked: a model-written body must not probe external or
// localhost URLs just because the diary is opened.
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const src = token.attrGet('src') ?? ''
  if (!src.startsWith('diary-media:')) {
    token.attrSet('src', BLANK_IMAGE)
    token.attrSet('alt', `${token.content || '图片'}（外部图片已屏蔽）`)
    return self.renderToken(tokens, index, options)
  }
  token.attrSet('src', BLANK_IMAGE)
  token.attrSet('data-diary-media', src.slice('diary-media:'.length))
  return self.renderToken(tokens, index, options)
}

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  token.attrSet('rel', 'noopener noreferrer')
  token.attrSet('target', '_blank')
  return self.renderToken(tokens, index, options)
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(year, value - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Monday-first index: 0 = 一 … 5 = 六, 6 = 日 */
function weekdayOf(date: string) {
  return WEEKDAY_NAMES[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]
}

const MEDIA_CACHE_LIMIT = 24
const mediaCache = new Map<string, string>()

/**
 * Diary images are base64 over an authenticated action; decoding is expensive
 * and date switches used to revoke every blob. Keep a small LRU of blob URLs
 * and revoke only on eviction.
 */
async function mediaUrl(presetId: string, file: string) {
  const key = `${presetId}\0${file}`
  const cached = mediaCache.get(key)
  if (cached !== undefined) {
    mediaCache.delete(key)
    mediaCache.set(key, cached)
    return cached
  }
  const { mime, data } = await callAction('diary.media', { presetId, file })
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  mediaCache.set(key, url)
  while (mediaCache.size > MEDIA_CACHE_LIMIT) {
    const oldest = mediaCache.keys().next().value
    if (oldest === undefined) break
    const stale = mediaCache.get(oldest)
    mediaCache.delete(oldest)
    if (stale !== undefined) URL.revokeObjectURL(stale)
  }
  return url
}

/** Marks carry a free number; the hand-drawn stamps only know five steps. */
function markLevel(level: number): MarkLevel {
  const stepped = Math.min(5, Math.max(1, Math.round(level)))
  return stepped as MarkLevel
}

function markLabel(level: number, note?: string) {
  return note ?? `重要度 ${level} / 5`
}

/** One hand-drawn stamp; the level sets size and ink density, not a row of icons. */
function DiaryMark(props: { level: number; note?: string }) {
  const step = markLevel(props.level)
  const label = markLabel(props.level, props.note)
  return (
    <span className={`diary-mark is-level-${step}`} role="img" aria-label={label} title={label}>
      <MarkStamp level={step} className="diary-mark-svg" />
    </span>
  )
}

export function DiaryBookPage() {
  const { presetId = 'default' } = useParams()
  const navigate = useNavigate()
  const books = useLive('diary.books')
  const dates = useLive('diary.dates', { presetId })
  const marks = useLive('diary.marks', { presetId })
  const today = new Date().toLocaleDateString('sv-SE')
  const [, todayMonth, todayDay] = today.split('-')
  const todayWeekday = new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' })
  const todayLabel = `${Number(todayMonth)}月${Number(todayDay)}日 ${todayWeekday}`
  const [month, setMonth] = React.useState(today.slice(0, 7))
  const [selected, setSelected] = React.useState(today)
  const entry = useLive('diary.entry', { presetId, date: selected })
  const book = books.data?.books.find((row) => row.presetId === presetId)
  const [composeOpen, setComposeOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<DiaryEntryRow>()
  const [dayEditing, setDayEditing] = React.useState(false)
  const [dayDraft, setDayDraft] = React.useState('')
  const [markOpen, setMarkOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<string>()
  const [confirm, setConfirm] = React.useState<{ kind: 'entry'; row: DiaryEntryRow } | { kind: 'day' }>()
  const [batch, setBatch] = React.useState(false)
  const [selectedDates, setSelectedDates] = React.useState<Set<string>>(new Set())
  const [batchConfirm, setBatchConfirm] = React.useState(false)
  const [batchBusy, setBatchBusy] = React.useState<string>()
  const gridRef = React.useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = React.useState<{ left: number; top: number; width: number; height: number }>()

  React.useEffect(() => {
    setComposeOpen(false)
    setEditing(undefined)
    setDayEditing(false)
    setMarkOpen(false)
    setConfirm(undefined)
    setBusy(undefined)
  }, [presetId, selected])

  React.useEffect(() => {
    setMonth(today.slice(0, 7))
    setSelected(today)
  }, [presetId, today])

  const rows = React.useMemo(() => {
    const map = new Map<string, DiaryDateRow>()
    for (const row of dates.data?.dates ?? []) map.set(row.date, row)
    return map
  }, [dates.data])

  const marksByDate = React.useMemo(() => {
    const map = new Map<string, DiaryMark>()
    for (const mark of marks.data?.marks ?? []) map.set(mark.date, mark)
    return map
  }, [marks.data])

  const indexRows = React.useMemo(() => {
    const map = new Map<string, DiaryDateRow & { mark?: DiaryMark }>()
    for (const row of dates.data?.dates ?? []) map.set(row.date, { ...row })
    for (const mark of marks.data?.marks ?? []) {
      const row = map.get(mark.date)
      if (row === undefined) map.set(mark.date, { date: mark.date, mark })
      else row.mark = mark
    }
    return [...map.values()].sort((left, right) => right.date.localeCompare(left.date))
  }, [dates.data, marks.data])

  const indexGroups = React.useMemo(() => {
    const groups = new Map<string, typeof indexRows>()
    for (const row of indexRows) {
      const monthKey = row.date.slice(0, 7)
      const monthRows = groups.get(monthKey)
      if (monthRows === undefined) groups.set(monthKey, [row])
      else monthRows.push(row)
    }
    return groups
  }, [indexRows])

  const [year, monthValue] = month.split('-').map(Number)
  const offset = (new Date(year, monthValue - 1, 1).getDay() + 6) % 7
  const total = new Date(year, monthValue, 0).getDate()
  const cells: (number | undefined)[] = [
    ...Array.from({ length: offset }, () => undefined),
    ...Array.from({ length: total }, (_, index) => index + 1)
  ]
  while (cells.length % 7 !== 0) cells.push(undefined)
  const monthDates = cells
    .filter((day): day is number => day !== undefined)
    .map((day) => `${month}-${String(day).padStart(2, '0')}`)

  const entries = entry.data?.entries ?? []
  const entryRef = React.useRef<HTMLElement>(null)
  const composerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const root = entryRef.current
    if (root === null) return
    let cancelled = false
    const load = (image: HTMLImageElement) => {
      const file = image.dataset.diaryMedia ?? ''
      if (file === '' || image.dataset.diaryLoaded === '1') return
      image.dataset.diaryLoaded = '1'
      void mediaUrl(presetId, file)
        .then((url) => {
          if (!cancelled) image.src = url
        })
        .catch(() => {
          if (!cancelled) image.alt = `${image.alt}（图片加载失败）`
        })
    }
    const scan = () => root.querySelectorAll<HTMLImageElement>('img[data-diary-media]').forEach(load)
    scan()
    const observer = new MutationObserver(scan)
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [entry.data, presetId, editing, dayEditing])

  const selectedMark = entry.data?.mark ?? marksByDate.get(selected)

  const goToday = () => {
    setMonth(today.slice(0, 7))
    setSelected(today)
  }

  const saveNew = async (title: string, body: string) => {
    if (title.trim() === '') return toast.error('标题不能为空')
    if (body.trim() === '') return toast.error('正文不能为空')
    setBusy('create')
    try {
      await callAction('diary.entry.save', {
        presetId,
        date: selected,
        title: title.trim(),
        body,
        ...(entry.data?.revision === null || entry.data?.revision === undefined ? {} : { revision: entry.data.revision })
      })
      toast.success('已追加一篇')
      setComposeOpen(false)
    } catch (error) {
      toast.error('追加失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const saveEdit = async (title: string, body: string) => {
    if (editing === undefined) return
    if (title.trim() === '') return toast.error('标题不能为空')
    if (body.trim() === '') return toast.error('正文不能为空')
    setBusy('edit')
    try {
      await callAction('diary.entry.save', {
        presetId,
        date: selected,
        index: editing.index,
        digest: editing.digest,
        title: title.trim(),
        body,
        ...(entry.data?.revision === null || entry.data?.revision === undefined ? {} : { revision: entry.data.revision })
      })
      toast.success('已保存修改')
      setEditing(undefined)
    } catch (error) {
      toast.error('保存失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const saveDay = async () => {
    setBusy('day')
    try {
      await callAction('diary.day.write', {
        presetId,
        date: selected,
        markdown: dayDraft,
        ...(entry.data?.revision === null || entry.data?.revision === undefined ? {} : { revision: entry.data.revision })
      })
      toast.success('已保存当天日记')
      setDayEditing(false)
    } catch (error) {
      toast.error('保存失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const removeEntry = async () => {
    if (confirm?.kind !== 'entry') return
    setBusy('delete-entry')
    try {
      await callAction('diary.entry.remove', {
        presetId,
        date: selected,
        index: confirm.row.index,
        digest: confirm.row.digest,
        ...(entry.data?.revision === null || entry.data?.revision === undefined ? {} : { revision: entry.data.revision })
      })
      toast.success('已删除这一篇')
      if (editing?.index === confirm.row.index) setEditing(undefined)
      setConfirm(undefined)
    } catch (error) {
      toast.error('删除失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const removeDay = async () => {
    setBusy('delete-day')
    try {
      await callAction('diary.day.remove', {
        presetId,
        date: selected,
        ...(entry.data?.revision === null || entry.data?.revision === undefined ? {} : { revision: entry.data.revision })
      })
      toast.success('已删除当天日记')
      setConfirm(undefined)
      setDayEditing(false)
    } catch (error) {
      toast.error('删除失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const saveMark = async (level: number, note: string) => {
    setBusy('mark')
    try {
      await callAction('diary.mark.save', { presetId, date: selected, level, note: note || undefined })
      toast.success('贴花已保存')
      setMarkOpen(false)
    } catch (error) {
      toast.error('贴花保存失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const removeMark = async () => {
    setBusy('mark')
    try {
      await callAction('diary.mark.remove', { presetId, date: selected })
      toast.success('贴花已移除')
      setMarkOpen(false)
    } catch (error) {
      toast.error('贴花移除失败', { description: apiErrorMessage(error) })
    } finally {
      setBusy(undefined)
    }
  }

  React.useEffect(() => {
    if (!composeOpen) return
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [composeOpen])

  React.useEffect(() => {
    setBatch(false)
    setSelectedDates(new Set())
    setBatchConfirm(false)
    setBatchBusy(undefined)
  }, [presetId])

  const toggleBatch = () => {
    setBatch((value) => !value)
    setSelectedDates(new Set())
    setBatchConfirm(false)
  }

  const toggleDate = (date: string) => {
    setSelectedDates((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const startDrag = (event: React.PointerEvent, date?: string) => {
    if (!batch || event.button !== 0) return
    const grid = gridRef.current
    if (grid === null) return
    event.preventDefault()
    const box = grid.getBoundingClientRect()
    const startX = event.clientX - box.left
    const startY = event.clientY - box.top
    const drag = {
      startX,
      startY,
      base: new Set(selectedDates),
      mode: event.altKey ? ('remove' as const) : ('add' as const),
      moved: false,
      startDate: date
    }
    setMarquee({ left: startX, top: startY, width: 0, height: 0 })

    const move = (moveEvent: PointerEvent) => {
      const x = moveEvent.clientX - box.left
      const y = moveEvent.clientY - box.top
      if (!drag.moved && Math.abs(x - startX) + Math.abs(y - startY) > 4) drag.moved = true
      if (!drag.moved) return
      const left = Math.min(startX, x)
      const top = Math.min(startY, y)
      const right = Math.max(startX, x)
      const bottom = Math.max(startY, y)
      setMarquee({ left, top, width: right - left, height: bottom - top })
      const next = new Set(drag.base)
      for (const cell of grid.querySelectorAll<HTMLButtonElement>('button[data-date]')) {
        const rect = cell.getBoundingClientRect()
        const cellLeft = rect.left - box.left
        const cellTop = rect.top - box.top
        const intersects = cellLeft < right && cellLeft + rect.width > left && cellTop < bottom && cellTop + rect.height > top
        if (!intersects) continue
        const value = cell.dataset.date
        if (value === undefined) continue
        if (drag.mode === 'add') next.add(value)
        else next.delete(value)
      }
      setSelectedDates(next)
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      setMarquee(undefined)
      if (!drag.moved && drag.startDate !== undefined) toggleDate(drag.startDate)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  const selectMonth = () => setSelectedDates(new Set(monthDates))

  const exportSelected = async () => {
    const chosen = [...selectedDates].sort()
    if (chosen.length === 0) return
    setBatchBusy('export')
    try {
      const result = await callAction('diary.days.export', { presetId, dates: chosen })
      const url = URL.createObjectURL(new Blob([result.content], { type: 'text/markdown;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${chosen.length} 天`)
    } catch (error) {
      toast.error('导出失败', { description: apiErrorMessage(error) })
    } finally {
      setBatchBusy(undefined)
    }
  }

  const removeSelected = async () => {
    const chosen = [...selectedDates].sort()
    if (chosen.length === 0) return
    setBatchBusy('delete')
    try {
      const result = await callAction('diary.days.remove', { presetId, dates: chosen })
      toast.success(`已删除 ${result.removed.length} 天`)
      setBatchConfirm(false)
      setSelectedDates(new Set())
      setBatch(false)
    } catch (error) {
      toast.error('删除失败', { description: apiErrorMessage(error) })
    } finally {
      setBatchBusy(undefined)
    }
  }

  return (
    <div className="diary-page variant-depth variant-signature">
      <button type="button" className="diary-back" onClick={() => void navigate('/diary')}>
        <ChevronLeft className="diary-icon" aria-hidden="true" /> 全部日记簿
      </button>

      <header className="diary-header">
        <div className="diary-title">
          <p className="diary-kicker">DIARY BOOK</p>
          <h1>{book?.name ?? presetId}</h1>
          <p className="diary-subtitle">把今天轻轻收进这一页。</p>
        </div>
        <div className="diary-header-side">
          <button
            type="button"
            className="diary-meta-badge is-interactive"
            onClick={toggleBatch}
            aria-pressed={batch}
            title="批量选择日期"
          >
            <ListChecks className="diary-meta-icon" aria-hidden="true" />
            <span>批量</span>
          </button>
          <button
            type="button"
            className="diary-meta-badge is-interactive"
            onClick={goToday}
            title="回到今天"
            aria-label={`回到今天（${todayLabel}）`}
          >
            <Calendar className="diary-meta-icon" aria-hidden="true" />
            <time dateTime={today}>{todayLabel}</time>
          </button>
        </div>
      </header>

      {batch ? (
        <div className="diary-batch-bar">
          <span className="diary-batch-status">
            <ListChecks /> 已选 {selectedDates.size} 天
          </span>
          <div className="diary-inline-actions">
            <button type="button" className="diary-action" onClick={selectMonth} disabled={batchBusy !== undefined}>
              <Check />
              全选本月
            </button>
            <button type="button" className="diary-action" onClick={() => setSelectedDates(new Set())} disabled={batchBusy !== undefined || selectedDates.size === 0}>
              清空
            </button>
            <button type="button" className="diary-action" disabled={selectedDates.size === 0 || batchBusy !== undefined} onClick={() => void exportSelected()}>
              <Download />
              {batchBusy === 'export' ? '导出中…' : '导出选中'}
            </button>
            <button
              type="button"
              className="diary-action is-ghost is-danger"
              disabled={selectedDates.size === 0 || batchBusy !== undefined}
              onClick={() => setBatchConfirm(true)}
            >
              <Trash2 />
              删除选中
            </button>
            <button type="button" className="diary-action is-ghost" onClick={toggleBatch} disabled={batchBusy !== undefined}>
              <X />
              退出
            </button>
          </div>
          {batchConfirm ? (
            <InlineConfirm
              message={`确定删除选中的 ${selectedDates.size} 天日记和贴花？不可撤销。`}
              busy={batchBusy === 'delete'}
              confirmLabel="删除选中"
              onConfirm={() => void removeSelected()}
              onCancel={() => setBatchConfirm(false)}
            />
          ) : null}
        </div>
      ) : null}

      <section className="diary-calendar" aria-label={`${year} 年 ${monthValue} 月月视图`}>
        <div className="diary-calendar-head">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上个月">
            <ChevronLeft className="diary-icon" aria-hidden="true" />
          </button>
          <h2>
            <span className="diary-month-year">{year}</span>
            <span className="diary-month-value">{monthValue}</span>
            <span className="diary-month-unit">月</span>
          </h2>
          <div className="diary-calendar-nav">
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="下个月">
              <ChevronRight className="diary-icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="diary-weekdays" aria-hidden="true">
          {WEEKDAYS.map((label, index) => (
            <span key={label} className={index === 5 ? 'is-saturday' : index === 6 ? 'is-sunday' : undefined}>
              {label}
            </span>
          ))}
        </div>

        <div className={batch ? 'diary-grid is-batch' : 'diary-grid'} ref={gridRef}>
          {marquee === undefined ? null : (
            <span
              className="diary-marquee"
              style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
              aria-hidden="true"
            />
          )}
          {cells.map((day, index) => {
            if (day === undefined) return <span key={`blank-${index}`} className="diary-cell is-blank" />
            const date = `${month}-${String(day).padStart(2, '0')}`
            const row = rows.get(date)
            const badge = calendarBadge(date)
            const mark = marksByDate.get(date)
            const weekday = (offset + day - 1) % 7
            const batchSelected = batch && selectedDates.has(date)
            const label = [
              `${monthValue} 月 ${day} 日`,
              WEEKDAY_NAMES[weekday],
              badge?.text ?? '',
              row === undefined ? '' : '有记录',
              mark === undefined ? '' : `标记：${markLabel(mark.level, mark.note)}`,
              batchSelected ? '已选中' : ''
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={date}
                type="button"
                data-date={date}
                className={[
                  'diary-cell',
                  date === selected ? 'is-selected' : '',
                  date === today ? 'is-today' : '',
                  batch ? 'is-batch' : '',
                  batchSelected ? 'is-batch-selected' : '',
                  weekday === 5 ? 'is-saturday' : '',
                  weekday === 6 ? 'is-sunday' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (!batch) setSelected(date)
                }}
                onPointerDown={(event) => startDrag(event, date)}
                aria-label={label}
                aria-pressed={batch ? batchSelected : date === selected}
                aria-current={batch ? undefined : date === today ? 'date' : undefined}
              >
                <span className="diary-cell-top">
                  <span className="diary-cell-day">{day}</span>
                  {batchSelected ? <Check className="diary-batch-check" aria-hidden="true" /> : null}
                </span>
                {badge === undefined ? null : (
                  <span className={`diary-badge is-${badge.tone}`} aria-hidden="true">
                    {badge.text}
                  </span>
                )}
                {mark === undefined ? null : (
                  <span className="diary-cell-marks">
                    <DiaryMark level={mark.level} note={mark.note} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <div className="diary-lower">
        <aside className="diary-index" aria-label="日记索引">
          <div className="diary-index-head">
            <span>日记索引</span>
            <span>{indexRows.length} 天</span>
          </div>
          {indexGroups.size === 0 ? (
            <p className="diary-hint">还没有哪一天被写下来。</p>
          ) : (
            [...indexGroups].map(([monthKey, monthRows]) => (
              <section className="diary-index-month" key={monthKey}>
                <h3>
                  {monthKey.slice(0, 4)} 年 {Number(monthKey.slice(5))} 月
                </h3>
                <ul>
                  {monthRows.map((row) => (
                    <li key={row.date}>
                      <button
                        type="button"
                        className={row.date === selected ? 'diary-index-row is-selected' : 'diary-index-row'}
                        onClick={() => setSelected(row.date)}
                        aria-pressed={row.date === selected}
                        aria-label={
                          row.mark === undefined
                            ? `${row.date} ${weekdayOf(row.date)}`
                            : `${row.date} ${weekdayOf(row.date)} · ${markLabel(row.mark.level, row.mark.note)}`
                        }
                      >
                        <span className="diary-index-day">{row.date.slice(5)}</span>
                        <span className="diary-index-weekday">{weekdayOf(row.date)}</span>
                        {row.mark === undefined ? null : (
                          <span className="diary-index-meta">
                            <DiaryMark level={row.mark.level} note={row.mark.note} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </aside>

        <section className="diary-reading" aria-label="选中日期的日记">
          <header className="diary-reading-head">
            <div className="diary-reading-date">
              <p className="diary-kicker">SELECTED DAY</p>
              <div className="diary-reading-title">
                <h2>{selected}</h2>
                <span className="diary-reading-weekday">{weekdayOf(selected)}</span>
              </div>
              <span className="diary-reading-rule" aria-hidden="true" />
            </div>
          </header>

          {dayEditing ? (
            <section className="diary-paper diary-day-editor">
              <div className="diary-entry-head">
                <div>
                  <h3>编辑当天</h3>
                  <p className="diary-entry-time">Markdown 源文；保存会整篇替换。</p>
                </div>
              </div>
              <textarea
                className="diary-textarea diary-day-textarea"
                value={dayDraft}
                onChange={(event) => setDayDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="diary-inline-actions">
                <button type="button" className="diary-action is-ghost" onClick={() => setDayEditing(false)} disabled={busy === 'day'}>
                  取消
                </button>
                <button type="button" className="diary-action is-primary" onClick={() => void saveDay()} disabled={busy === 'day'}>
                  {busy === 'day' ? '保存中…' : '保存当天'}
                </button>
              </div>
            </section>
          ) : (
            <article className="diary-paper" ref={entryRef} aria-busy={entry.status === 'loading'}>
              {confirm?.kind === 'day' ? (
                <InlineConfirm
                  message={`确定删除 ${selected} 的整篇日记吗？包含全部条目与贴花，不可撤销。`}
                  busy={busy === 'delete-day'}
                  confirmLabel="彻底删除"
                  onConfirm={() => void removeDay()}
                  onCancel={() => setConfirm(undefined)}
                />
              ) : null}

              {markOpen ? (
                <MarkEditor
                  mark={entry.data?.mark ?? null}
                  busy={busy === 'mark'}
                  onSave={(level, note) => void saveMark(level, note)}
                  onRemove={() => void removeMark()}
                  onCancel={() => setMarkOpen(false)}
                />
              ) : null}

              {entry.status === 'loading' ? (
                <p className="diary-hint">正在翻到 {selected}……</p>
              ) : entries.length > 0 ? (
                entries.map((row) => (
                  <section className="diary-entry" key={`${row.index}:${row.digest}`}>
                    <header className="diary-entry-head">
                      <div className="diary-entry-title">
                        <h3>{row.title}</h3>
                        <time className="diary-entry-time">{row.time}</time>
                      </div>
                      {editing?.index === row.index ? null : (
                        <EntryMenu
                          title={row.title}
                          onEdit={() => {
                            setComposeOpen(false)
                            setEditing(row)
                            setConfirm(undefined)
                          }}
                          onDelete={() => {
                            setEditing(undefined)
                            setConfirm({ kind: 'entry', row })
                          }}
                        />
                      )}
                    </header>
                    {editing?.index === row.index ? (
                      <InlineEntryForm
                        heading="编辑这一篇"
                        title={row.title}
                        body={row.body}
                        busy={busy === 'edit'}
                        onSave={(title, body) => void saveEdit(title, body)}
                        onCancel={() => setEditing(undefined)}
                      />
                    ) : (
                      <div className="diary-markdown" dangerouslySetInnerHTML={{ __html: markdown.render(row.body) }} />
                    )}
                    {confirm?.kind === 'entry' && confirm.row.index === row.index ? (
                      <InlineConfirm
                        message={`确定删除《${row.title}》？只删除这一篇，不可撤销。`}
                        busy={busy === 'delete-entry'}
                        onConfirm={() => void removeEntry()}
                        onCancel={() => setConfirm(undefined)}
                      />
                    ) : null}
                  </section>
                ))
              ) : (entry.data?.markdown.trim() ?? '') !== '' ? (
                <section className="diary-entry">
                  <header className="diary-entry-head">
                    <div className="diary-entry-title">
                      <h3>无标题随笔</h3>
                      <time className="diary-entry-time">旧格式内容</time>
                    </div>
                  </header>
                  <div
                    className="diary-markdown"
                    dangerouslySetInnerHTML={{
                      __html: markdown.render((entry.data?.markdown ?? '').replace(/^#\s*\d{4}-\d{2}-\d{2}\s*\n+/, ''))
                    }}
                  />
                </section>
              ) : composeOpen ? null : (
                <div className="diary-empty-state">
                  <p className="diary-empty">这一天还是空白。也许可以留一句话给它。</p>
                  <div className="diary-inline-actions">
                    <button type="button" className="diary-action" onClick={() => setComposeOpen(true)}>
                      <Plus />
                      手动写一笔
                    </button>
                  </div>
                </div>
              )}

              <div className="diary-paper-tools">
                <div className="diary-paper-mark">
                  {selectedMark === undefined ? <Stamp className="diary-icon" aria-hidden="true" /> : <DiaryMark level={selectedMark.level} note={selectedMark.note} />}
                  <span>{selectedMark === undefined ? '未贴花' : markLabel(selectedMark.level, selectedMark.note)}</span>
                  <button type="button" className="diary-action" onClick={() => setMarkOpen((value) => !value)}>
                    改等级
                  </button>
                </div>
                <div className="diary-inline-actions">
                  <button
                    type="button"
                    className="diary-action is-ghost"
                    onClick={() => {
                      setDayDraft(entry.data?.markdown.trim() ? entry.data.markdown : `# ${selected}\n`)
                      setMarkOpen(false)
                      setComposeOpen(false)
                      setEditing(undefined)
                      setDayEditing(true)
                    }}
                  >
                    编辑当天
                  </button>
                  <button type="button" className="diary-action is-ghost is-danger" onClick={() => setConfirm({ kind: 'day' })}>
                    <Trash2 />
                    删除当天
                  </button>
                </div>
              </div>

              <div className="diary-composer" ref={composerRef}>
                {composeOpen ? (
                  <InlineEntryForm
                    heading="新增一篇"
                    title=""
                    body=""
                    busy={busy === 'create'}
                    onSave={(title, body) => void saveNew(title, body)}
                    onCancel={() => setComposeOpen(false)}
                  />
                ) : (
                  <button type="button" className="diary-composer-trigger" onClick={() => setComposeOpen(true)}>
                    <Plus />
                    写一笔
                  </button>
                )}
              </div>
            </article>
          )}
        </section>
      </div>
    </div>
  )
}
