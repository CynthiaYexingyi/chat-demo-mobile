/**
 * 手动分组：用户自己把几个有关联的对话放在一起并命名。
 *
 * 分组定义很小（名字 + id），存 localStorage，和设置一样；会话只多存一个 collectionId。
 * 这样分组改名/换色不用重写每一条会话，也不会改动对话正文与服务端缓存前缀。
 */
/** 从对话里直接摘出来的问答样例；不是提示词，模型照着例子的解释风格回答。 */
export type StyleRound = {
  question: string
  answer: string
}

export type ChatCollection = {
  id: string
  name: string
  createdAt: number
  /** 本组的解释风格样例（最多两轮），本组所有会话的请求都会带上 */
  styleSeed?: StyleRound[]
}

const STORAGE_KEY = 'deepseek-mine-collections-v1'

export const loadCollections = (): ChatCollection[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item): item is ChatCollection =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ChatCollection).id === 'string' &&
        typeof (item as ChatCollection).name === 'string' &&
        typeof (item as ChatCollection).createdAt === 'number'
    )
  } catch {
    return []
  }
}

export const saveCollections = (collections: readonly ChatCollection[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collections))
  } catch {
    // 隐私模式下 localStorage 可能不可用；分组退回为本次会话内的临时数据。
  }
}

/** 去掉首尾空白；空名字调用方拒绝 */
export const cleanCollectionName = (name: string): string => name.trim().slice(0, 40)
