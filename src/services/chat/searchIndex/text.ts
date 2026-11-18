import type { Message, Session } from '../types.js'

/** 一条命中：某个会话里出现了关键词 */
export type SearchHit = {
  sessionId: string
  title: string
  /** 命中的原文片段，带前后文 */
  snippet: string
  /** 该会话内命中的消息条数 */
  matches: number
  /** 标题是否也命中 */
  fromTitle: boolean
  /** 第一条正文命中的消息 id；只有标题命中时为 null */
  messageId: string | null
}

/** 最多返回多少个会话，避免一次渲染过多 */
export const MAX_HITS = 60
/** 单条片段的长度上限 */
const SNIPPET_PAD_LEFT = 18
const SNIPPET_PAD_RIGHT = 30

/** 取一条消息里可被搜索的纯文本（思考过程不参与检索） */
export const messageText = (message: Message): string =>
  message.role === 'user'
    ? message.content
    : message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/** 整条会话可被搜索的正文：标题 + 每条消息；建索引和精确核对共用同一份文本 */
export const sessionText = (session: Session): string => {
  const parts: string[] = [session.title ?? '']
  for (const message of session.messages) {
    parts.push(messageText(message))
  }
  return parts.join('\n')
}

/** 截取命中位置附近的一小段原文 */
export const makeSnippet = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - SNIPPET_PAD_LEFT)
  const end = Math.min(text.length, index + length + SNIPPET_PAD_RIGHT)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/**
 * 在一个已加载的会话里精确查找关键词，返回命中摘要。
 * 返回 null 表示这个会话没有命中。
 */
export const matchSession = (
  session: Session,
  query: string
): Omit<SearchHit, 'sessionId' | 'title'> | null => {
  const title = session.title ?? ''
  const fromTitle = title.toLowerCase().includes(query)
  let matches = fromTitle ? 1 : 0
  let snippet = fromTitle ? title : ''
  let messageId: string | null = null

  for (const message of session.messages) {
    const text = messageText(message)
    if (!text) {
      continue
    }
    const index = text.toLowerCase().indexOf(query)
    if (index === -1) {
      continue
    }
    matches += 1
    if (!snippet) {
      snippet = makeSnippet(text, index, query.length)
    }
    if (!messageId) {
      messageId = message.id
    }
  }

  return matches > 0 ? { snippet, matches, fromTitle, messageId } : null
}
