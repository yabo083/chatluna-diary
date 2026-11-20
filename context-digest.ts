/**
 * Pure digest builder for a day of diary conversations.
 *
 * No imports, no cordis types: everything here works on plain block/message shapes so it can be
 * unit tested with `node --test` and reused by the plugin integration.
 */

export interface RawBlock {
  type: string
  text?: string
  toolName?: string
  input?: unknown
  content?: unknown
  filename?: string
  alt?: string
  mediaType?: string
  kind?: string
}

export interface DigestMessage {
  time: number
  role: 'user' | 'assistant'
  sender: string
  owner?: boolean
  scene: 'dm' | 'group'
  conversation: string
  text: string
  media?: readonly string[]
}

export interface DigestOptions {
  budget?: number
  dmShare?: number
  episodeGapMs?: number
}

export interface DigestStats {
  inputMessages: number
  selectedMessages: number
  episodes: number
  redactions: number
  omitted: number
}

export interface DigestResult {
  text: string
  stats: DigestStats
}

const DEFAULT_BUDGET = 12_000
const DEFAULT_DM_SHARE = 0.75
const DEFAULT_EPISODE_GAP_MS = 20 * 60 * 1000
const USER_CAP = 220
const ASSISTANT_CAP = 260
const TITLE = '# 当日对话摘要'
const EMPTY_TEXT = `${TITLE}\n\n这一天没有会话记录。不要编造任何事件、对话或细节；只写可以确认的内容。`

const REPLY_TOOLS: Record<string, true> = { reply: true, send: true }
const HIGH_SIGNAL = /(日记|画|图|纪念|喜欢|生日|约)/
const DROP_PAIR = /<(status|mood|bond|thinking|silence)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const KEEP_PAIR = /<(message|markdown)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
const ORPHAN_TAG = /<\/?(?:message|markdown|status|mood|bond|thinking|silence)\b[^>]*>/gi
const IMG_TAG = /<img\b[^>]*>/gi
const IMG_TEST = /<img\b/i

/* -------------------------------------------------------------------------------------------- */
/* Block extraction                                                                              */
/* -------------------------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function asBlocks(value: unknown): RawBlock[] {
  return Array.isArray(value) ? (value as RawBlock[]) : []
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Inner content of a `reply` / `send` tool call, still wrapped in its own markup. */
function replyContent(block: RawBlock): string | undefined {
  if (block.type !== 'tool-call') return undefined
  if (typeof block.toolName !== 'string' || REPLY_TOOLS[block.toolName] !== true) return undefined
  const input = asRecord(block.input)
  const content = input?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const nested = asBlocks(content)
    const parts: string[] = []
    collectText(nested, parts)
    return parts.length === 0 ? undefined : parts.join('\n')
  }
  return undefined
}

const MAX_CLEAN_INPUT = 8192

/** Strip wrappers, drop metadata blocks, normalise whitespace. */
function cleanText(value: string): string {
  // Tag cleanup is lazy-match regex work; cap untrusted input before it so a
  // pathological message cannot turn the scan quadratic.
  let text = value.length > MAX_CLEAN_INPUT ? value.slice(0, MAX_CLEAN_INPUT) : value
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(DROP_PAIR, ' ').replace(KEEP_PAIR, (_match, _tag: string, inner: string) => inner)
    if (next === text) break
    text = next
  }
  return text
    .replace(ORPHAN_TAG, ' ')
    .replace(IMG_TAG, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function collectText(blocks: readonly RawBlock[], parts: string[]): void {
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') parts.push(block.text)
        break
      case 'envelope':
        if (typeof block.text === 'string') parts.push(block.text)
        if (typeof block.content === 'string') parts.push(block.content)
        collectText(asBlocks(block.content), parts)
        break
      case 'tool-call': {
        const content = replyContent(block)
        if (content !== undefined) parts.push(content)
        break
      }
      default:
        break
    }
  }
}

