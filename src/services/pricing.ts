import type { ChatModel, MessageUsage } from './api/types.js'

/**
 * 按官方刊例价估算这一轮花了多少钱，用于让用户看到「缓存有没有命中」的实际影响。
 * 价格单位是美元/百万 token，取峰时价；谷时为峰时的一半。
 * 官方调价后这里会不准，只作量级参考，不参与任何逻辑判断。
 */
type Price = {
  /** 命中上下文缓存 */
  hit: number
  /** 未命中缓存（含新写入缓存的部分） */
  miss: number
  /** 输出，思考过程也按输出计价 */
  out: number
}

const PRICES: Record<ChatModel, Price> = {
  'deepseek-flash': { hit: 0.006, miss: 0.3, out: 1.2 },
  'deepseek-v4-pro': { hit: 0.044, miss: 1.32, out: 3.96 },
}

/** 估算用汇率，按 1 美元 ≈ 7.1 元 */
const USD_TO_CNY = 7.1

/**
 * 峰时（UTC）：周一至周五 01:00–04:00 与 06:00–10:00，即北京时间工作日的 09:00–12:00、14:00–18:00。
 * 其余时间（含周末与法定节假日整天）按谷时半价计费。
 */
export const isPeakHour = (at: number): boolean => {
  const date = new Date(at)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) {
    return false
  }
  const hour = date.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** 输入 token 总数（含命中与新建缓存） */
export const totalInputTokens = (usage: MessageUsage): number =>
  usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens

/** 命中缓存的比例；没有输入时返回 0 */
export const cacheHitRate = (usage: MessageUsage): number => {
  const total = totalInputTokens(usage)
  return total > 0 ? usage.cache_read_input_tokens / total : 0
}

/** 本轮估算费用（元） */
export const estimateCost = (usage: MessageUsage, model: ChatModel, at: number): number => {
  const price = PRICES[model] ?? PRICES['deepseek-flash']
  const missed = usage.input_tokens + usage.cache_creation_input_tokens
  const usd =
    (missed * price.miss + usage.cache_read_input_tokens * price.hit + usage.output_tokens * price.out) /
    1_000_000
  return usd * (isPeakHour(at) ? 1 : 0.5) * USD_TO_CNY
}

/** 不到一分钱的按「＜¥0.01」显示，其余保留两位小数 */
export const formatCost = (cost: number): string =>
  cost < 0.01 ? '＜¥0.01' : `¥${cost.toFixed(cost < 1 ? 2 : 1)}`
