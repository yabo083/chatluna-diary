/* eslint-disable */
import markMask from './assets/mark-l5-mask.png'

/**
 * The diary's only mark: one hand-drawn brush circle shipped as an alpha mask
 * (inlined by the lib build, since the asset server only serves manifest chunks).
 *
 * Importance is weight of ink, not a different shape: level N renders the same
 * brush circle N times, each copy nudged and rotated a little so the stack reads
 * as a heavier, hand-pressed stamp. Colour always comes from `currentColor`.
 */

export type MarkLevel = 1 | 2 | 3 | 4 | 5

function classes(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** One copy per level, laid over the same box; deterministic so it never wiggles. */
const STACK = [
  { rotate: 0, x: 0, y: 0, scale: 1 },
  { rotate: -6, x: 1.5, y: -1, scale: 0.98 },
  { rotate: 7, x: -1.5, y: 1, scale: 1.01 },
  { rotate: -11, x: 0.8, y: 1.5, scale: 0.97 },
  { rotate: 12, x: -0.8, y: -1.5, scale: 1.02 },
]

const MASK_VAR = '--chatluna-diary-mark-mask'

/**
 * The mask is a ~32KB data URI after the lib build inlines it. Putting it in
 * every copy's style attribute repeats it 1-5 times per mark; set it once on
 * the document root and let the copies inherit the variable.
 */
function installMask() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.style.getPropertyValue(MASK_VAR) === '') {
    root.style.setProperty(MASK_VAR, `url("${markMask}")`)
  }
}

installMask()

const maskStyle = {
  backgroundColor: 'currentColor',
  WebkitMaskImage: `var(${MASK_VAR})`,
  maskImage: `var(${MASK_VAR})`,
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
} as const

export function MarkStamp({ level, className }: { level: MarkLevel; className?: string }) {
  const copies = STACK.slice(0, Math.min(5, Math.max(1, level)))

  return (
    <span
      className={classes('paper-mark', `paper-mark-l${level}`, className)}
      aria-hidden="true"
      style={{ position: 'relative', display: 'inline-block' }}
    >
      {copies.map((copy, index) => (
        <span
          key={index}
          style={{
            ...maskStyle,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0.62,
            transform: `translate(${copy.x}%, ${copy.y}%) rotate(${copy.rotate}deg) scale(${copy.scale})`,
            transformOrigin: 'center',
          }}
        />
      ))}
    </span>
  )
}
