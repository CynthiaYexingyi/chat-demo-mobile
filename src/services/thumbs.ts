import { loadThumb, saveThumb } from './chat/db.js'

/**
 * 图片缩略图：消息里只用 120px 的格子，却去解码手机原图（4000×3000 解码后占 48MB 内存），
 * 几张就够让手机上页面被杀。这里统一生成 320px 的 webp 存进 IndexedDB，
 * 列表只读小图，点开看大图时才碰原图。
 */

const THUMB_MAX = 320
const THUMB_QUALITY = 0.82

/** 生成缩略图；失败（格式不支持、内存不足）返回 null，由调用方退回原图 */
export const makeThumb = async (blob: Blob): Promise<Blob | null> => {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) {
        bitmap.close()
        return null
      }
      context.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()
      return await canvas.convertToBlob({ type: 'image/webp', quality: THUMB_QUALITY })
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return null
    }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/webp', THUMB_QUALITY)
    })
  } catch {
    return null
  }
}

/** 取缩略图：已有就直接用；没有则用原件生成一次并落库 */
export const ensureThumb = async (id: string, original: Blob): Promise<Blob | null> => {
  const cached = await loadThumb(id)
  if (cached) {
    return cached
  }
  const thumb = await makeThumb(original)
  if (thumb) {
    void saveThumb(id, thumb).catch(() => undefined)
  }
  return thumb
}

/** 新上传的图片立刻生成缩略图，之后打开会话就不用再解码原图 */
export const prepareThumbnails = async (
  files: { id: string; blob: Blob }[]
): Promise<void> => {
  for (const file of files) {
    if (!file.blob.type.startsWith('image/')) {
      continue
    }
    try {
      const thumb = await makeThumb(file.blob)
      if (thumb) {
        await saveThumb(file.id, thumb)
      }
    } catch {
      // 生成失败不影响发送，显示时再退回原图
    }
  }
}

/** 上传用的长边上限：手机原图动辄 4000px、几 MB，缩到这个尺寸文字仍然清楚 */
const UPLOAD_MAX_EDGE = 2048
const UPLOAD_QUALITY = 0.9
/** 小于这个体积的图片不值得再压一次 */
const UPLOAD_SKIP_BYTES = 700 * 1024

/**
 * 上传前把过大的图片缩到长边 UPLOAD_MAX_EDGE 的 webp：上传快几倍，也少占服务端存储。
 * 本地原件不动，点开看大图仍是原样；压缩失败就按原图上传。
 */
export const shrinkForUpload = async (blob: Blob): Promise<Blob> => {
  if (!blob.type.startsWith('image/') || blob.type === 'image/gif') {
    return blob
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= UPLOAD_MAX_EDGE && blob.size <= UPLOAD_SKIP_BYTES) {
      bitmap.close()
      return blob
    }
    const scale = Math.min(1, UPLOAD_MAX_EDGE / longest)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const draw = (context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) =>
      context.drawImage(bitmap, 0, 0, width, height)

    let result: Blob | null = null
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context) {
        draw(context)
        result = await canvas.convertToBlob({ type: 'image/webp', quality: UPLOAD_QUALITY })
      }
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context) {
        draw(context)
        result = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', UPLOAD_QUALITY)
        )
      }
    }
    bitmap.close()
    // 压完反而更大（小图或已是高压缩比）就用原图
    return result && result.size < blob.size ? result : blob
  } catch {
    return blob
  }
}
