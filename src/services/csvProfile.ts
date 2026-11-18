/**
 * 本地生成 CSV / TSV 的数据摘要。
 *
 * 目的：大表格原样塞进上下文既贵又必然超限（8 MiB 文本远超 1M token），
 * 而模型又不能真的跑统计。这里在浏览器里先算出行数、列类型、缺失率、
 * 均值标准差分位数，随附件一起发给模型，让它有据可依。
 *
 * 内存有界：只读文件开头 2 MB、最多 2 万行、40 列。
 */

/** 只读取文件开头这么多字节；超出部分不参与统计 */
const SLICE_BYTES = 2 * 1024 * 1024
/** 超过这个大小的文件只发摘要与样本，完整文件必然超出上下文 */
export const SAMPLE_ONLY_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 20_000
const MAX_COLS = 40
const SAMPLE_ROWS = 60
/** 每列最多保留这么多个数值用于分位数，避免排序开销 */
const MAX_VALUES = 10_000
const MAX_DISTINCT = 2000

export type CsvProfile = {
  /** 给模型的摘要正文 */
  summary: string
  /** 大文件的样本行，随摘要一起发送 */
  sample: string
  /** 完整文件是否因为太大而不发送 */
  sampleOnly: boolean
}

const profiles = new Map<string, CsvProfile>()

/** 附件 id → 摘要；只存在于本次会话内存，导入的历史没有 */
export const getCsvProfile = (id: string) => profiles.get(id)

/** 只保留最近的若干份，避免长时间使用后常驻内存 */
const REMEMBER_LIMIT = 20
const remember = (id: string, profile: CsvProfile) => {
  profiles.set(id, profile)
  if (profiles.size > REMEMBER_LIMIT) {
    const oldest = profiles.keys().next().value
    if (oldest !== undefined) {
      profiles.delete(oldest)
    }
  }
}

/** 表头判断：英文扩展名与常见分隔符 */
export const isCsvName = (name: string) => /\.(csv|tsv)$/i.test(name)

const detectDelimiter = (head: string, name: string) => {
  if (/\.tsv$/i.test(name)) {
    return '\t'
  }
  const line = head.slice(0, head.indexOf('\n') + 1 || head.length)
  const counts: Array<[string, number]> = [
    [',', (line.match(/,/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/** 支持引号包裹与转义引号的定界解析，够 CSV 用，不追求全 RFC 覆盖 */
const parseRows = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= MAX_ROWS) {
        return rows
      }
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const round = (value: number) => {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0)
  }
  return Number(value.toFixed(3)).toString()
}

/** 分位数用线性插值，够描述性统计使用 */
const quantile = (sorted: number[], ratio: number) => {
  if (sorted.length === 0) {
    return Number.NaN
  }
  const pos = (sorted.length - 1) * ratio
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base])
}

type ColumnStats =
  | { kind: 'numeric'; missing: number; min: number; p25: number; p50: number; p75: number; max: number; mean: number; sd: number }
  | { kind: 'text'; missing: number; distinct: number; top: string[] }