/** Extract human text from ChatMessage content blocks. */
export function extractText(blocks: readonly RawBlock[]): string {
  const parts: string[] = []
  collectText(blocks, parts)
  return cleanText(parts.join('\n'))
}

/** Extract image references from ChatMessage content blocks. */
export function extractMedia(blocks: readonly RawBlock[]): string[] {
  const names: string[] = []
  let hasImg = false
  const visit = (list: readonly RawBlock[]): void => {
    for (const block of list) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'file') {
        names.push(firstString(block.filename, block.alt, block.mediaType) ?? '图片')
        continue
      }
      if (block.type === 'envelope') {
        visit(asBlocks(block.content))
        continue
      }
      if (block.type === 'tool-call') {
        const content = replyContent(block)
        if (content !== undefined && IMG_TEST.test(content)) hasImg = true
        continue
      }
      if (block.type === 'text' && typeof block.text === 'string' && IMG_TEST.test(block.text)) {
        hasImg = true
      }
    }
  }
  visit(blocks)
  if (names.length === 0 && hasImg) names.push('图片')
  return names
}

/* -------------------------------------------------------------------------------------------- */
/* Redaction                                                                                     */
/* -------------------------------------------------------------------------------------------- */

const SECRET_KEY = 'token|key|secret|password|api[_-]?key|relay|auth'
const INTERNAL_IP =
  '(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|127\\.0\\.0\\.1)'

interface RedactionRule {
  pattern: RegExp
  replace: string | ((match: string) => string)
}

