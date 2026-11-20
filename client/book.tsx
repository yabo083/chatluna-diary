import * as React from 'react'
import MarkdownIt from 'markdown-it-ts'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { callAction, useLive } from '@chatluna/ui-client/client'
import type { DiaryDateRow, DiaryMark } from './types'
import { calendarBadge } from './calendar-meta'
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

/** The page header already names the day; the file's date header and byline date repeat it. */
function displayMarkdown(markdown: string) {
  return markdown
    .replace(/^#\s*\d{4}-\d{2}-\d{2}\s*\n+/, '')
    .replace(/^(##\s+[^\n]+\n\*)\d{4}-\d{2}-\d{2}\s+/gm, '$1')
    .trimStart()
}

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

  const html = React.useMemo(
    () => markdown.render(displayMarkdown(entry.data?.markdown ?? '')),
    [entry.data?.markdown]
  )
  const entryRef = React.useRef<HTMLElement>(null)

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
  }, [html, presetId])

  const selectedMark = entry.data?.mark ?? marksByDate.get(selected)

  const goToday = () => {
    setMonth(today.slice(0, 7))
    setSelected(today)
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
      </header>

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

        <div className="diary-grid">
          {cells.map((day, index) => {
            if (day === undefined) return <span key={`blank-${index}`} className="diary-cell is-blank" />
            const date = `${month}-${String(day).padStart(2, '0')}`
            const row = rows.get(date)
            const badge = calendarBadge(date)
            const mark = marksByDate.get(date)
            const weekday = (offset + day - 1) % 7
            const label = [
              `${monthValue} 月 ${day} 日`,
              WEEKDAY_NAMES[weekday],
              badge?.text ?? '',
              row === undefined ? '' : '有记录',
              mark === undefined ? '' : `标记：${markLabel(mark.level, mark.note)}`
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={date}
                type="button"
                className={[
                  'diary-cell',
                  date === selected ? 'is-selected' : '',
                  date === today ? 'is-today' : '',
                  weekday === 5 ? 'is-saturday' : '',
                  weekday === 6 ? 'is-sunday' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(date)}
                aria-label={label}
                aria-pressed={date === selected}
                aria-current={date === today ? 'date' : undefined}
              >
                <span className="diary-cell-top">
                  <span className="diary-cell-day">{day}</span>
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
            {selectedMark === undefined ? null : (
              <div className="diary-mark-note">
                <DiaryMark level={selectedMark.level} note={selectedMark.note} />
                <span>{markLabel(selectedMark.level, selectedMark.note)}</span>
              </div>
            )}
          </header>

          <article className="diary-paper" ref={entryRef} aria-busy={entry.status === 'loading'}>
            {entry.status === 'loading' ? (
              <p className="diary-hint">正在翻到 {selected}……</p>
            ) : entry.data === null || entry.data.markdown.trim() === '' ? (
              <p className="diary-empty">这一天还是空白。也许可以留一句话给它。</p>
            ) : (
              <div className="diary-markdown" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
