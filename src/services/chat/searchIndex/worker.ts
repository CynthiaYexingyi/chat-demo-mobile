/**
 * 搜索在独立线程里跑：几十 MB 的会话 JSON 只在后台读取和扫描，
 * 主线程不再被结构化成对象，输入和滚动都不会卡。
 *
 * 每个会话有一张布隆位图（见 bloom.ts），能提前排除「一定不包含关键词」的会话，
 * 因此多数搜索只需要真正打开命中的那几个会话。
 */
import { loadSearchIndex, loadSession, pruneSearchIndex, saveSearchIndex } from '../db.js'
import type { Session } from '../types.js'
import { buildFilter, mightContain } from './bloom.js'
import type { IndexRequest, SearchRequest, SearchTarget, WorkerRequest } from './protocol.js'
import { MAX_HITS, matchSession, sessionText, type SearchHit } from './text.js'

/** 内存里的位图缓存；打开页面后第一次搜索或后台补建时会填满 */
const filters = new Map<string, { updatedAt: number; bits: Uint8Array }>()
/** 已取消的搜索 id */
const cancelled = new Set<number>()

const post = (message: unknown) => self.postMessage(message)

/**
 * 取会话位图：内存 → IndexedDB → 现建。
 * 传入 session 时直接用它建，省去再读一次。
 */
const getFilter = async (
  id: string,
  updatedAt: number,
  session?: Session
): Promise<Uint8Array | null> => {
  const cached = filters.get(id)
  if (cached && cached.updatedAt === updatedAt) {
    return cached.bits
  }
  if (!session) {
    const record = await loadSearchIndex(id)
    if (record && record.updatedAt === updatedAt) {
      filters.set(id, { updatedAt, bits: record.bits })
      return record.bits
    }
  }
  const target = session ?? (await loadSession(id))
  if (!target) {
    return null
  }
  const text = sessionText(target)
  const bits = buildFilter(text)
  filters.set(id, { updatedAt, bits })
  // 写入失败不影响本次搜索，下次重新建即可
  void saveSearchIndex({ id, updatedAt, chars: text.length, bits }).catch(() => {})
  return bits
}

const runSearch = async (request: SearchRequest): Promise<void> => {
  const query = request.query.trim().toLowerCase()
  const total = request.sessions.length
  const hits: SearchHit[] = []

  if (!query) {
    post({ type: 'result', id: request.id, hits })
    return
  }

  for (let i = 0; i < total; i += 1) {
    // 换关键词时旧任务要被立刻丢掉，不再读后续会话
    if (cancelled.delete(request.id)) {
      return
    }
    const target = request.sessions[i]
    const bits = await getFilter(target.id, target.updatedAt)
    if (bits && !mightContain(bits, query)) {
      post({ type: 'progress', id: request.id, done: i + 1, total })
      continue
    }
    const session = await loadSession(target.id)
    if (!session) {
      post({ type: 'progress', id: request.id, done: i + 1, total })
      continue
    }
    // 刚读出来的会话顺手补上索引，下次搜索就能跳过它
    if (!bits) {
      await getFilter(target.id, target.updatedAt, session)
    }
    const hit = matchSession(session, query)
    if (hit) {
      hits.push({ sessionId: target.id, title: target.title || '未命名', ...hit })
      if (hits.length >= MAX_HITS) {
        break
      }
    }
    post({ type: 'progress', id: request.id, done: i + 1, total })
  }

  post({ type: 'result', id: request.id, hits })
}

/** 空闲时把还没建、或已过期的位图补齐，并清掉删除会话留下的记录 */
const runIndex = async (sessions: SearchTarget[]): Promise<void> => {
  for (const target of sessions) {
    const cached = filters.get(target.id)
    if (cached && cached.updatedAt === target.updatedAt) {
      continue
    }
    const record = await loadSearchIndex(target.id)
    if (record && record.updatedAt === target.updatedAt) {
      filters.set(target.id, { updatedAt: target.updatedAt, bits: record.bits })
      continue
    }
    const session = await loadSession(target.id)
    if (!session) {
      continue
    }
    const text = sessionText(session)
    const bits = buildFilter(text)
    filters.set(target.id, { updatedAt: target.updatedAt, bits })
    await saveSearchIndex({ id: target.id, updatedAt: target.updatedAt, chars: text.length, bits })
  }
  await pruneSearchIndex(sessions.map((target) => target.id))
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const data = event.data
  if (data.type === 'cancel') {
    cancelled.add(data.id)
    return
  }
  if (data.type === 'search') {
    void runSearch(data).catch(() => {
      post({ type: 'error', id: data.id })
    })
    return
  }
  if (data.type === 'index') {
    void runIndex(data.sessions as IndexRequest['sessions']).catch(() => {})
  }
})
