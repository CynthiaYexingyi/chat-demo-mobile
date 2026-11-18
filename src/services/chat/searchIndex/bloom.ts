/**
 * 会话级布隆过滤器：用很小的位图回答「这个会话里可能出现过某段文字吗」。
 *
 * 索引的是「双字」：中文按相邻两个字切成片段，英文按相邻两个字母。查询时把关键词
 * 也切成双字逐个比对，只要有一个双字不在位图里，这个会话就**一定**不包含关键词，
 * 可以直接跳过，不用把它那几十 MB 的正文读出来。反过来，位图命中只说明「可能」，
 * 仍需读出来确认——因此结果是准确的，误判只会多读一个会话。
 *
 * 尺寸按正文字数估：实测去重后每字约产生 0.023 个新双字，取每字 0.4 位，
 * 相当于每项约 17 位，两个哈希函数下误判率约 1%。
 */

/** 每字预留的位数 */
const BITS_PER_CHAR = 0.4
const MIN_BYTES = 1024
const MAX_BYTES = 1 << 20
/** 哈希函数个数；两个足够，再多会拖慢建索引 */
const HASH_COUNT = 2
/** 单字也记一位，让一个字的关键词也能被过滤 */
const UNIGRAM_SALT = 0x20

/** 两个 UTF-16 码元混成一个 32 位无符号整数，避免为每个双字分配字符串 */
const hashPair = (a: number, b: number): number => {
  let h = Math.imul(a, 0x1f1f1f1f) ^ Math.imul(b + 1, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39)
  h ^= h >>> 16
  return h >>> 0
}

const addHash = (filter: Uint8Array, totalBits: number, hash: number): void => {
  const step = (hash >>> 13) | 1
  let pos = hash % totalBits
  for (let i = 0; i < HASH_COUNT; i += 1) {
    filter[pos >>> 3] |= 1 << (pos & 7)
    pos = (pos + step) % totalBits
  }
}

const hasHash = (filter: Uint8Array, totalBits: number, hash: number): boolean => {
  const step = (hash >>> 13) | 1
  let pos = hash % totalBits
  for (let i = 0; i < HASH_COUNT; i += 1) {
    if ((filter[pos >>> 3] & (1 << (pos & 7))) === 0) {
      return false
    }
    pos = (pos + step) % totalBits
  }
  return true
}

/** 按正文字数决定位图大小，四字节对齐 */
const sizeFor = (chars: number): number => {
  const raw = Math.ceil((chars * BITS_PER_CHAR) / 8)
  return Math.min(MAX_BYTES, Math.max(MIN_BYTES, Math.ceil(raw / 4) * 4))
}

/** 为一段正文建立位图 */
export const buildFilter = (text: string): Uint8Array => {
  const lower = text.toLowerCase()
  const filter = new Uint8Array(sizeFor(lower.length))
  const totalBits = filter.length * 8
  for (let i = 0; i < lower.length; i += 1) {
    addHash(filter, totalBits, hashPair(lower.charCodeAt(i), UNIGRAM_SALT))
    if (i + 1 < lower.length) {
      addHash(filter, totalBits, hashPair(lower.charCodeAt(i), lower.charCodeAt(i + 1)))
    }
  }
  return filter
}

/**
 * 位图里是否可能存在这段文字。返回 false 表示一定不包含，可以放心跳过；
 * 返回 true 表示可能包含，需要读正文确认。
 */
export const mightContain = (filter: Uint8Array, needle: string): boolean => {
  const lower = needle.toLowerCase()
  if (lower.length === 0) {
    return true
  }
  const totalBits = filter.length * 8
  for (let i = 0; i < lower.length; i += 1) {
    if (!hasHash(filter, totalBits, hashPair(lower.charCodeAt(i), UNIGRAM_SALT))) {
      return false
    }
    if (i + 1 < lower.length && !hasHash(filter, totalBits, hashPair(lower.charCodeAt(i), lower.charCodeAt(i + 1)))) {
      return false
    }
  }
  return true
}
