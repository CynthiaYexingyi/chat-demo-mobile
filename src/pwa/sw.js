/**
 * 离线缓存：让手机浏览器不必每次打开都重新下载应用外壳。
 *
 * 两条规则：
 * - 页面（导航请求）走「先联网、失败用缓存」，保证上线新版本后刷新即是最新；
 * - 其余同源静态资源走「先缓存、没有再联网」。构建产物文件名带内容哈希，
 *   内容一变文件名就变，所以缓存旧文件永远不会读到过期内容。
 *
 * 跨域请求（DeepSeek 接口、外链图片）一律不接管，避免影响对话本身。
 */

const CACHE_NAME = 'deepseek-shell-v1'
/** 缓存条目上限，超出后按写入顺序淘汰最旧的，防止长期使用后无限膨胀 */
const MAX_ENTRIES = 400
/** 联网超过这个时间就直接用缓存，弱网下不让人干等 */
const HTML_TIMEOUT_MS = 4000

/** 应用首页在缓存里的固定键：导航地址可能带查询串，用它避免命中不到 */
const INDEX_KEY = new URL('./', self.registration.scope).href

const isNavigation = (request) =>
  request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')

/** 超出上限时删掉最旧的条目；cache.keys() 按写入顺序返回 */
const trim = async (cache) => {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) {
    return
  }
  for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
    await cache.delete(key)
  }
}

/** 联网优先：拿到就用并写入缓存，超时或失败退回缓存 */
const networkFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HTML_TIMEOUT_MS)),
    ])
    if (response && response.ok) {
      await cache.put(INDEX_KEY, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(INDEX_KEY)
    if (cached) {
      return cached
    }
    throw new Error('offline and no cached page')
  }
}

/** 缓存优先：命中直接返回，未命中再联网并存入缓存 */
const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  if (response && response.ok && response.status === 200) {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
    void trim(cache)
  }
  return response
}

self.addEventListener('install', () => {
  // 新版本就绪后直接待命，下次打开页面即生效，不需要用户点「刷新」
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉与本版本无关的旧缓存
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  // 跨域一律不接管：接口、图片、字体 CDN 保持原生行为
  if (url.origin !== self.location.origin) {
    return
  }
  // 将来若在同源挂后端接口，路径里带 /api/ 的也不缓存
  if (url.pathname.includes('/api/')) {
    return
  }
  event.respondWith(isNavigation(request) ? networkFirst(request) : cacheFirst(request))
})