const REDACTION_RULES: readonly RedactionRule[] = [
  { pattern: /https?:\/\/[^\s<>"'`）】」，。；、！？]+/gi, replace: '[外部链接]' },
  {
    // key = value / key: value -> keep the key, redact the value
    pattern: new RegExp(`(\\b(?:${SECRET_KEY})\\b\\s*[:=]\\s*["']?)[^\\s"'，。；、）】,]+`, 'gi'),
    replace: '$1[已脱敏]'
  },
  { pattern: /\bBearer[ \t]+[A-Za-z0-9._~+/-]{6,}=*/gi, replace: '[已脱敏]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, replace: '[已脱敏]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{6,}/gi, replace: '[已脱敏]' },
  { pattern: /\b[a-z0-9]+(?:-[a-z0-9]+)*-relay(?:-[A-Za-z0-9_-]{3,})+/gi, replace: '[已脱敏]' },
  { pattern: new RegExp(`\\b${INTERNAL_IP}\\b`, 'g'), replace: '[本地地址]' },
  { pattern: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.local\b/gi, replace: '[本地地址]' },
  { pattern: /\/(?:root|srv)(?:\/[A-Za-z0-9._@%+-]+)*/g, replace: '[本地路径]' },
  {
    pattern: /\b[A-Za-z0-9_-]{32,}\b/g,
    replace: (match: string): string => {
      const mixedCase = /[a-z]/.test(match) && /[A-Z]/.test(match)
      return /[A-Za-z]/.test(match) && (/\d/.test(match) || mixedCase) ? '[已脱敏]' : match
    }
  }
]

const REDACTION_MATCHERS = REDACTION_RULES.map((rule) => {
  const flags = rule.pattern.flags.replace('g', '')
  const local = new RegExp(rule.pattern.source, flags)
  return {
    exact: new RegExp(`^(?:${rule.pattern.source})$`, flags),
    apply: (token: string): string =>
      typeof rule.replace === 'string' ? token.replace(local, rule.replace) : rule.replace(token)
  }
})

const REDACTION_ALL = new RegExp(
  REDACTION_RULES.map((rule) => `(?:${rule.pattern.source})`).join('|'),
  'gi'
)

/** Redact secrets, links, local addresses and paths in a single pass. */
export function redactText(text: string): { text: string; hits: number } {
  if (typeof text !== 'string' || text === '') return { text: '', hits: 0 }
  let hits = 0
  const redacted = text.replace(REDACTION_ALL, (match: string) => {
    const matcher = REDACTION_MATCHERS.find((item) => item.exact.test(match))
    if (matcher === undefined) return match
    const replacement = matcher.apply(match)
    if (replacement === match) return match
    hits += 1
    return replacement
  })
  return { text: redacted, hits }
}

/* -------------------------------------------------------------------------------------------- */
/* Episodes                                                                                      */
/* -------------------------------------------------------------------------------------------- */

interface Timed {
  time: number
}

function splitEpisodes<T extends Timed>(items: readonly T[], gapMs: number): T[][] {
  const sorted = [...items].sort((left, right) => left.time - right.time)
  const episodes: T[][] = []
  let current: T[] = []
  for (const item of sorted) {
    const previous = current[current.length - 1]
    if (previous !== undefined && item.time - previous.time >= gapMs) {
      episodes.push(current)
      current = []
    }
    current.push(item)
  }
  if (current.length > 0) episodes.push(current)
  return episodes
}

/** Segment one conversation's messages by silence gaps. */
export function segmentEpisodes(messages: readonly DigestMessage[], gapMs: number): DigestMessage[][] {
  const gap = Number.isFinite(gapMs) && gapMs > 0 ? gapMs : DEFAULT_EPISODE_GAP_MS
  return splitEpisodes(messages, gap)
}

/* -------------------------------------------------------------------------------------------- */
/* Rendering                                                                                     */
/* -------------------------------------------------------------------------------------------- */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function alias(index: number): string {
  const letter = LETTERS[index % LETTERS.length] ?? '?'
  const round = Math.floor(index / LETTERS.length)
  return round === 0 ? `群友${letter}` : `群友${letter}${round + 1}`
}

function clock(time: number): string {
  if (!Number.isFinite(time)) return '--:--'
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const SCENE_LABEL: Record<'dm' | 'group', string> = { dm: '私聊', group: '群聊' }

function isHighSignal(message: DigestMessage): boolean {
  const media = message.media ?? []
  if (media.length > 0) return true
  if (message.role === 'assistant' && message.text.length >= 120) return true
  return HIGH_SIGNAL.test(message.text)
}

interface Prepared {
  time: number
  role: 'user' | 'assistant'
  sender: string
  text: string
  media: string[]
  clock: string
}

interface SectionLine {
  text: string
  weight: number
}

interface Section {
  header: string
  lines: SectionLine[]
  count: number
}

interface Conversation {
  scene: 'dm' | 'group'
  header: string
  sections: Section[]
}

interface FitResult {
  body: string
  used: number
  included: number
  clipped: boolean
}

function prepare(
  messages: readonly DigestMessage[],
  nameOf: (message: DigestMessage) => string,
  hits: { count: number }
): Map<DigestMessage, Prepared> {
  const prepared = new Map<DigestMessage, Prepared>()
  for (const message of messages) {
    const redacted = redactText(message.text ?? '')
    hits.count += redacted.hits
    const media = (message.media ?? [])
      .map((item) => {
        const result = redactText(item)
        hits.count += result.hits
        return result.text
      })
      .filter((item) => item !== '')
    const flat = redacted.text.replace(/\s*\n+\s*/g, ' ').trim()
    const cap = message.role === 'assistant' ? ASSISTANT_CAP : USER_CAP
    prepared.set(message, {
      time: message.time,
      role: message.role,
      sender: redactText(nameOf(message)).text,
      text: flat.length > cap ? `${flat.slice(0, cap)}…` : flat,
      media,
      clock: clock(message.time)
    })
  }
  return prepared
}

function lineText(item: Prepared): string {
  const body = item.text === '' ? '' : item.text
  const media = item.media.length === 0 ? '' : ` [图片 ${item.media.join('、')}]`
  return `[${item.clock}] ${item.sender}：${body}${media}`
}

/** Keep first user + its first reply, one high-signal turn, and the closing exchange. */
function selectEpisode(messages: readonly DigestMessage[]): number[] {
  const picked = new Set<number>()
  let firstUser = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role === 'user') {
      firstUser = index
      break
    }
  }
  if (firstUser >= 0) {
    picked.add(firstUser)
    for (let index = firstUser + 1; index < messages.length; index += 1) {
      if (messages[index].role === 'assistant') {
        picked.add(index)
        break
      }
    }
  } else if (messages.length > 0) {
    picked.add(0)
  }
  for (let index = 0; index < messages.length; index += 1) {
    if (isHighSignal(messages[index])) {
      picked.add(index)
      break
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      picked.add(index)
      break
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      picked.add(index)
      break
    }
  }
  return [...picked].sort((left, right) => left - right)
}

function buildSections(
  episodes: readonly DigestMessage[][],
  prepared: Map<DigestMessage, Prepared>
): Section[] {
  return episodes.map((episode) => {
    const indexes = selectEpisode(episode)
    const lines: SectionLine[] = indexes.map((index, position) => {
      const message = episode[index]
      const item = prepared.get(message)
      const weight = isHighSignal(message) ? 3 : position === 0 || position === indexes.length - 1 ? 2 : 1
      return { text: item === undefined ? '' : lineText(item), weight }
    })
    const first = episode[0]
    const last = episode[episode.length - 1]
    const start = first === undefined ? '--:--' : clock(first.time)
    const end = last === undefined ? start : clock(last.time)
    return {
      header: start === end ? `### ${start}` : `### ${start}–${end}`,
      lines: lines.filter((line) => line.text !== ''),
      count: episode.length
    }
  })
}

function buildPiece(section: Section, pick: readonly boolean[]): string {
  const lines: string[] = []
  for (let index = 0; index < section.lines.length; index += 1) {
    if (pick[index] === true) lines.push(`- ${section.lines[index].text}`)
  }
  if (lines.length === 0) return ''
  return `${section.header}\n${lines.join('\n')}`
}

function assembleBody(sections: readonly Section[], picks: readonly boolean[][]): string {
  const parts: string[] = []
  let dropped = 0
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]
    const piece = buildPiece(section, picks[index])
    if (piece === '') {
      dropped += section.count
      continue
    }
    if (dropped > 0) {
      parts.push(`……（此处略去 ${dropped} 条消息）……`)
      dropped = 0
    }
    const shown = picks[index].filter((value) => value === true).length
    const skipped = section.count - shown
    parts.push(skipped > 0 ? `${piece}\n……（此处略去 ${skipped} 条消息）……` : piece)
  }
  if (dropped > 0) parts.push(`……（此处略去 ${dropped} 条消息）……`)
  return parts.join('\n\n')
}

