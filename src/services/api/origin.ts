/**
 * API 地址：构建期由 DefinePlugin 注入默认值，运行时允许用户改用别的地址
 * （例如自建网关、代理，或其它 OpenAI/Anthropic 兼容服务）。
 *
 * 这里刻意不依赖 zustand 或其它模块，避免与 client.ts / speech.ts 形成循环引用。
 */
const STORAGE_KEY = 'chat-demo:api-origin'

/** 构建期注入的默认地址，通常是 https://api.deepseek.com */
export const DEFAULT_API_ORIGIN: string = __API_ORIGIN__

/** 去掉尾部斜杠并校验 http(s) 协议；非法返回 null */
const normalize = (value: string): string | null => {
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : null
}

/** 当前生效的 API 地址：用户自定义优先，未设置或非法时用默认值 */
export const getApiOrigin = (): string => {
  try {
    const saved = normalize(localStorage.getItem(STORAGE_KEY) ?? '')
    if (saved) {
      return saved
    }
  } catch {
    // 存储不可用时使用默认值
  }
  return DEFAULT_API_ORIGIN
}

/** 读取用户自定义地址；没有自定义时返回空串 */
export const getCustomApiOrigin = (): string => {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY) ?? '') ?? ''
  } catch {
    return ''
  }
}

/** 保存自定义地址；传空值则恢复默认。格式非法返回 false 且不写入 */
export const setApiOrigin = (value: string | null): boolean => {
  const raw = value?.trim() ?? ''
  if (!raw) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 忽略
    }
    return true
  }
  const normalized = normalize(raw)
  if (!normalized) {
    return false
  }
  try {
    localStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    return false
  }
  return true
}
