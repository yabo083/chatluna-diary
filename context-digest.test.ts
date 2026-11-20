import test from 'node:test'
import assert from 'node:assert/strict'

import { extractMedia, extractText, redactText, renderDigest, segmentEpisodes } from './context-digest.ts'
import type { DigestMessage, RawBlock } from './context-digest.ts'

const at = (hour: number, minute: number, day = 1): number => new Date(2026, 0, day, hour, minute, 0, 0).getTime()

function note(role: 'user' | 'assistant', time: number, text: string, extra: Partial<DigestMessage> = {}): DigestMessage {
  return {
    time,
    role,
    sender: role === 'assistant' ? '我' : '测试用户',
    scene: 'dm',
    conversation: '示例会话',
    text,
    ...extra
  }
}

const pad = (text: string, times = 20): string => `${text}${'今天的事情慢慢说，不着急。'.repeat(times)}`

function dayFixture(): DigestMessage[] {
  return [
    // 12:09 - 12:25
    note('user', at(12, 9), pad('今天想早点睡，白天有点累。')),
    note('assistant', at(12, 10), '好呀，那我陪你聊两句就睡。'),
    note('user', at(12, 20), pad('我把桌子收拾了一下，想把这些都画下来。')),
    note('assistant', at(12, 22), pad('那你画的时候我就在旁边看着，画完给我看看。')),
    note('user', at(12, 25), pad('嗯，那先这样，我去睡了。')),
    // 19:57 - 20:18
    note('user', at(19, 57), pad('晚上好，我今天看到一个挺好看的本子。')),
    note('assistant', at(20, 3), pad('我看到了，封面是深蓝色的那种吧。'), { media: ['本子.png'] }),
    note('user', at(20, 10), pad('对，就是那种，纸摸起来很舒服。')),
    note('user', at(20, 18), pad('换成你我，会是什么样子呢？')),
    // 21:36 - 21:45
    note('user', at(21, 36), '你今天画了吗？'),
    note('assistant', at(21, 38), '今天那幅图画好了。'),
    note('assistant', at(21, 40), pad('画里是傍晚的天，两个影子被拉得很长很长，一直落到台阶下面。')),
    note('user', at(21, 45), pad('真的呀，那我想看看那幅画。')),
    // 22:13
    note('user', at(22, 13), pad('晚安，明天见。'))
  ]
}

test('extractText lifts assistant replies out of reply tool calls', () => {
  const blocks: RawBlock[] = [
    {
      type: 'tool-call',
      toolName: 'reply',
      input: { content: '<message><markdown>**（以日记的方式回应）**\n\n换过来了……</markdown></message>' }
    }
  ]
  const text = extractText(blocks)
  assert.equal(text.includes('<message>'), false)
  assert.equal(text.includes('<markdown>'), false)
  assert.ok(text.includes('换过来了'))
  assert.ok(text.includes('**（以日记的方式回应）**'))
})

test('extractText reads text, nested envelopes and drops noise', () => {
  const blocks: RawBlock[] = [
    { type: 'text', text: '你好' },
    { type: 'envelope', content: [{ type: 'text', text: '里面的话' }] },
    { type: 'tool-result', text: '工具结果' },
    { type: 'reasoning', text: '思考过程' },
    { type: 'tool-call', toolName: 'diary_write', input: { content: '不该出现' } },
    { type: 'text', text: '<status>在线</status><mood>开心</mood>结束' }
  ]
  const text = extractText(blocks)
  assert.ok(text.includes('你好'))
  assert.ok(text.includes('里面的话'))
  assert.ok(text.includes('结束'))
  assert.equal(text.includes('工具结果'), false)
  assert.equal(text.includes('思考过程'), false)
  assert.equal(text.includes('不该出现'), false)
  assert.equal(text.includes('<status>'), false)
})

test('extractMedia walks envelopes and falls back to <img> markers', () => {
  const files: RawBlock[] = [
    { type: 'envelope', content: [{ type: 'file', filename: '窗前.png' }] },
    { type: 'file', mediaType: 'image/jpeg' },
    { type: 'tool-call', toolName: 'send', input: { content: '<markdown>看<img src="a.png"></markdown>' } }
  ]
  assert.deepEqual(extractMedia(files), ['窗前.png', 'image/jpeg'])

  const onlyImg: RawBlock[] = [
    { type: 'tool-call', toolName: 'reply', input: { content: '<message><markdown><img src="x.png"></markdown></message>' } }
  ]
  assert.deepEqual(extractMedia(onlyImg), ['图片'])
  assert.deepEqual(extractMedia([{ type: 'text', text: '没有图片' }]), [])
})

