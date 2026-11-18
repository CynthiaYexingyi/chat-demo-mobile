import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { TextCitation } from '../../services/api/types.js'
import styles from './AttachmentReceipt.module.css'

/**
 * 「文件到底有没有被读」的回执。
 * 文件名来自本轮请求实际构建的 messages，引用片段来自服务端下发的 citations——
 * 两者都不发额外请求。点开就能看到送进去的是哪几个文件、模型引用了哪几段原文。
 */
export const AttachmentReceipt = memo(function AttachmentReceipt({
  names,
  citations,
}: {
  names?: string[]
  citations: TextCitation[]
}) {
  const t = useTranslate()
  if (!names || names.length === 0) {
    return null
  }
  return (
    <details className={styles.receipt}>
      <summary>
        {t('attachmentReceipt', { count: names.length })}
        {citations.length > 0 ? ` · ${t('attachmentCitations', { count: citations.length })}` : ''}
      </summary>
      <div className={styles.detail}>
        <div className={styles.section}>{t('attachmentReceiptFiles')}</div>
        {names.map((name, index) => (
          <div key={`${name}-${index}`} className={styles.file}>
            {name}
          </div>
        ))}
        {citations.length > 0 ? (
          <>
            <div className={styles.section}>{t('attachmentReceiptCited')}</div>
            {citations.slice(0, 8).map((citation, index) => (
              <blockquote key={index} className={styles.quote}>
                {(citation.cited_text || citation.title || citation.url).trim().slice(0, 160)}
              </blockquote>
            ))}
            {citations.length > 8 ? (
              <div className={styles.hint}>{t('attachmentReceiptMore', { count: citations.length - 8 })}</div>
            ) : null}
          </>
        ) : (
          <p className={styles.hint}>{t('attachmentReceiptNoCitation')}</p>
        )}
      </div>
    </details>
  )
})
