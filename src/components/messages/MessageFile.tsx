import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads } from '../../services/attachments.js'
import { loadFile, loadThumb } from '../../services/chat/db.js'
import { ensureThumb } from '../../services/thumbs.js'
import type { FileAttachment } from '../../services/chat/types.js'
import { IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import { FileCard } from '../files/FileCard.js'
import styles from './MessageFile.module.css'

/**
 * 列表里显示用的地址：图片读缩略图（没有就生成一次），其余读原件。
 * 原图只在点开大图时才读 —— 用 4000px 的原图填 120px 的格子，手机上几张就能把页面撑爆。
 */
const useFileUrl = (file: FileAttachment) => {
  const [state, setState] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    const load = async () => {
      let blob = file.isImage ? await loadThumb(file.id) : undefined
      if (!blob) {
        const original = await loadFile(file.id)
        blob = original
          ? file.isImage
            ? ((await ensureThumb(file.id, original)) ?? original)
            : original
          : undefined
      }
      if (cancelled) {
        return
      }
      objectUrl = blob ? URL.createObjectURL(blob) : null
      setState({ id: file.id, url: objectUrl })
    }
    void load()
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [file.id, file.isImage])
  return state?.id === file.id ? state.url : undefined
}

/** 点开大图：这里才读原件，读出来临时给一个本地地址，关闭即释放 */
const ImageViewer = ({ file, onClose }: { file: FileAttachment; onClose: () => void }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void loadFile(file.id).then((blob) => {
      if (cancelled) {
        return
      }
      objectUrl = blob ? URL.createObjectURL(blob) : null
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [file.id])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className={styles.viewer} onClick={onClose} role="dialog" aria-label={file.name}>
      {url ? (
        <img
          className={styles.viewerImage}
          src={url}
          alt={file.name}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <span className={styles.spinner} />
      )}
    </div>
  )
}

/** 历史或失效附件的补传状态：只在还没有 serverId 时显示 */
const useUploadState = (file: FileAttachment) =>
  useUploads((state) => {
    if (file.serverId) {
      return null
    }
    const task = state.tasks[file.id]
    return task?.status === 'uploading' || task?.status === 'error' ? task : null
  })

/**
 * 消息里的附件：
 * - 图片：纯图片显示 120×120 缩略图，与文件混排时为 64×64；上传中显示 loading 蒙层，
 *   上传失败显示品牌色描边 + 中心重试图标（可重试）或 photo-error 图标（不可重试）。
 * - 文件：显示文件卡片。
 */
export const MessageFile = ({
  file,
  onRetry,
}: {
  file: FileAttachment
  /** 本条消息补传失败且可重试时提供 */
  onRetry: (() => void) | null
}) => {
  const t = useTranslate()
  const url = useFileUrl(file)
  const [viewing, setViewing] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const upload = useUploadState(file)
  const uploading = upload?.status === 'uploading'
  const failed = upload?.status === 'error'
  const retryable = failed && upload.retryable
  const errorText = failed ? t(upload.error.key, upload.error.params) : undefined

  const retry = retryable ? onRetry : null

  if (file.isImage && url !== null) {
    const preview = url ? (
      failedUrl === url ? (
        <span className={styles.failedIcon} role="img" aria-label={file.name}>
          <IconPhotoErrorFill20 />
        </span>
      ) : (
        <img src={url} alt={file.name} onError={() => setFailedUrl(url)} />
      )
    ) : null

    // 上传中：本地原件已在 IndexedDB，先垫在蒙层下显示，避免只有一块灰色占位
    if (uploading) {
      return (
        <div className={clsx(styles.image, styles.imageThumb)} title={file.name}>
          {preview}
          <div className={styles.overlay}>
            <span className={styles.spinner} />
          </div>
        </div>
      )
    }

    // 「上传失败」只显示状态，其余原因写在图片底部的渐变上
    const reason =
      errorText && errorText !== t('uploadFileStatusFailed') ? (
        <span className={styles.reason}>{errorText}</span>
      ) : null

    // 上传失败不可重试：保留缩略图，底部渐变显示原因
    if (failed && !retry) {
      return (
        <div
          className={clsx(styles.image, styles.imageThumb)}
          title={errorText}
          aria-label={errorText}
        >
          {preview ?? (
            <span className={styles.failedIcon}>
              <IconPhotoErrorFill20 />
            </span>
          )}
          {reason}
        </div>
      )
    }

    // 上传失败可重试：缩略图 + 红色描边 + 蒙层重试图标，原因在底部
    if (failed && retry) {
      const retryLabel = t('uploadRetry', { message: errorText ?? t('uploadFileStatusFailed') })
      return (
        <Tooltip content={retryLabel}>
          <button
            type="button"
            className={clsx(styles.image, styles.imageThumb, styles.retryImage)}
            aria-label={retryLabel}
            onClick={retry}
          >
            {preview}
            <div className={clsx(styles.overlay, styles.retryOverlay)}>
              <IconRefreshOutline16 />
            </div>
            {reason}
          </button>
        </Tooltip>
      )
    }

    // 正常态：显示缩略图，点开才加载原图
    return url ? (
      <>
        <button
          type="button"
          className={clsx(styles.image, styles.imageThumb)}
          title={file.name}
          onClick={() => setViewing(true)}
        >
          {preview}
        </button>
        {viewing ? <ImageViewer file={file} onClose={() => setViewing(false)} /> : null}
      </>
    ) : (
      // 原件还没加载出来（极短暂）
      <div className={styles.image} />
    )
  }

  return (
    <FileCard
      name={file.name}
      size={file.size}
      status={uploading ? 'uploading' : failed ? 'error' : 'done'}
      error={errorText}
      onRetry={retry ?? undefined}
      onOpen={url && !upload ? () => window.open(url, '_blank', 'noreferrer') : undefined}
    />
  )
}
