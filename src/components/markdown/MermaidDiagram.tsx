import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useState } from 'react'
import { useTheme } from '../../app/theme.js'
import { renderMermaid } from '../../services/markdown/mermaid.js'

/**
 * 流式阶段不绘制：mermaid 每画一次都要解析全文并重排布局，手机上会明显掉帧，
 * 而流式内容几乎每 100ms 就变一次。改为回答结束后画一次，图只出现一次、不再跳动。
 */
export const MermaidDiagram = memo(function MermaidDiagram({
  code,
  loading,
}: {
  code: string
  loading: boolean
}) {
  const t = useTranslate()
  const dark = useTheme() === 'dark'
  const [result, setResult] = useState({ svg: '', failedCode: null as string | null })
  /** 加载完成后才绘制，加载中保持 null */
  const finalCode = loading ? null : code

  useEffect(() => {
    if (finalCode === null) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const svg = await renderMermaid(finalCode, dark, () => cancelled)
        if (!cancelled) {
          setResult(svg ? { svg, failedCode: null } : { svg: '', failedCode: finalCode })
        }
      } catch {
        if (!cancelled) {
          setResult({ svg: '', failedCode: finalCode })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dark, finalCode])

  if (!code.trim() || !result.svg) {
    return (
      <div className="md-mermaid-status" role="status">
        {!loading && !code.trim()
          ? t('mermaidEmpty')
          : !loading && result.failedCode === code
            ? t('mermaidRenderFail')
            : t('mermaidLoading')}
      </div>
    )
  }

  return <div className="md-mermaid-diagram" dangerouslySetInnerHTML={{ __html: result.svg }} />
})