const summarizeColumn = (name: string, values: string[], total: number): { line: string; stats: ColumnStats } => {
  let missing = 0
  let numericCount = 0
  const numbers: number[] = []
  const seen = new Map<string, number>()
  let distinctCapped = false
  for (const raw of values) {
    const value = raw.trim()
    if (value === '') {
      missing++
      continue
    }
    const numeric = Number(value.replace(/,/g, ''))
    if (Number.isFinite(numeric) && value.replace(/,/g, '') !== '') {
      // 计数与取样分开：保留的数值有上限，判断类型时必须用真实命中数
      numericCount++
      if (numbers.length < MAX_VALUES) {
        numbers.push(numeric)
      }
    }
    if (seen.size < MAX_DISTINCT) {
      seen.set(value, (seen.get(value) ?? 0) + 1)
    } else {
      distinctCapped = true
      const known = seen.get(value)
      if (known !== undefined) {
        seen.set(value, known + 1)
      }
    }
  }
  const nonEmpty = total - missing
  const numericRatio = nonEmpty > 0 ? numericCount / nonEmpty : 0
  if (nonEmpty >= 2 && numericRatio >= 0.9 && numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a - b)
    const sum = sorted.reduce((acc, value) => acc + value, 0)
    const mean = sum / sorted.length
    const variance =
      sorted.length > 1
        ? sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (sorted.length - 1)
        : 0
    const stats: ColumnStats = {
      kind: 'numeric',
      missing,
      min: sorted[0],
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      max: sorted[sorted.length - 1],
      mean,
      sd: Math.sqrt(variance),
    }
    return {
      stats,
      line: `${name}｜数值｜缺失 ${missing}｜最小 ${round(stats.min)} · 下四分位 ${round(stats.p25)} · 中位 ${round(
        stats.p50
      )} · 上四分位 ${round(stats.p75)} · 最大 ${round(stats.max)}｜均值 ${round(stats.mean)} · 标准差 ${round(
        stats.sd
      )}`,
    }
  }
  const top = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => `${value}(${count})`)
  return {
    stats: { kind: 'text', missing, distinct: seen.size, top },
    line: `${name}｜文本｜缺失 ${missing}｜${distinctCapped ? '超过' : ''}${seen.size} 种取值${
      top.length > 0 ? `，最多：${top.join(' ')}` : ''
    }`,
  }
}

/** Excel 导出的中文 CSV 常见 GBK 编码，先按 UTF-8 解，出现替换字符再回退 */
const decodeText = (buffer: ArrayBuffer) => {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) {
    return utf8.replace(/^\uFEFF/, '')
  }
  try {
    return new TextDecoder('gb18030').decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return utf8.replace(/^\uFEFF/, '')
  }
}

/** 扫描文件开头，返回摘要与样本；解析不出表格时返回 null */
export const buildCsvProfile = async (
  id: string,
  file: Blob,
  name: string
): Promise<CsvProfile | null> => {
  const slice = file.size > SLICE_BYTES ? file.slice(0, SLICE_BYTES) : file
  const text = decodeText(await slice.arrayBuffer())
  if (!text.trim()) {
    return null
  }
  const delimiter = detectDelimiter(text, name)
  const rows = parseRows(text, delimiter)
  if (rows.length < 2) {
    return null
  }
  const header = rows[0].slice(0, MAX_COLS).map((cell, index) => cell.trim() || `第 ${index + 1} 列`)
  const body = rows.slice(1)
  const columns = header.map((_, index) => body.map((row) => row[index] ?? ''))
  const lines = header.map((title, index) =>
    summarizeColumn(title, columns[index], body.length).line
  )
  const truncated = file.size > SLICE_BYTES || rows.length >= MAX_ROWS
  const sampleOnly = file.size > SAMPLE_ONLY_BYTES
  const sample = body
    .slice(0, SAMPLE_ROWS)
    .map((row) =>
      row
        .slice(0, MAX_COLS)
        .map((cell) => (cell.length > 40 ? `${cell.slice(0, 40)}…` : cell))
        .join(' | ')
    )
    .join('\n')

  const head = [
    `【本地数据摘要 · ${name}】`,
    `行数 ${body.length.toLocaleString('zh-CN')}${truncated ? '（仅统计文件开头部分）' : ''} · 列数 ${
      rows[0].length
    } · 分隔符 ${delimiter === '\t' ? '制表符' : delimiter}`,
    ...lines,
  ]
  if (sampleOnly) {
    head.push(
      `说明：原文件 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过单次请求可容纳的长度，未整体发送；下面是前 ${Math.min(
        SAMPLE_ROWS,
        body.length
      )} 行样本。要算具体指标请说明口径，我会按上面的摘要和样本回答。`
    )
  } else {
    head.push('说明：完整数据在附件中，上面是本地预先算好的摘要，可用于核对。')
  }
  const profile: CsvProfile = {
    summary: head.join('\n'),
    sample: sampleOnly ? `【前 ${Math.min(SAMPLE_ROWS, body.length)} 行样本】\n${sample}` : '',
    sampleOnly,
  }
  remember(id, profile)
  return profile
}