function fitSections(sections: readonly Section[], budget: number): FitResult {
  const limit = Math.max(1, Math.floor(budget))
  const picks: boolean[][] = sections.map((section) => section.lines.map(() => false))
  let used = 0
  let included = 0

  const pieceOf = (index: number): string => buildPiece(sections[index], picks[index])
  const takeLine = (sectionIndex: number, lineIndex: number): boolean => {
    const before = pieceOf(sectionIndex)
    picks[sectionIndex][lineIndex] = true
    const after = pieceOf(sectionIndex)
    const delta = before === '' ? after.length + 2 : after.length - before.length
    if (used + delta > limit) {
      picks[sectionIndex][lineIndex] = false
      return false
    }
    used += delta
    included += 1
    return true
  }
  const takeSection = (sectionIndex: number): boolean => {
    const before = pieceOf(sectionIndex)
    const draft = sections[sectionIndex].lines.map(() => true)
    const after = buildPiece(sections[sectionIndex], draft)
    if (after === '') return false
    const delta = before === '' ? after.length + 2 : after.length - before.length
    if (used + delta > limit) return false
    picks[sectionIndex] = draft
    used += delta
    included += draft.length
    return true
  }

  if (sections.length === 0) return { body: '', used: 0, included: 0, clipped: false }

  // Opening of the first episode is anchored.
  const opening = sections[0]
  for (let lineIndex = 0; lineIndex < Math.min(2, opening.lines.length); lineIndex += 1) {
    takeLine(0, lineIndex)
  }
  // Later (evening) episodes win the remaining budget.
  for (let index = sections.length - 1; index >= 1; index -= 1) {
    if (takeSection(index)) continue
    const order = sections[index].lines
      .map((line, lineIndex) => ({ line, lineIndex }))
      .sort((left, right) => right.line.weight - left.line.weight || left.lineIndex - right.lineIndex)
    for (const item of order) {
      if (picks[index][item.lineIndex] !== true) takeLine(index, item.lineIndex)
    }
  }
  // Leftover goes back into the opening episode.
  const rest = sections[0].lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter((item) => picks[0][item.lineIndex] !== true)
    .sort((left, right) => left.lineIndex - right.lineIndex)
  for (const item of rest) takeLine(0, item.lineIndex)

  const body = included === 0 ? '' : assembleBody(sections, picks)
  return { body, used: included === 0 ? 0 : body.length, included, clipped: included < sectionsTotal(sections) }
}

