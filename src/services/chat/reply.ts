import type {
  AssistantBlockParam,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  TextBlockParam,
} from '../api/types.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ReplyBlock,
  ReplyStatus,
  UserMessage,
} from './types.js'
import { getCsvProfile } from '../csvProfile.js'
import type { StyleRound } from './collections.js'

/**
 * 文件按 Files API 的 file_id（附件的 serverId）引用：图片用 image 块，其余用 document 块。
 * 发送前 streamReply 会先补齐 serverId；仍为 null 的是本地没有原件的附件，不进入请求。
 * 超过大小上限的表格已由本地摘要代替，不再引用文件本身。
 */
const toFileBlocks = (files: FileAttachment[]): FileBlockParam[] =>
  files.flatMap(({ id, serverId, isImage }) =>
    serverId && !getCsvProfile(id)?.sampleOnly
      ? [
          {
            type: isImage ? 'image' : 'document',
            source: { type: 'file', file_id: serverId },
          },
        ]
      : []
  )

/** 本地算好的表格摘要，紧跟在文件块之后；大表格的摘要里还带前几十行样本 */
const toProfileBlocks = (files: FileAttachment[]): TextBlockParam[] =>
  files.flatMap(({ id }) => {
    const profile = getCsvProfile(id)
    if (!profile) {
      return []
    }
    const text = profile.sampleOnly ? `${profile.summary}\n\n${profile.sample}` : profile.summary
    return text.trim() ? [{ type: 'text' as const, text }] : []
  })

const toReplyBlock = (block: OutputBlockStart, now: number): ReplyBlock | null => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, citations: block.citations ?? [] }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        startedAt: now,
      }
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
      return block
    default:
      return null
  }
}

const updateBlock = (
  reply: AssistantMessage,
  index: number,
  update: (block: ReplyBlock) => ReplyBlock
): AssistantMessage => {
  const block = reply.blocks[index]
  if (!block) {
    return reply
  }
  const blocks = [...reply.blocks]
  blocks[index] = update(block)
  return { ...reply, blocks }
}

/**
 * 把一个流式事件合并进回复：只追加可识别的内容块，用本次请求的临时索引映射处理增量。
 * 跳过的块不占位；续写直接追加到已有内容之后，message_delta 更新结束原因与累计用量。
 */
export const applyEvent = (
  reply: AssistantMessage,
  event: MessageStreamEvent,
  now: number,
  blockIndexes: Map<number, number>
): AssistantMessage => {
  const next: AssistantMessage =
    reply.status === 'streaming' ? reply : { ...reply, status: 'streaming' }
  switch (event.type) {
    case 'message_start':
      return { ...next, usage: event.message.usage ?? next.usage }
    case 'content_block_start': {
      blockIndexes.delete(event.index)
      const block = toReplyBlock(event.content_block, now)
      if (!block) {
        // 客户端工具内容不保存；未完成的工具往返也不能作为续写前缀。
        return event.content_block.type === 'tool_use' ? { ...next, prefix: false } : next
      }
      blockIndexes.set(event.index, next.blocks.length)
      return { ...next, blocks: [...next.blocks, block] }
    }
    case 'content_block_delta': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      const { delta } = event
      return updateBlock(next, index, (block) => {
        if (block.type === 'text' && delta.type === 'text_delta') {
          return { ...block, text: block.text + delta.text }
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          return { ...block, thinking: block.thinking + delta.thinking }
        }
        if (block.type === 'thinking' && delta.type === 'signature_delta') {
          return { ...block, signature: (block.signature ?? '') + delta.signature }
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          return { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
        return block
      })
    }
    case 'content_block_stop': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      blockIndexes.delete(event.index)
      return updateBlock(next, index, (block) =>
        block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
          ? { ...block, endedAt: now }
          : block
      )
    }
    case 'message_delta':
      return {
        ...next,
        stopReason: event.delta.stop_reason,
        stopDetails: event.delta.stop_details,
        usage: event.usage ?? next.usage,
      }
    default:
      return next
  }
}

/**
 * 回复结束：未结束的思考块以当前时间收尾。
 * 安全拒绝（stop_reason: refusal）时已下发的思考与正文不能撤回，按协议要求由客户端丢弃，只保留工具块。
 */
export const settleReply = (
  reply: AssistantMessage,
  status: Extract<ReplyStatus, 'done' | 'stopped' | 'error'>,
  now: number,
  error?: AssistantMessage['error']
): AssistantMessage => ({
  ...reply,
  status,
  error,
  blocks: reply.blocks.flatMap((block): ReplyBlock[] => {
    if (reply.stopReason === 'refusal' && (block.type === 'thinking' || block.type === 'text')) {
      return []
    }
    return block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
      ? [{ ...block, endedAt: now }]
      : [block]
  }),
})

