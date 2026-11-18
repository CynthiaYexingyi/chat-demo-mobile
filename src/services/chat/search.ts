import { loadSession } from './db.js'
import { searchInWorker, warmIndex } from './searchIndex/client.js'
import { MAX_HITS, matchSession, type SearchHit } from './searchIndex/text.js'
import type { SessionSummary } from './types.js'

export type { SearchHit }

const toTarget = (summary: SessionSummary) => ({
  id: summary.id,
  title: summary.title ?? '',
  updatedAt: summary.updatedAt,
})

/**
 * 兜底扫描：后台线程不可用时在主线程逐个会话读出来找。
 * 每读一个会话 await 一次，给界面留出响应的机会。
 */
const scanOnMainThread = async (
  summaries: SessionSummary[],
  query: string,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<SearchHit[]> => {
  const hits: SearchHit[] = []
  const total = summaries.length

  for (let i = 0; i < total; i += 1) {
    if (options.signal?.aborted) {
      break
    }
    const summary = summaries[i]
    const session = await loadSession(summary.id)
    if (session) {
      const hit = matchSession(session, query)
      if (hit) {
        hits.push({ sessionId: summary.id, title: summary.title || '未命名', ...hit })
        if (hits.length >= MAX_HITS) {
          break
        }
      }
    }
    options.onProgress?.(i + 1, total)
  }

  return hits
}

/**
 * 全文搜索：优先交给后台线程——几十 MB 的会话只在那里读取和扫描，
 * 主线程不再被卡住；有索引时还能跳过大部分不可能命中的会话。
 * 后台不可用或出错时退回主线程扫描，保证搜索始终有结果。
 */
export const searchSessions = async (
  summaries: SessionSummary[],
  rawQuery: string,
  options: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  } = {}
): Promise<SearchHit[]> => {
  const query = rawQuery.trim()
  if (!query) {
    return []
  }
  try {
    return await searchInWorker(summaries.map(toTarget), query, options)
  } catch {
    return scanOnMainThread(summaries, query, options)
  }
}

/** 空闲时让后台补齐索引；不阻塞界面，失败也无副作用 */
export const warmSearchIndex = (summaries: SessionSummary[]): void => {
  warmIndex(summaries.map(toTarget))
}
