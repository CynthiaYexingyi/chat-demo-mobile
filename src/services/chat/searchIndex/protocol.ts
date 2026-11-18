import type { SearchHit } from './text.js'

/** 会话摘要的最小集合，够搜索排序和进度展示用 */
export type SearchTarget = { id: string; title: string; updatedAt: number }

export type SearchRequest = {
  type: 'search'
  id: number
  query: string
  sessions: SearchTarget[]
}

export type CancelRequest = { type: 'cancel'; id: number }

/** 空闲时补建索引，不返回结果 */
export type IndexRequest = { type: 'index'; sessions: SearchTarget[] }

export type WorkerRequest = SearchRequest | CancelRequest | IndexRequest

export type SearchProgress = { type: 'progress'; id: number; done: number; total: number }
export type SearchResult = { type: 'result'; id: number; hits: SearchHit[] }
/** 后台出错：调用方据此退回主线程扫描，避免搜索静默失败 */
export type SearchFailed = { type: 'error'; id: number }

export type WorkerResponse = SearchProgress | SearchResult | SearchFailed