function sectionsTotal(sections: readonly Section[]): number {
  let total = 0
  for (const section of sections) total += section.lines.length
  return total
}

function fitScene(conversations: readonly Conversation[], sceneBudget: number): Map<Conversation, FitResult> {
  const results = new Map<Conversation, FitResult>()
  if (conversations.length === 0) return results
  const share = Math.max(1, Math.floor(sceneBudget / conversations.length))
  for (const conversation of conversations) {
    results.set(conversation, fitSections(conversation.sections, share - conversation.header.length - 2))
  }
  let leftover = sceneBudget - [...results.values()].reduce((total, fit) => total + fit.used, 0)
  if (leftover <= 32) return results
  // Later conversations are more interesting; they get the spare budget first.
  for (let index = conversations.length - 1; index >= 0 && leftover > 32; index -= 1) {
    const conversation = conversations[index]
    const previous = results.get(conversation)
    if (previous === undefined || !previous.clipped) continue
    const next = fitSections(conversation.sections, share + leftover - conversation.header.length - 2)
    results.set(conversation, next)
    leftover -= next.used - previous.used
  }
  return results
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Render the final Markdown digest. */
export function renderDigest(messages: readonly DigestMessage[], options: DigestOptions = {}): DigestResult {
  const budget = Math.max(200, Math.floor(positive(options.budget, DEFAULT_BUDGET)))
  const rawShare = options.dmShare
  const dmShare =
    typeof rawShare === 'number' && Number.isFinite(rawShare) ? Math.min(1, Math.max(0, rawShare)) : DEFAULT_DM_SHARE
  const gapMs = positive(options.episodeGapMs, DEFAULT_EPISODE_GAP_MS)

  const hits = { count: 0 }
  const source = messages.filter((message) => message !== null && typeof message === 'object')
  const cleaned = source.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false
    if (message.scene !== 'dm' && message.scene !== 'group') return false
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    const media = Array.isArray(message.media) ? message.media.length : 0
    return text !== '' || media > 0
  })
  if (cleaned.length === 0) {
    return {
      text: EMPTY_TEXT,
      stats: { inputMessages: 0, selectedMessages: 0, episodes: 0, redactions: 0, omitted: 0 }
    }
  }

  const ordered = [...cleaned].sort((left, right) => left.time - right.time)

  // Stable group aliases, assigned in first-appearance order.
  const aliases = new Map<string, string>()
  for (const message of ordered) {
    if (message.scene !== 'group' || message.role !== 'user' || message.owner === true) continue
    if (!aliases.has(message.sender)) aliases.set(message.sender, alias(aliases.size))
  }
  const nameOf = (message: DigestMessage): string => {
    if (message.scene === 'group' && message.role === 'user' && message.owner !== true) {
      return aliases.get(message.sender) ?? '群友'
    }
    if (typeof message.sender === 'string' && message.sender.trim() !== '') return message.sender
    return message.role === 'assistant' ? '我' : '用户'
  }

  const byConversation = new Map<string, DigestMessage[]>()
  for (const message of ordered) {
    const key = `${message.scene}\u0000${message.conversation ?? ''}`
    const bucket = byConversation.get(key)
    if (bucket === undefined) byConversation.set(key, [message])
    else bucket.push(message)
  }

  const conversationList: Conversation[] = []
  let episodes = 0
  for (const bucket of byConversation.values()) {
    const first = bucket[0]
    const prepared = prepare(bucket, nameOf, hits)
    const episodeList = splitEpisodes(bucket, gapMs)
    episodes += episodeList.length
    const sections = buildSections(episodeList, prepared)
    if (sections.length === 0) continue
    conversationList.push({
      scene: first.scene,
      header: `## ${SCENE_LABEL[first.scene]}${first.conversation ? ` · ${first.conversation}` : ''}`,
      sections
    })
  }

  const firstTime = ordered[0].time
  const lastTime = ordered[ordered.length - 1].time
  const dmConversations = conversationList.filter((conversation) => conversation.scene === 'dm')
  const groupConversations = conversationList.filter((conversation) => conversation.scene === 'group')
  const dmCount = ordered.filter((message) => message.scene === 'dm').length
  const groupCount = ordered.length - dmCount

  const overviewLines = (included: number): string => {
    const scenes: string[] = []
    if (dmCount > 0) scenes.push(`私聊 ${dmCount} 条`)
    if (groupCount > 0) scenes.push(`群聊 ${groupCount} 条`)
    return [
      `- 场景：${scenes.join(' · ')}`,
      `- 时间：${clock(firstTime)}–${clock(lastTime)}`,
      `- 原始消息 ${ordered.length} 条，纳入 ${included} 条`
    ].join('\n')
  }
  const overhead = TITLE.length + overviewLines(ordered.length).length + 12 + 2 * conversationList.length

  const build = (allowance: number): { text: string; included: number } => {
    const usable = Math.max(1, allowance - overhead)
    const dmBudget =
      dmConversations.length === 0 ? 0 : groupConversations.length === 0 ? usable : Math.floor(usable * dmShare)
    const groupBudget = groupConversations.length === 0 ? 0 : usable - dmBudget
    const dmFits = fitScene(dmConversations, dmBudget)
    const groupFits = fitScene(groupConversations, groupBudget)
    const blocks: string[] = []
    let included = 0
    for (const conversation of [...dmConversations, ...groupConversations]) {
      const fit = (conversation.scene === 'dm' ? dmFits : groupFits).get(conversation)
      if (fit === undefined) continue
      const body = fit.body
      if (body === '') continue
      blocks.push(`${conversation.header}\n\n${body}`)
      included += fit.included
    }
    if (blocks.length === 0) blocks.push(`……（此处略去 ${ordered.length} 条消息）……`)
    const text = [TITLE, overviewLines(included), ...blocks].join('\n\n').trimEnd()
    return { text, included }
  }

  let allowance = budget
  let built = build(allowance)
  for (let attempt = 0; attempt < 4 && built.text.length > budget; attempt += 1) {
    allowance -= built.text.length - budget + 24
    if (allowance < 240) break
    built = build(allowance)
  }

  return {
    text: built.text,
    stats: {
      inputMessages: ordered.length,
      selectedMessages: built.included,
      episodes,
      redactions: hits.count,
      omitted: ordered.length - built.included
    }
  }
}