/** 回复里所有文本块拼起来，用于复制与判断是否有回答 */
export const getReplyText = (reply: AssistantMessage) =>
  reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * 只有正常达到输出上限或被停止的回复可续写，报错回复不能续写。
 * 末条限制由调用方判断，拒绝和客户端工具调用不能续写。
 * 本轮含服务端工具调用或结果（含 READ_LINK 和孤立结果块）的回复不能续写。
 * 服务端模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.stopReason === 'refusal' ||
    reply.stopReason === 'tool_use' ||
    reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result' ||
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  return (
    reply.status === 'stopped' ||
    (reply.status === 'done' && reply.stopReason === 'max_tokens')
  )
}

/**
 * 已结束或停止且有回答文本的回复才放进上下文；被安全拒绝的轮次不回传。
 * 服务端模板提示不进入上下文。
 */
const isUsableReply = (message: Message): message is AssistantMessage =>
  message.role === 'assistant' &&
  (message.status === 'done' || message.status === 'stopped') &&
  message.stopReason !== 'refusal' &&
  !message.blocks.some((block) => block.type === 'text' && block.isTemplate) &&
  getReplyText(message) !== ''

/** 附件退出上下文时替代文件块的说明，让模型知道这一轮原本带过文件 */
const droppedFilesNote = (count: number) =>
  `（此前附带的 ${count} 个附件已不在本次上下文中，如需继续分析请重新上传。）`

/**
 * 有文件时用内容块数组：先文件后文本，文件按 Files API 的 file_id 引用。
 * sendFiles 是本轮真正挂块的文件；同一份文件反复上传时只在首次出现处挂一次，
 * 其余轮次不重复挂、也不提示丢失——文件仍在上下文的首次出现处。
 * droppedCount 只对真被数量上限排除的文件计数。
 */
const toUserParam = (
  { content }: UserMessage,
  sendFiles: FileAttachment[],
  droppedCount = 0
): MessageParam => {
  const blocks = toFileBlocks(sendFiles)
  const profiles = toProfileBlocks(sendFiles)
  const text =
    droppedCount > 0
      ? [content, droppedFilesNote(droppedCount)].filter(Boolean).join('\n\n')
      : content
  if (blocks.length === 0 && profiles.length === 0) {
    return { role: 'user', content: text }
  }
  return {
    role: 'user',
    content: [...blocks, ...profiles, ...(text ? [{ type: 'text' as const, text }] : [])],
  }
}

/** 同一份课件可能被反复上传：按文件名 + 大小 + 图片类型识别，避免每问一轮就多挂一个文档块 */
const fileKey = (file: FileAttachment) => `${file.isImage ? '1' : '0'}|${file.name}|${file.size}`

/** 能真正进入请求的文件：原件还在，且没有被本地摘要替代 */
const isAttachable = (file: FileAttachment) =>
  Boolean(file.serverId) && !getCsvProfile(file.id)?.sampleOnly

/**
 * assistant 的内容块按历史与续写场景转换：
 * - 历史思考及其签名不回传；开启思考时续写只保留本轮非空白思考及其签名；
 * - 文本块去掉 citations（服务端忽略）。相邻文本直接拼接，被思考或工具隔开的文本用空行连接；
 *   省略历史思考后仍保留其前后正文的空行；
 * - 工具调用和结果只保留 kind 为 read_link 的块，其他历史工具块不回传；
 * - 阅读链接结果原样回传，保留 signature：服务端解密后将页面拼回该轮提问末尾；
 */
const toAssistantParam = (
  { blocks }: AssistantMessage,
  prefix = false,
  thinking = false
): Extract<MessageParam, { role: 'assistant' }> => {
  const content: AssistantBlockParam[] = []
  // 成功阅读的网页靠签名恢复正文；缺少有效签名时，调用与结果都不回传。
  const unsignedReadLinks = new Set(
    blocks.flatMap((block) =>
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      block.content.type === 'web_fetch_result' &&
      !block.signature?.trim()
        ? [block.tool_use_id]
        : []
    )
  )
  /** 正在拼接的文本块；遇到任何非文本块（含不回传的思考块）就结束 */
  let text: TextBlockParam | null = null
  for (const block of blocks) {
    // 空思考不改变续写位置，也不应把两段正文隔开，导致后端额外插入空行。
    if (prefix && block.type === 'thinking' && !block.thinking.trim()) {
      continue
    }
    if (block.type === 'text') {
      if (text) {
        text.text += block.text
      } else {
        const previous = content.at(-1)
        text = {
          type: 'text',
          text: `${previous?.type === 'text' ? '\n\n' : ''}${block.text}`,
        }
        content.push(text)
      }
      continue
    }
    text = null
    if (prefix && thinking && block.type === 'thinking') {
      // 续写保留本轮思考，历史轮次的思考省略。
      const { type, thinking, signature } = block
      content.push({ type, thinking, signature: signature ?? '' })
    } else if (
      block.type === 'server_tool_use' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.id)
    ) {
      const { type, id, name, input, kind } = block
      content.push({ type, id, name, input, kind })
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.tool_use_id)
    ) {
      content.push(block)
    }
  }
  return {
    role: 'assistant',
    content: content.filter((block) => block.type !== 'text' || block.text !== ''),
  }
}

