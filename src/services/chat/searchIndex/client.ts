/**
 * 主线程这一侧的搜索入口：只负责发消息、收结果，不碰会话数据。
 * 后台线程不可用时抛错，由调用方退回主线程扫描。
 */
import type { SearchTarget, WorkerRequest, WorkerResponse } from './protocol.js'
import type { SearchHit } from './text.js'

type Waiter = {
  resolve: (hits: SearchHit[]) => void
  reject: (error: Error) => void
  onProgress?: (done: number, total: number) => void
}

let worker: Worker | null = null
let failed = false
const waiters = new Map<number, Waiter>()
let seq = 0

const settle = (id: number): Waiter | undefined => {
  const waiter = waiters.get(id)
  waiters.delete(id)
  return waiter
}

const getWorker = (): Worker | null => {
  if (worker) {
    return worker
  }
  if (failed || typeof Worker === 'undefined') {
    return null
  }
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url))
  } catch {
    failed = true
    return null
  }
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    if (data.type === 'progress') {
      waiters.get(data.id)?.onProgress?.(data.done, data.total)
      return
    }
    const waiter = settle(data.id)
    if (!waiter) {
      return
    }
    if (data.type === 'result') {
      waiter.resolve(data.hits)
    } else {
      waiter.reject(new Error('search worker failed'))
    }
  })
  worker.addEventListener('error', () => {
    // 线程崩溃：本次及后续请求都退回主线程，不再重试
    failed = true
    worker = null
    for (const [id, waiter] of waiters) {
      waiters.delete(id)
      waiter.reject(new Error('search worker crashed'))
    }
  })
  return worker
}

/**
 * 在后台线程里搜索。中止时放弃等待并让后台停止读取后续会话。
 * 返回的 Promise 在后台不可用、出错时 reject，由调用方兜底。
 */
export const searchInWorker = (
  sessions: SearchTarget[],
  query: string,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<SearchHit[]> => {
  const target = getWorker()
  if (!target) {
    return Promise.reject(new Error('search worker unavailable'))
  }
  const id = (seq += 1)
  return new Promise<SearchHit[]>((resolve, reject) => {
    waiters.set(id, { resolve, reject, onProgress: options.onProgress })
    const abort = () => {
      if (settle(id)) {
        target.postMessage({ type: 'cancel', id } satisfies WorkerRequest)
        resolve([])
      }
    }
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    target.postMessage({ type: 'search', id, query, sessions } satisfies WorkerRequest)
  })
}

/** 空闲时让后台把索引补齐；重复调用不会重建已有索引 */
export const warmIndex = (sessions: SearchTarget[]): void => {
  const target = getWorker()
  target?.postMessage({ type: 'index', sessions } satisfies WorkerRequest)
}
