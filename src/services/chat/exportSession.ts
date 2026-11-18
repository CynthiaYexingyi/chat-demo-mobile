import type { Message, Session } from './types.js'
import { toMdAst } from '../markdown/parse.js'

/**
 * 单条会话导出：整库 ZIP 是给程序看的备份，这里导出的是「能发出去的东西」。
 * - Markdown：正文原样保留，粘到别处还能继续编辑
 * - HTML：单文件、不依赖网络，排版与代码高亮样式内联，学生点开就能看
 * 思考过程不导出；公式以 LaTeX 原文显示（离线可用，不引外部字体）。
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 正文里的引用角标在导出文件里没有对应的来源卡片，去掉 */
const stripCitations = (text: string): string => text.replace(/\[citation:\d+\]/g, '')

/** 一条消息里可导出的正文；思考块不参与 */
export const exportableText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

const attachmentLine = (message: Message): string => {
  if (message.role !== 'user' || message.files.length === 0) {
    return ''
  }
  return message.files.map((file) => `[附件：${file.name}]`).join(' ')
}

export const sessionToMarkdown = (session: Session, now = Date.now()): string =>
  [...markdownChunks(session, now)].join('\n')

/** 分段产出：长会话（上万条消息）导出时逐段让出主线程，界面不会假死 */
function* markdownChunks(session: Session, now: number): Generator<string> {
  yield `# ${session.title || '未命名对话'}`
  yield ''
  yield `> 导出于 ${new Date(now).toLocaleString('zh-CN')}`
  yield ''
  for (const message of session.messages) {
    const text = stripCitations(exportableText(message)).trim()
    const files = attachmentLine(message)
    if (!text && !files) {
      continue
    }
    yield message.role === 'user' ? '## 我' : '## DeepSeek'
    yield ''
    if (files) {
      yield files
      yield ''
    }
    if (text) {
      yield text
      yield ''
    }
    yield '---'
    yield ''
  }
}

/* ------------------------------------------------------------------ */
/* mdast → HTML：只覆盖会话里会出现的节点，遇到未知节点按纯文本降级       */
/* ------------------------------------------------------------------ */

type AnyNode = {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  start?: number | null
  url?: string
  alt?: string | null
  children?: AnyNode[]
  lang?: string | null
}

const renderChildren = (node: AnyNode): string =>
  (node.children ?? []).map(renderNode).join('')