/** 历史中会进入请求上下文的轮次：提问后紧跟可用回答的才保留 */
export const getContextRounds = (history: Message[]): [UserMessage, AssistantMessage][] => {
  const rounds: [UserMessage, AssistantMessage][] = []
  for (let i = 0; i + 1 < history.length; i++) {
    const [user, reply] = [history[i], history[i + 1]]
    if (user.role === 'user' && isUsableReply(reply)) {
      rounds.push([user, reply])
      i++
    }
  }
  return rounds
}

/**
 * 粗略估算 token 数：中文约 1.5 字符/token，英文约 4 字符/token。
 * 取 1.5 是偏保守的估法（宁可高估、少带历史，也不要真的把上下文撑爆）。
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 1.5)

/**
 * 历史部分默认占用的 token 预算。
 * 两个模型的上下文窗口都是 1M，取 20 万约两成：够长会话连续追问，
 * 同时把单轮延迟和费用控制在可接受范围（历史前缀命中缓存的部分按 1/50 计价）。
 */
export const DEFAULT_CONTEXT_TOKENS = 200_000

/** 单次请求可引用的文档块上限，与服务端限制一致；超出会返回 400 */
const MAX_DOC_BLOCKS = 20

/**
 * 裁剪上下文时保留到预算的这一比例。一次多丢一些，为后续若干轮留出增长空间，
 * 起点才能在一段时间内保持不变——请求前缀稳定，服务端缓存才会持续命中（命中价约为未命中的 1/50）。
 * 若每轮都精确裁到刚好装下，起点会随新增内容每轮前移一位，整段历史全部按未命中计价。
 */
const TRIM_TO_RATIO = 0.6

/** 图片按尺寸折算 token，单张上限 1024；用于把附件成本计入预算 */
const IMAGE_TOKENS = 1024

/**
 * 把会话转成请求的 messages：只保留「提问 + 有回答的回复」成对的轮次，最后接上本轮提问。
 * 失败或没有回答的轮次不进上下文。续写时末尾再带上本轮 assistant。
 *
 * 超出 budget 时从最早的部分开始丢弃，只保留最近的轮次，
 * 并通过 droppedRounds 告知调用方有多少轮没有带上（用于在系统提示里说明）。
 *
 * anchor 是上一轮裁剪后保留的第一条消息 id：能沿用就沿用，使请求前缀在轮次之间保持不变。
 * 只有沿用时确实超出 budget 才重新裁剪，且一次收到 TRIM_TO_RATIO，避免每轮都挪动起点。
 * 返回的 anchor 由调用方存回会话，供下一轮沿用。
 */