test('redactText removes links, keys, tokens and local addresses', () => {
  const input = [
    '参考 https://api.example.com/v1/gen?token=abc123',
    'key 是 nai-relay-9f4c8b2e7a1d6503c9e2f4b8a7d6c5e1',
    'Authorization: Bearer abcdef123456789',
    'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl',
    'relay=nai-relay-abcdef123456789',
    '服务在 127.0.0.1 和 203.0.113.20，域名 box.local',
    '邮箱 a.b@example.com 电话 13800138000 站点 example.org',
    '路径 /srv/example/diary.txt 和 /etc/passwd',
    'openssl 生成的 sk-abcdef123456'
  ].join('\n')

  const result = redactText(input)
  assert.ok(result.hits > 0)
  assert.equal(result.text.includes('https://'), false)
  assert.equal(result.text.includes('127.0.0.1'), false)
  assert.ok(result.text.includes('203.0.113.20'), 'documentation ranges are not local addresses')
  assert.equal(result.text.includes('box.local'), false)
  assert.equal(result.text.includes('/srv/example'), false)
  assert.equal(result.text.includes('/etc/passwd'), false)
  assert.equal(result.text.includes('a.b@example.com'), false)
  assert.equal(result.text.includes('13800138000'), false)
  assert.equal(result.text.includes('example.org'), false)
  assert.ok(result.text.includes('[邮箱]'))
  assert.ok(result.text.includes('[电话]'))
  assert.ok(result.text.includes('[域名]'))
  assert.equal(result.text.includes('sk-'), false)
  assert.equal(result.text.includes('eyJ'), false)
  assert.equal(result.text.includes('Bearer '), false)
  assert.equal(result.text.includes('nai-relay'), false)
  assert.ok(result.text.includes('[外部链接]'))
  assert.ok(result.text.includes('[已脱敏]'))
  assert.ok(result.text.includes('[本地地址]'))
  assert.ok(result.text.includes('[本地路径]'))

  assert.equal(redactText('今天天气不错，一起吃饭吧。').hits, 0)
})

test('segmentEpisodes splits on gaps and sorts by time', () => {
  const messages = [note('user', at(9, 0), 'a'), note('user', at(9, 10), 'b'), note('user', at(9, 40), 'c')]
  const episodes = segmentEpisodes(messages, 20 * 60 * 1000)
  assert.equal(episodes.length, 2)
  assert.deepEqual(episodes[0].map((message) => message.text), ['a', 'b'])
  assert.deepEqual(episodes[1].map((message) => message.text), ['c'])
})

test('a full day keeps the late high-signal line under a tight budget', () => {
  const result = renderDigest(dayFixture(), { budget: 2500 })
  assert.ok(result.text.length <= 2500, `digest was ${result.text.length} chars`)
  assert.ok(result.text.includes('今天那幅图画好了'), 'late high-signal turn missing')
  assert.ok(result.text.includes('21:38'))
  assert.ok(result.text.includes('换成你我'))
  assert.ok(result.text.includes('[12:09]'), 'first episode opening missing')
  assert.ok(result.text.includes('……（此处略去'))
  assert.ok(result.stats.omitted > 0)
  assert.equal(result.stats.inputMessages, 14)
  assert.equal(result.stats.episodes, 4)
  assert.ok(result.stats.selectedMessages > 0 && result.stats.selectedMessages < 14)

  // Real pressure: the digest must shrink to fit and still keep the 21:38 turn.
  for (const budget of [1200, 800]) {
    const tight = renderDigest(dayFixture(), { budget })
    assert.ok(tight.text.length <= budget, `${budget} digest was ${tight.text.length} chars`)
    assert.ok(tight.text.includes('21:38'), `${budget} digest lost the 21:38 turn`)
    assert.ok(tight.text.includes('……（此处略去'))
    assert.ok(tight.stats.omitted > result.stats.omitted)
  }
})

test('dm and group conversations share the budget and hide non-owner names', () => {
  const messages: DigestMessage[] = [
    note('user', at(10, 0), '私聊里的第一句。', { conversation: '示例会话' }),
    note('assistant', at(10, 1), '私聊里的回应。'),
    note('user', at(10, 2), '私聊里的最后一句。', { conversation: '示例会话' }),
    note('user', at(15, 0), '群里的第一句。', { scene: 'group', conversation: '周末小组', owner: true }),
    note('user', at(15, 1), '我也来画一张。', { scene: 'group', conversation: '周末小组', sender: '小明' }),
    note('assistant', at(15, 2), '群里的回应。', { scene: 'group', conversation: '周末小组' }),
    note('user', at(15, 3), '那我也来。', { scene: 'group', conversation: '周末小组', sender: '小红' })
  ]
  const result = renderDigest(messages, { budget: 900 })
  assert.ok(result.text.length <= 900, `digest was ${result.text.length} chars`)
  assert.ok(result.text.includes('## 私聊'))
  assert.ok(result.text.includes('## 群聊'))
  assert.ok(result.text.includes('群友A'))
  assert.ok(result.text.includes('群友B'))
  assert.equal(result.text.includes('小明'), false)
  assert.equal(result.text.includes('小红'), false)
  assert.ok(result.text.includes('测试用户'), 'owner must stay named')
})

