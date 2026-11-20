import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { calendarBadge } from './calendar-meta'
import { MarkStamp, type MarkLevel } from './stickers'
import './diary.css'
import './styles/variant-depth.css'
import './styles/variant-signature.css'
import './preview.css'

/* ------------------------------------------------------------------ */
/* Marks: one brush circle, stacked once per importance level.          */
/* ------------------------------------------------------------------ */

const LEVELS: readonly MarkLevel[] = [1, 2, 3, 4, 5]

function LabMark(props: { level: MarkLevel; note?: string }) {
  const label = props.note ?? `重要度 ${props.level} / 5`
  return (
    <span className={`diary-mark is-level-${props.level}`} role="img" aria-label={label} title={label}>
      <MarkStamp level={props.level} className="diary-mark-svg" />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Static V2 page: the live layout, one fixed day, no live data.       */
/* ------------------------------------------------------------------ */

const MONTH_YEAR = 2026
const MONTH_VALUE = 11
const MONTH_DAYS = 30
const MONTH_OFFSET = (new Date(MONTH_YEAR, MONTH_VALUE - 1, 1).getDay() + 6) % 7
const SELECTED_DAY = 20
const TODAY_DAY = 21

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const CELL_MARKS: Record<number, MarkLevel> = { 17: 1, 18: 2, 19: 3, 20: 5, 22: 4 }

/** Live index lists the newest day first. */
const INDEX_ROWS: Array<{ day: number; level: MarkLevel }> = [
  { day: 22, level: 4 },
  { day: 20, level: 5 },
  { day: 19, level: 3 },
  { day: 18, level: 2 },
  { day: 17, level: 1 }
]

const MONTH_CELLS: Array<number | undefined> = (() => {
  const cells: Array<number | undefined> = Array.from({ length: MONTH_OFFSET }, () => undefined)
  for (let day = 1; day <= MONTH_DAYS; day += 1) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(undefined)
  return cells
})()

function dateOf(day: number) {
  return `${MONTH_YEAR}-${String(MONTH_VALUE).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function weekdayIndexOf(day: number) {
  return (MONTH_OFFSET + day - 1) % 7
}

function LabCalendar() {
  return (
    <section className="diary-calendar" aria-label={`${MONTH_YEAR} 年 ${MONTH_VALUE} 月月视图`}>
      <div className="diary-calendar-head">
        <span className="diary-calendar-btn" aria-hidden="true">
          <ChevronLeft className="diary-icon" />
        </span>
        <h2>
          <span className="diary-month-year">{MONTH_YEAR}</span>
          <span className="diary-month-value">{MONTH_VALUE}</span>
          <span className="diary-month-unit">月</span>
        </h2>
        <div className="diary-calendar-nav">
          <span className="diary-calendar-btn" aria-hidden="true">
            <ChevronRight className="diary-icon" />
          </span>
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
        {MONTH_CELLS.map((day, index) => {
          if (day === undefined) return <span key={`blank-${index}`} className="diary-cell is-blank" />
          const date = dateOf(day)
          const badge = calendarBadge(date)
          const level = CELL_MARKS[day]
          const weekday = weekdayIndexOf(day)
          const selected = day === SELECTED_DAY
          const today = day === TODAY_DAY
          return (
            <button
              key={date}
              type="button"
              className={[
                'diary-cell',
                selected ? 'is-selected' : '',
                today ? 'is-today' : '',
                weekday === 5 ? 'is-saturday' : '',
                weekday === 6 ? 'is-sunday' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selected}
              aria-current={today ? 'date' : undefined}
              aria-label={[
                `${MONTH_VALUE} 月 ${day} 日`,
                WEEKDAY_NAMES[weekday],
                badge?.text ?? '',
                level === undefined ? '' : `标记：重要度 ${level} / 5`
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="diary-cell-top">
                <span className="diary-cell-day">{day}</span>
              </span>
              {badge === undefined ? null : (
                <span className={`diary-badge is-${badge.tone}`} aria-hidden="true">
                  {badge.text}
                </span>
              )}
              {level === undefined ? null : (
                <span className="diary-cell-marks">
                  <LabMark level={level} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function LabIndex() {
  return (
    <aside className="diary-index" aria-label="日记索引">
      <div className="diary-index-head">
        <span>日记索引</span>
        <span>{INDEX_ROWS.length} 天</span>
      </div>
      <section className="diary-index-month">
        <h3>
          {MONTH_YEAR} 年 {MONTH_VALUE} 月
        </h3>
        <ul>
          {INDEX_ROWS.map((row) => (
            <li key={row.day}>
              <button
                type="button"
                className={row.day === SELECTED_DAY ? 'diary-index-row is-selected' : 'diary-index-row'}
                aria-pressed={row.day === SELECTED_DAY}
                aria-label={`${dateOf(row.day)} ${WEEKDAY_NAMES[weekdayIndexOf(row.day)]} · 重要度 ${row.level} / 5`}
              >
                <span className="diary-index-day">{dateOf(row.day).slice(5)}</span>
                <span className="diary-index-weekday">{WEEKDAY_NAMES[weekdayIndexOf(row.day)]}</span>
                <span className="diary-index-meta">
                  <LabMark level={row.level} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function LabReading() {
  return (
    <section className="diary-reading" aria-label="选中日期的日记">
      <header className="diary-reading-head">
        <div className="diary-reading-date">
          <p className="diary-kicker">SELECTED DAY</p>
          <div className="diary-reading-title">
            <h2>{dateOf(SELECTED_DAY)}</h2>
            <span className="diary-reading-weekday">{WEEKDAY_NAMES[weekdayIndexOf(SELECTED_DAY)]}</span>
          </div>
          <span className="diary-reading-rule" aria-hidden="true" />
        </div>
        <div className="diary-mark-note">
          <LabMark level={5} note="第一次把这一页写满" />
          <span>第一次把这一页写满</span>
        </div>
      </header>

      <article className="diary-paper">
        <div className="diary-markdown">
          <h2>第一次</h2>
          <p>
            <em>{dateOf(SELECTED_DAY)} Fri 18:45</em>
          </p>
          <p>
            今天第一次把这一页写满。笔尖在纸上停了一会儿，朱红的圈画得不算圆——想让它看起来像被谁认真地圈起来，
            而不是随手盖上去的。
          </p>
          <p>窗外的光落在纸上，纸是暖的。愿这一天被记住。</p>
        </div>
      </article>
    </section>
  )
}

function LabBookPage() {
  return (
    <div className="diary-page variant-depth variant-signature">
      <header className="diary-header">
        <div className="diary-title">
          <p className="diary-kicker">DIARY BOOK</p>
          <h1>日记样张</h1>
          <p className="diary-subtitle">把今天轻轻收进这一页。</p>
        </div>
        <span className="diary-meta-badge">
          <Calendar className="diary-meta-icon" aria-hidden="true" />
          <time dateTime={dateOf(SELECTED_DAY)}>11月20日 周五</time>
        </span>
      </header>

      <LabCalendar />

      <div className="diary-lower">
        <LabIndex />
        <LabReading />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function DiaryPreviewPage() {
  return (
    <div className="diary-mark-lab">
      <header className="diary-lab-intro">
        <p className="diary-kicker">STAMP STACKS</p>
        <h1>一枚朱圈，叠成五级</h1>
        <p>同一枚手绘朱圈；越重要，叠得越多。</p>
      </header>

      <section className="diary-lab-block" aria-labelledby="diary-lab-gallery-title">
        <header className="diary-lab-head">
          <h2 id="diary-lab-gallery-title">五级叠印</h2>
          <p>从叠一次到叠五次，形状不变，只多落一遍笔。</p>
        </header>
        <div className="diary-mark-gallery">
          {LEVELS.map((level) => (
            <figure key={level} className="diary-mark-card">
              <span className="diary-mark-level">L{level}</span>
              <span className="diary-mark-stage">
                <span className={`diary-mark is-level-${level}`} aria-hidden="true">
                  <MarkStamp level={level} className="diary-mark-svg" />
                </span>
              </span>
              <figcaption className="diary-mark-caption">
                <span className="diary-mark-name">叠 {level}</span>
                <span className="diary-mark-desc">同一枚朱圈叠 {level} 次。</span>
                <span className="diary-mark-meta">重要度 {level} / 5</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="diary-lab-block" aria-labelledby="diary-lab-page-title">
        <header className="diary-lab-head">
          <p className="diary-kicker">V2 · DIARY BOOK</p>
          <h2 id="diary-lab-page-title">线上页面</h2>
          <p>2026 年 11 月 20 日：月历、索引与正文里的落款，用的都是线上那一套类名。</p>
        </header>
        <div className="diary-lab-v2">
          <LabBookPage />
        </div>
      </section>
    </div>
  )
}