const renderNode = (node: AnyNode): string => {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value ?? '')
    case 'paragraph':
      return `<p>${renderChildren(node)}</p>`
    case 'heading':
      return `<h${node.depth}>${renderChildren(node)}</h${node.depth}>`
    case 'strong':
      return `<strong>${renderChildren(node)}</strong>`
    case 'emphasis':
      return `<em>${renderChildren(node)}</em>`
    case 'delete':
      return `<del>${renderChildren(node)}</del>`
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`
    case 'code':
      return `<pre><code>${escapeHtml(node.value ?? '')}</code></pre>`
    case 'blockquote':
      return `<blockquote>${renderChildren(node)}</blockquote>`
    case 'thematicBreak':
      return '<hr />'
    case 'break':
      return '<br />'
    case 'link':
      return `<a href="${escapeHtml(node.url ?? '')}" rel="noreferrer">${renderChildren(node)}</a>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      const start =
        node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : ''
      return `<${tag}${start}>${renderChildren(node)}</${tag}>`
    }
    case 'listItem':
      return `<li>${renderChildren(node)}</li>`
    case 'table':
      return `<table>${renderChildren(node)}</table>`
    case 'tableRow':
      return `<tr>${renderChildren(node)}</tr>`
    case 'tableCell':
      return `<td>${renderChildren(node)}</td>`
    case 'math':
      return `<div class="math">${escapeHtml(node.value ?? '')}</div>`
    case 'inlineMath':
      return `<span class="math-inline">${escapeHtml(node.value ?? '')}</span>`
    case 'image':
      // 附件原件只存在本地数据库，导出文件里无法内联，保留说明
      return `<p class="note">[图片：${escapeHtml(node.alt ?? '')}]</p>`
    case 'html':
      return escapeHtml(node.value ?? '')
    default:
      return node.children ? renderChildren(node) : escapeHtml(node.value ?? '')
  }
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 48px 20px 80px; max-width: 720px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px; line-height: 1.75; color: #1f2023; background: #fff;
}
h1 { font-size: 26px; line-height: 1.3; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 36px 0 12px; padding-top: 20px; border-top: 1px solid #e6e3dd; }
h3 { font-size: 16px; margin: 24px 0 8px; }
p { margin: 12px 0; }
ul, ol { padding-left: 22px; }
li { margin: 6px 0; }
blockquote { margin: 12px 0; padding: 2px 14px; border-left: 3px solid #d8d4cc; color: #55565a; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em;
  background: #f4f2ee; padding: 2px 5px; border-radius: 5px; }
pre { background: #f7f5f1; padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 13px; line-height: 1.6; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
td { border: 1px solid #e6e3dd; padding: 8px 10px; }
hr { border: none; border-top: 1px solid #e6e3dd; margin: 0; }
.math { font-family: ui-monospace, monospace; background: #f7f5f1; padding: 10px 12px;
  border-radius: 8px; overflow-x: auto; margin: 12px 0; }
.math-inline { font-family: ui-monospace, monospace; background: #f7f5f1; padding: 1px 4px; border-radius: 4px; }
.note { color: #83848a; font-size: 13px; }
.meta { color: #83848a; font-size: 13px; margin: 0 0 28px; }
footer { margin-top: 56px; color: #a3a49f; font-size: 12px; text-align: center; }
@media (prefers-color-scheme: dark) {
  body { color: #e8e8e6; background: #1b1b1d; }
  h2 { border-color: #323234; }
  blockquote { border-color: #444; color: #b7b7b4; }
  code, pre, .math, .math-inline { background: #262629; }
  td { border-color: #323234; }
  hr { border-color: #323234; }
}
`

export const sessionToHtml = (session: Session, now = Date.now()): string =>
  [...htmlChunks(session, now)].join('')

/** 同样是分段产出：单条 HTML 可以到十几 MB，一次拼完会明显卡顿 */
function* htmlChunks(session: Session, now: number): Generator<string> {
  const title = session.title || '未命名对话'
  yield `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">导出于 ${new Date(now).toLocaleString('zh-CN')} · 共 ${session.messages.length} 条消息</p>
`
  for (const message of session.messages) {
    const raw = stripCitations(exportableText(message)).trim()
    const files = attachmentLine(message)
    if (!raw && !files) {
      continue
    }
    yield `<h2>${message.role === 'user' ? '我' : 'DeepSeek'}</h2>`
    if (files) {
      yield `<p class="note">${escapeHtml(files)}</p>`
    }
    if (raw) {
      yield renderNode(toMdAst(raw, { sources: undefined, disableLink: false }) as AnyNode)
    }
  }
  yield `<footer>由 DeepSeek 对话导出</footer>
</body>
</html>`
}

/** 触发浏览器下载；长内容分段生成并逐段让出主线程，避免导出时界面卡住 */
export const downloadSession = async (
  session: Session,
  format: 'md' | 'html',
  now = Date.now()
): Promise<void> => {
  const chunks: string[] = []
  let count = 0
  for (const chunk of format === 'md' ? markdownChunks(session, now) : htmlChunks(session, now)) {
    chunks.push(chunk)
    if (++count % 400 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const type = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8'
  const safeTitle = (session.title || '未命名对话')
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .trim()
    .slice(0, 60)
  const date = new Date(now)
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate()
  ).padStart(2, '0')}`
  const blob = new Blob(chunks, { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeTitle}-${stamp}.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