test('split envelopes render as separate speakers with their own time and id', () => {
  // Shape produced when one merged message carries two speakers' envelopes.
  const messages: DigestMessage[] = [
    {
      time: at(9, 0),
      role: 'user',
      sender: '测试用户',
      senderId: 'u-1',
      owner: true,
      scene: 'group',
      conversation: '周末小组',
      text: '我先说一句。'
    },
    {
      time: at(9, 5),
      role: 'user',
      sender: '小明',
      senderId: 'u-2',
      scene: 'group',
      conversation: '周末小组',
      text: '轮到我接一句。'
    }
  ]
  const result = renderDigest(messages)
  assert.ok(result.text.includes('09:00'))
  assert.ok(result.text.includes('09:05'))
  assert.ok(result.text.includes('我先说一句'))
  assert.ok(result.text.includes('轮到我接一句'))
  assert.ok(result.text.includes('测试用户'))
  assert.ok(result.text.includes('群友A'))
  assert.equal(result.text.includes('u-1'), false)
  assert.equal(result.text.includes('u-2'), false)
})

test('an empty day forbids invention', () => {
  const empty = renderDigest([])
  assert.ok(empty.text.includes('没有会话'))
  assert.ok(empty.text.includes('不要编造'))
  assert.deepEqual(empty.stats, {
    inputMessages: 0,
    selectedMessages: 0,
    episodes: 0,
    redactions: 0,
    omitted: 0
  })

  const blank = renderDigest([note('user', at(9, 0), '   ')])
  assert.ok(blank.text.includes('没有会话'))
})

test('long messages are clipped and dropped episodes leave a marker', () => {
  const longUser = '这是一段很长的用户消息，'.repeat(40)
  const longAssistant = '这是一段很长的回复内容，'.repeat(40)
  const messages: DigestMessage[] = [
    note('user', at(8, 0), longUser),
    note('assistant', at(8, 1), longAssistant),
    note('user', at(8, 2), longUser),
    note('user', at(14, 0), '下午的一句。'),
    note('assistant', at(14, 1), '下午的回应。'),
    note('user', at(14, 2), '下午的最后一句。')
  ]

  const clipped = renderDigest(messages)
  assert.ok(clipped.text.includes('…'))
  assert.equal(clipped.text.includes(longUser), false)
  for (const line of clipped.text.split('\n')) {
    if (line.startsWith('- [')) assert.ok(line.length <= 340, `line too long: ${line.length}`)
  }
  assert.ok(clipped.stats.redactions >= 0)

  const tight = renderDigest(messages, { budget: 400 })
  assert.ok(tight.text.length <= 400, `digest was ${tight.text.length} chars`)
  assert.ok(tight.text.includes('……（此处略去'))
  assert.ok(tight.stats.omitted > 0)
  assert.ok(tight.text.includes('14:00') || tight.text.includes('08:00'))
})

test('the digest redacts secrets and marks images inline', () => {
  const messages: DigestMessage[] = [
    note('user', at(9, 0), '看看 https://relay.example.com/v1 和 key=sk-abcdef123456，还有 /srv/example/notes.md'),
    note('assistant', at(9, 1), '收到，图片在 127.0.0.1 那边。', { media: ['图一.png'] })
  ]
  const result = renderDigest(messages)
  assert.ok(result.stats.redactions >= 4)
  assert.equal(result.text.includes('https://relay.example.com'), false)
  assert.equal(result.text.includes('sk-abcdef123456'), false)
  assert.equal(result.text.includes('/srv/example/notes.md'), false)
  assert.equal(result.text.includes('127.0.0.1'), false)
  assert.ok(result.text.includes('[图片 图一.png]'))
})

test('a group-only day gives the group the whole budget and keeps the owner name', () => {
  const messages: DigestMessage[] = []
  for (let index = 0; index < 30; index += 1) {
    const owner = index === 0
    messages.push(
      note(index % 2 === 0 ? 'user' : 'assistant', at(20, index), pad(`群消息 ${index}`, 3), {
        scene: 'group',
        conversation: '大群',
        owner,
        sender: index % 2 === 0 ? (owner ? '测试用户' : '路人') : '我'
      })
    )
  }
  const result = renderDigest(messages, { budget: 4000 })
  assert.ok(result.text.length <= 4000, `digest was ${result.text.length} chars`)
  assert.ok(result.text.includes('## 群聊'))
  assert.equal(result.text.includes('## 私聊'), false)
  assert.ok(result.text.includes('测试用户'))
  assert.ok(result.text.includes('群友A'))
  assert.equal(result.text.includes('路人'), false)
})
