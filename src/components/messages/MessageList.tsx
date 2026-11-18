import clsx from 'clsx'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { clearSearchAnchor, selectMessageVersion, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 一次最多渲染多少条消息；超长会话只渲染一段，点按钮再往前翻 */
const WINDOW_STEP = 80
/** 从搜索结果跳转时，命中消息上方保留多少条作为上下文 */
const ANCHOR_CONTEXT = 6
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  /**
   * 只渲染一段消息：几千条消息全部铺进 DOM 会让手机直接卡死或闪退。
   * start 为 null 表示跟随末尾（正常进入会话）；从搜索结果跳进来时锚定到命中位置，
   * 用上下的按钮继续翻。窗口按会话区分，切换会话时回到初始状态。
   */
  const [windowState, setWindowState] = useState<{
    sessionId: string
    size: number
    start: number | null
  }>({ sessionId: session.id, size: WINDOW_STEP, start: null })
  if (windowState.sessionId !== session.id) {
    setWindowState({ sessionId: session.id, size: WINDOW_STEP, start: null })
  }
  const windowSize = windowState.sessionId === session.id ? windowState.size : WINDOW_STEP
  const total = messages.length
  const from =
    windowState.sessionId === session.id && windowState.start !== null
      ? Math.min(windowState.start, Math.max(0, total - 1))
      : Math.max(0, total - windowSize)
  const to = Math.min(total, from + windowSize)
  const hiddenBefore = from
  const hiddenAfter = Math.max(0, total - to)
  const shown = messages.slice(from, to)
  /** 展开更早消息前的滚动高度，用于展开后保持阅读位置 */
  const expandScrollRef = useRef<number | null>(null)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  /**
   * 从搜索结果点进来：把窗口定位到命中消息附近。
   * 之前只打开会话不定位，长会话里命中的那句根本不在渲染范围内。
   */
  const searchAnchor = useChatStore((state) => state.searchAnchor)
  const [hitId, setHitId] = useState<string | null>(null)
  useEffect(() => {
    if (!searchAnchor || searchAnchor.sessionId !== session.id) {
      return
    }
    const list = getVisibleMessages(session)
    if (list.length === 0) {
      return
    }
    clearSearchAnchor()
    const index = list.findIndex((message) => message.id === searchAnchor.messageId)
    if (index === -1) {
      return
    }
    stickyRef.current = false
    setHitId(searchAnchor.messageId)
    setWindowState({
      sessionId: session.id,
      size: WINDOW_STEP,
      start: Math.max(0, index - ANCHOR_CONTEXT),
    })
  }, [searchAnchor, session])

  /** 窗口切换后把命中标记滚到视野顶部；用标记定位，避免给消息再包一层容器 */
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const marker = hitId
      ? contentRef.current?.querySelector<HTMLElement>('[data-hit-marker="true"]')
      : null
    if (!scroll || !marker) {
      return
    }
    const delta = marker.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    scroll.scrollTop += delta - 12
    scrollTopRef.current = scroll.scrollTop
    stickyRef.current = false
  }, [hitId, from])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = shown.length - 1
  /** 窗口是否覆盖到最新一条；从搜索跳转时窗口停在中间，最后一条并不是回复中的那条 */
  const atTail = to === total
  const uploadRetryId = getUploadRetryId(messages, streaming)

  /**
   * 桌面端滚动条预览：鼠标移到消息区右边缘时列出当前窗口里的提问，点击直接跳过去。
   * 只列已渲染的窗口，不额外读取整库，长会话也不会卡。
   */
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineActive, setOutlineActive] = useState<string | null>(null)
  /** 面板用 fixed 定位固定在消息区右侧，跟随窗口与消息区位置，不随滚动内容跑掉 */
  const [outlinePos, setOutlinePos] = useState({ top: 52, right: 12 })
  const overOutlineRef = useRef(false)
  const outlineItems = useMemo(
    () =>
      shown
        .filter((message) => message.role === 'user')
        .slice(-24)
        .map((message) => {
          const text = (message.content ?? '').replace(/\s+/g, ' ').trim()
          return {
            id: message.id,
            label: text
              ? text.slice(0, 44)
              : message.files.length > 0
                ? t('scrollOutlineAttachment')
                : t('untitledChat'),
          }
        }),
    [shown, t]
  )
  const outlineKey = outlineItems.map((item) => item.id).join(',')
  const outlineItemsRef = useRef(outlineItems)
  outlineItemsRef.current = outlineItems

  useEffect(() => {
    if (!outlineOpen) {
      return
    }
    const el = scrollRef.current
    if (!el) {
      return
    }
    // 面板固定在消息区右边缘内侧；用视口坐标，滚动不会带走它。
    const reposition = () => {
      const rect = el.getBoundingClientRect()
      setOutlinePos({
        top: rect.top + 52,
        right: Math.max(8, window.innerWidth - rect.right + 10),
      })
    }
    const updateActive = () => {
      const top = el.getBoundingClientRect().top + 24
      let current: string | null = null
      for (const item of outlineItemsRef.current) {
        const node = contentRef.current?.querySelector<HTMLElement>(
          `[data-outline-id="${CSS.escape(item.id)}"]`
        )
        if (node && node.getBoundingClientRect().top <= top) {
          current = item.id
        }
      }
      setOutlineActive(current)
    }
    const update = () => {
      updateActive()
    }
    reposition()
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', reposition)
    }
    // outlineKey 变化代表列表内容变化；用字符串避免每次渲染都重挂监听。
  }, [outlineOpen, outlineKey])

  const jumpToOutline = (messageId: string) => {
    const el = scrollRef.current
    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-outline-id="${CSS.escape(messageId)}"]`
    )
    if (!el || !target) {
      return
    }
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
    scrollTopRef.current = el.scrollTop
    stickyRef.current = false
    setOutlineOpen(false)
  }

  /** 往前展开一段：先记住当前高度，渲染后把多出来的高度补到滚动位置上 */
  const loadEarlier = useCallback(() => {
    const el = scrollRef.current
    expandScrollRef.current = el ? el.scrollHeight : null
    setWindowState((state) =>
      state.start === null
        ? { ...state, size: state.size + WINDOW_STEP }
        : {
            ...state,
            start: Math.max(0, state.start - WINDOW_STEP),
            size: state.size + WINDOW_STEP,
          }
    )
  }, [])

  /** 从命中位置回到最新一段，恢复跟随底部 */
  const backToLatest = useCallback(() => {
    setHitId(null)
    setWindowState((state) => ({ ...state, start: null, size: WINDOW_STEP }))
    stickyRef.current = true
    requestAnimationFrame(scrollToBottom)
  }, [scrollToBottom])

  // 窗口起点变化后补偿高度（展开更早消息）；跟随底部时直接贴底。
  useLayoutEffect(() => {
    const before = expandScrollRef.current
    const el = scrollRef.current
    if (before !== null && el) {
      expandScrollRef.current = null
      stickyRef.current = false
      el.scrollTop += el.scrollHeight - before
      scrollTopRef.current = el.scrollTop
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    }
  }, [from, scrollToBottom])

  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div
        ref={isMobile ? undefined : scrollRef}
        className={styles.container}
        onMouseMove={(event) => {
          if (isMobile || outlineItems.length === 0) {
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          if (rect.right - event.clientX <= 18) {
            setOutlineOpen(true)
          } else if (!overOutlineRef.current) {
            setOutlineOpen(false)
          }
        }}
        onMouseLeave={() => {
          if (!overOutlineRef.current) {
            setOutlineOpen(false)
          }
        }}
      >
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {hiddenBefore > 0 ? (
              <button type="button" className={styles.loadEarlier} onClick={loadEarlier}>
                {t('loadEarlier', { count: hiddenBefore })}
              </button>
            ) : null}
            {shown.map((message, index) => (
              <Fragment key={message.id}>
                {message.id === hitId ? (
                  <div className={styles.hitMarker} data-hit-marker="true">
                    {t('searchHitMarker')}
                  </div>
                ) : null}
                {message.role === 'user' ? (
                  <UserMessage
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && atTail && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )}
              </Fragment>
            ))}
            {hiddenAfter > 0 ? (
              <button type="button" className={styles.loadEarlier} onClick={backToLatest}>
                {t('backToLatest')}
              </button>
            ) : null}
          </div>
        </div>
        {!isMobile && outlineOpen && outlineItems.length > 0 ? (
          <div
            className={styles.outline}
            style={{ top: outlinePos.top, right: outlinePos.right }}
            onMouseEnter={() => {
              overOutlineRef.current = true
            }}
            onMouseLeave={() => {
              overOutlineRef.current = false
              setOutlineOpen(false)
            }}
          >
            <div className={styles.outlineTitle}>{t('scrollOutlineTitle')}</div>
            {outlineItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={clsx(
                  styles.outlineItem,
                  outlineActive === item.id && styles.outlineItemActive
                )}
                onClick={() => jumpToOutline(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
