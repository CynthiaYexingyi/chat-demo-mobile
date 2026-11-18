/**
 * 注册离线缓存（见 sw.js）。
 * 只在正式构建里注册：开发服务器的资源名固定，缓存住会挡住热更新。
 * file:// 打开时浏览器不支持 Service Worker，直接跳过。
 */
export const registerServiceWorker = () => {
  if (__IS_DEV__ || !('serviceWorker' in navigator)) {
    return
  }
  if (location.protocol !== 'https:' && location.protocol !== 'http:') {
    return
  }
  const register = () => {
    // 与 index.html 同目录，按页面地址解析，兼容部署在子路径下的情况
    const swUrl = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).catch(() => {
      // 注册失败不影响正常使用，只是少了离线能力
    })
  }
  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register, { once: true })
  }
}