export const toRequestMessages = (
  history: Message[],
  question: UserMessage,
  prefix?: AssistantMessage,
  thinking = prefix?.thinking ?? false,
  latestReminder?: string,
  budget: number = DEFAULT_CONTEXT_TOKENS,
  anchor?: string | null,
  styleSeed?: readonly StyleRound[]
): { messages: MessageParam[]; droppedRounds: number; anchor?: string } => {
  const all = getContextRounds(history).filter(
    // 历史提问没有文字、附件也都没有 serverId 时，提问为空，连同回答一起省略。
    ([user]) => Boolean(user.content) || toFileBlocks(user.files).length > 0
  )

  /** 本轮附带的图片张数，按上限折算成 token 计入预算 */
  const imageTokens = (user: UserMessage) =>
    user.files.filter((file) => file.isImage && file.serverId).length * IMAGE_TOKENS

  /** 一轮历史在本轮请求里占用的 token（输入部分） */
  const roundCost = ([user, reply]: [UserMessage, AssistantMessage]) =>
    estimateTokens(user.content ?? '') + estimateTokens(getReplyText(reply)) + imageTokens(user)

  const questionCost = estimateTokens(question.content ?? '') + imageTokens(question)
  // 风格样例固定挂在最前面，也要占预算，否则长会话会超出模型的上下文窗口。
  const seedCost = (styleSeed ?? []).reduce(
    (sum, round) => sum + estimateTokens(round.question) + estimateTokens(round.answer),
    0
  )

  // 先看锚点是否还能沿用：锚点仍存在且连同本轮一起装得下，就完全不动起点。
  let start = -1
  if (anchor) {
    const index = all.findIndex(([user]) => user.id === anchor)
    if (index >= 0) {
      let used = questionCost + seedCost
      for (let i = index; i < all.length; i++) {
        used += roundCost(all[i])
      }
      if (used <= budget) {
        start = index
      }
    }
  }

  if (start < 0) {
    // 没有可用锚点，或沿用锚点会超出预算：从末尾往前装到预算的 TRIM_TO_RATIO。
    const limit = budget * TRIM_TO_RATIO
    let used = questionCost + seedCost
    start = all.length
    for (let i = all.length - 1; i >= 0; i--) {
      const cost = roundCost(all[i])
      // 至少保留最近一轮，即使它本身就超预算
      if (start < all.length && used + cost > limit) {
        break
      }
      used += cost
      start = i
    }
  }
  const kept = all.slice(start)

  /**
   * 附件按「文件身份」去重，不按轮数：同一份课件只在它第一次出现的轮次挂文件块，
   * 后面连续追问时文件仍留在上下文里。既不会第 3 轮突然看不到，也不会每轮重复计费。
   */
  const earliest = new Map<string, FileAttachment>()
  const register = (files: FileAttachment[]) => {
    for (const file of files) {
      if (!isAttachable(file)) {
        continue
      }
      const key = fileKey(file)
      if (!earliest.has(key)) {
        earliest.set(key, file)
      }
    }
  }
  for (const [user] of all) {
    register(user.files)
  }
  register(question.files)

  // 只有「自己就是最早那一份」的轮次挂块；重新上传同名同大小的文件不重复挂
  let slots = kept.map(([user]) =>
    user.files.filter((file) => isAttachable(file) && earliest.get(fileKey(file))?.id === file.id)
  )
  let questionSlot = question.files.filter(
    (file) => isAttachable(file) && earliest.get(fileKey(file))?.id === file.id
  )

  // 最早那次上传已经落在裁剪窗口之外：把文件块补到窗口第一轮，课件不能凭空消失
  const inWindow = new Set([...slots.flat(), ...questionSlot].map((file) => file.id))
  for (const file of earliest.values()) {
    if (inWindow.has(file.id)) {
      continue
    }
    if (slots.length > 0) {
      slots[0] = [...slots[0], file]
    } else {
      questionSlot = [...questionSlot, file]
    }
  }

  // 文档块上限 20（图片不计）：从最新往前分配，真正放不下的才用文字说明
  let docBudget = MAX_DOC_BLOCKS
  const dropped = kept.map(() => 0)
  let questionDropped = 0
  for (let i = slots.length; i >= 0; i--) {
    const list = i === slots.length ? questionSlot : slots[i]
    const accepted: FileAttachment[] = []
    for (const file of list) {
      if (file.isImage || docBudget > 0) {
        accepted.push(file)
        if (!file.isImage) {
          docBudget--
        }
      } else if (i === slots.length) {
        questionDropped++
      } else {
        dropped[i]++
      }
    }
    if (i === slots.length) {
      questionSlot = accepted
    } else {
      slots[i] = accepted
    }
  }

  const messages: MessageParam[] = []
  // 风格样例放在所有历史之前且每轮不变：既是少样本示范，也是稳定的缓存前缀。
  for (const round of styleSeed ?? []) {
    messages.push(
      { role: 'user', content: round.question },
      { role: 'assistant', content: [{ type: 'text' as const, text: round.answer }] }
    )
  }
  let previousReminder: string | undefined
  const appendReminder = (reminder: string | undefined) => {
    // 仅在当前分支首次出现或内容变化时插入快照；缺少快照的消息保持原有内容。
    if (reminder && reminder !== previousReminder) {
      messages.push({ role: 'latest_reminder', content: reminder })
      previousReminder = reminder
    }
  }
  for (const [index, [user, reply]] of kept.entries()) {
    appendReminder(reply.latestReminder)
    messages.push(toUserParam(user, slots[index], dropped[index]), toAssistantParam(reply))
  }
  appendReminder(latestReminder)
  messages.push(toUserParam(question, questionSlot, questionDropped))
  if (prefix?.prefix) {
    const assistant = toAssistantParam(prefix, true, thinking)
    // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
    if (
      assistant.content.some(
        (block) =>
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
      )
    ) {
      messages.push(assistant)
    }
  }
  return { messages, droppedRounds: all.length - kept.length, anchor: kept[0]?.[0].id }
}

/** 思考用时（秒），至少 1 秒 */
export const getThinkingSeconds = (startedAt: number, endedAt: number) =>
  Math.max(1, Math.round((endedAt - startedAt) / 1000))
