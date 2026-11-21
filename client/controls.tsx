import * as React from 'react'
import {
  MoreHorizontal,
  Pencil,
  Stamp,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import './diary.css'

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}

export function MenuItem(props: {
  icon: LucideIcon
  label: string
  danger?: boolean
  disabled?: boolean
  onClick(): void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      role="menuitem"
      className={props.danger === true ? 'diary-menu-item is-danger' : 'diary-menu-item'}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon />
      <span>{props.label}</span>
    </button>
  )
}

export function Menu(props: {
  label: string
  icon?: LucideIcon
  buttonClass?: string
  children(close: () => void): React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  const Icon = props.icon ?? MoreHorizontal
  return (
    <div className="diary-menu" ref={ref}>
      <button
        type="button"
        className={props.buttonClass ?? 'diary-icon-button'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        title={props.label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon />
      </button>
      {open ? (
        <div className="diary-menu-pop" role="menu">
          {props.children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function EntryMenu(props: {
  title: string
  markLevel?: number
  onEdit(): void
  onDelete(): void
  onMark(level: number): void
  onRemoveMark(): void
  onDeleteDay(): void
}) {
  return (
    <Menu label={`${props.title} 的更多操作`} icon={MoreHorizontal}>
      {(close) => (
        <>
          <MenuItem
            icon={Pencil}
            label="编辑这一篇"
            onClick={() => {
              close()
              props.onEdit()
            }}
          />
          <MenuItem
            icon={Trash2}
            label="删除这一篇"
            danger
            onClick={() => {
              close()
              props.onDelete()
            }}
          />
          <div className="diary-menu-sep" />
          <p className="diary-menu-label">贴花等级</p>
          <div className="diary-menu-levels" role="group" aria-label="贴花等级">
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                type="button"
                className={props.markLevel === level ? 'is-active' : undefined}
                aria-pressed={props.markLevel === level}
                onClick={() => {
                  close()
                  props.onMark(level)
                }}
              >
                {level}
              </button>
            ))}
          </div>
          {props.markLevel === undefined ? null : (
            <MenuItem
              icon={Stamp}
              label="移除贴花"
              onClick={() => {
                close()
                props.onRemoveMark()
              }}
            />
          )}
          <div className="diary-menu-sep" />
          <MenuItem
            icon={Trash2}
            label="删除当天"
            danger
            onClick={() => {
              close()
              props.onDeleteDay()
            }}
          />
        </>
      )}
    </Menu>
  )
}

export function InlineConfirm(props: {
  message: string
  busy: boolean
  confirmLabel?: string
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <div className="diary-inline-confirm" role="alertdialog" aria-modal="false">
      <p>{props.message}</p>
      <div className="diary-inline-actions">
        <button type="button" className="diary-action is-ghost" onClick={props.onCancel} disabled={props.busy}>
          取消
        </button>
        <button type="button" className="diary-action is-danger-solid" onClick={props.onConfirm} disabled={props.busy}>
          {props.confirmLabel ?? '删除'}
        </button>
      </div>
    </div>
  )
}

export function InlineEntryForm(props: {
  title: string
  body: string
  heading: string
  busy: boolean
  onSave(title: string, body: string): void
  onCancel(): void
}) {
  const [title, setTitle] = React.useState(props.title)
  const [body, setBody] = React.useState(props.body)
  React.useEffect(() => {
    setTitle(props.title)
    setBody(props.body)
  }, [props.title, props.body])
  return (
    <div className="diary-inline-editor">
      <h4>{props.heading}</h4>
      <label className="diary-field" htmlFor={`diary-title-${props.heading}`}>
        <span>标题</span>
        <input
          id={`diary-title-${props.heading}`}
          className="diary-input"
          value={title}
          maxLength={40}
          placeholder="2–8 个字"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="diary-field" htmlFor={`diary-body-${props.heading}`}>
        <span>正文</span>
        <textarea
          id={`diary-body-${props.heading}`}
          className="diary-textarea"
          value={body}
          rows={5}
          placeholder="只写正文，不要重复日期、标题或时间。"
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="diary-inline-actions">
        <button type="button" className="diary-action is-ghost" onClick={props.onCancel} disabled={props.busy}>
          取消
        </button>
        <button
          type="button"
          className="diary-action is-primary"
          onClick={() => props.onSave(title, body)}
          disabled={props.busy}
        >
          {props.busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

export function MarkEditor(props: {
  mark: { level: number; note?: string } | null
  busy: boolean
  onSave(level: number, note: string): void
  onRemove(): void
  onCancel(): void
}) {
  const [level, setLevel] = React.useState(String(props.mark?.level ?? 3))
  const [note, setNote] = React.useState(props.mark?.note ?? '')
  React.useEffect(() => {
    setLevel(String(props.mark?.level ?? 3))
    setNote(props.mark?.note ?? '')
  }, [props.mark?.level, props.mark?.note])
  return (
    <div className="diary-inline-mark">
      <span className="diary-inline-mark-label">
        <Stamp />
        当天贴花
      </span>
      <label className="diary-field">
        <span>重要度</span>
        <select className="diary-input diary-select" value={level} onChange={(event) => setLevel(event.target.value)}>
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={String(value)}>
              {value} 级
            </option>
          ))}
        </select>
      </label>
      <label className="diary-field is-grow">
        <span>短注</span>
        <input
          className="diary-input"
          value={note}
          maxLength={80}
          placeholder="可选，最多 80 字"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="diary-inline-actions">
        <button type="button" className="diary-action is-ghost" onClick={props.onCancel} disabled={props.busy}>
          取消
        </button>
        {props.mark === null ? null : (
          <button type="button" className="diary-action is-ghost is-danger" onClick={props.onRemove} disabled={props.busy}>
            移除
          </button>
        )}
        <button
          type="button"
          className="diary-action is-primary"
          onClick={() => props.onSave(Number(level), note.trim())}
          disabled={props.busy}
        >
          保存
        </button>
      </div>
    </div>
  )
}
