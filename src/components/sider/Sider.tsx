import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconArchiveOutline16,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { daysSinceExport } from '../../services/chat/backup.js'
import { searchSessions, type SearchHit } from '../../services/chat/search.js'
import {
  createCollection,
  deleteCollection,
  getCachedSession,
  jumpToMessage,
  getStyleRoundOptions,
  MAX_STYLE_ROUNDS,
  moveSessionToCollection,
  removeSession,
  renameCollection,
  saveStyleAsGroupTemplate,
  useChatStore,
} from '../../services/chat/store.js'
import type { StyleRoundOption } from '../../services/chat/store.js'
import * as db from '../../services/chat/db.js'
import { downloadSession } from '../../services/chat/exportSession.js'
import type { ChatCollection } from '../../services/chat/collections.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { openNewChatDialog } from './newChatDialogState.js'
import styles from './Sider.module.css'

/** 超过这个天数没有导出就提醒备份 */
const BACKUP_REMINDER_DAYS = 7
/** 输入停顿多久后才真正开始全文搜索 */
const SEARCH_DEBOUNCE_MS = 280
/** 分组展开/收起状态：只记被收起的组，刷新后保持 */
const COLLAPSED_KEY = 'deepseek-mine-collapsed-groups-v1'

type ListSection = {
  key: string
  label: string
  sessions: SessionSummary[]
}

const loadCollapsed = (): Record<string, boolean> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** 展开的侧边栏：名称与收起按钮、开启新对话、全文搜索、按分组排列的会话列表、底部设置 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const collections = useChatStore((state) => state.collections)
  const activeId = useChatStore((state) => state.activeId)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [managing, setManaging] = useState(false)
  const [moving, setMoving] = useState<SessionSummary | null>(null)
  const [moveName, setMoveName] = useState('')
  const [removingGroup, setRemovingGroup] = useState<ChatCollection | null>(null)
  /** 挑选风格范例：正在挑的对话、候选轮次、已勾选的轮次下标 */
  const [styleSession, setStyleSession] = useState<SessionSummary | null>(null)
  const [styleRounds, setStyleRounds] = useState<StyleRoundOption[]>([])
  const [pickedRounds, setPickedRounds] = useState<number[]>([])
  /** 归档的会话不进主列表，单独一页看 */
  const [showArchived, setShowArchived] = useState(false)
  const archivedCount = useMemo(
    () => sessions.filter((session) => session.archivedAt).length,
    [sessions]
  )
  const listed = useMemo(
    () => sessions.filter((session) => (showArchived ? Boolean(session.archivedAt) : !session.archivedAt)),
    [sessions, showArchived]
  )
  /** 按分组排列：置顶 → 各组 → 未分组；空组也保留，方便往里放对话 */
  const sections = useMemo<ListSection[]>(() => {
    const result: ListSection[] = []
    const pinned = listed.filter((session) => session.pinned)
    if (pinned.length > 0) {
      result.push({ key: 'pinned', label: t('pinnedSessions'), sessions: pinned })
    }
    const known = new Set(collections.map((collection) => collection.id))
    for (const collection of collections) {
      result.push({
        key: collection.id,
        label: collection.name,
        sessions: listed.filter(
          (session) => !session.pinned && session.collectionId === collection.id
        ),
      })
    }
    result.push({
      key: 'ungrouped',
      label: t('collectionsUngrouped'),
      sessions: listed.filter(
        (session) =>
          !session.pinned &&
          (!session.collectionId || !known.has(session.collectionId))
      ),
    })
    return result
  }, [listed, collections, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const setSectionCollapsed = (key: string, value: boolean) => {
    setCollapsed((previous) => {
      const next: Record<string, boolean> = value
        ? { ...previous, [key]: true }
        : Object.fromEntries(Object.entries(previous).filter(([item]) => item !== key))
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // 隐私模式下存不住，只影响本次刷新后的展开状态。
      }
      return next
    })
  }

  /** 新建分组；带 sessionId 时顺手把这条对话放进去 */
  const addCollection = (name: string, sessionId?: string): ChatCollection | null => {
    const clean = name.trim()
    if (!clean) {
      showToast({ key: 'collectionsNameRequired', type: 'error' })
      return null
    }
    if (collections.some((collection) => collection.name === clean)) {
      showToast({ key: 'collectionsNameDuplicate', type: 'error' })
      return null
    }
    const created = createCollection(clean)
    if (!created) {
      showToast({ key: 'collectionsNameRequired', type: 'error' })
      return null
    }
    if (sessionId) {
      moveSessionToCollection(sessionId, created.id)
    }
    setSectionCollapsed(created.id, false)
    showToast({ key: 'collectionsCreated', params: { name: created.name } })
    return created
  }

  const submitCreating = () => {
    const created = addCollection(newName, activeId ?? undefined)
    if (created) {
      setCreating(false)
      setNewName('')
    }
  }

  const submitMoveNew = () => {
    if (!moving) {
      return
    }
    const created = addCollection(moveName, moving.id)
    if (created) {
      setMoving(null)
      setMoveName('')
    }
  }

  /** 打开「挑选风格范例」：先确认已分组，再读出对话里的轮次，默认勾选最后几轮 */
  const openStylePicker = (session: SessionSummary) => {
    if (!session.collectionId) {
      showToast({ key: 'collectionsStyleNeedGroup', type: 'error' })
      return
    }
    const rounds = getStyleRoundOptions(session.id)
    if (rounds.length === 0) {
      showToast({ key: 'collectionsStyleEmpty', type: 'error' })
      return
    }
    // 默认选最后几轮：对话越往后解释风格通常越稳定
    setPickedRounds(rounds.slice(-MAX_STYLE_ROUNDS).map((round) => round.index))
    setStyleRounds(rounds)
    setStyleSession(session)
  }

  const togglePickedRound = (index: number) => {
    setPickedRounds((previous) => {
      if (previous.includes(index)) {
        return previous.filter((item) => item !== index)
      }
      if (previous.length >= MAX_STYLE_ROUNDS) {
        showToast({ key: 'collectionsStyleMax', params: { count: MAX_STYLE_ROUNDS }, type: 'error' })
        return previous
      }
      return [...previous, index]
    })
  }

  // 搜索状态
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const abortRef = useRef<AbortController | null>(null)

  // 备份提醒只在挂载时算一次，避免每次渲染都读 localStorage
  const [exportDays] = useState<number | null>(() => daysSinceExport())
  const needBackup = exportDays === null || exportDays >= BACKUP_REMINDER_DAYS

  useEffect(() => {
    const keyword = query.trim()
    abortRef.current?.abort()
    if (!keyword) {
      setHits([])
      setSearching(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true)
    setProgress({ done: 0, total: sessions.length })

    const timer = setTimeout(() => {
      searchSessions(sessions, keyword, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (!controller.signal.aborted) {
            setProgress({ done, total })
          }
        },
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setHits(result)
            setSearching(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearching(false)
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, sessions])

  const searchingMode = query.trim().length > 0

  /** 导出单条会话：已加载就用缓存，没打开过则直接读库 */
  const exportSession = async (summary: SessionSummary, format: 'md' | 'html') => {
    try {
      const session = getCachedSession(summary.id) ?? (await db.loadSession(summary.id))
      if (!session) {
        showToast({ key: 'sessionLoadFailed', type: 'error' })
        return
      }
      await downloadSession(session, format)
    } catch {
      showToast({ key: 'sessionLoadFailed', type: 'error' })
    }
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          openNewChatDialog()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>

      <div className={styles.searchBox}>
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={t('searchClear')}
            onClick={() => setQuery('')}
          >
            ✕
          </button>
        ) : null}
      </div>

      {!searchingMode ? (
        <div className={styles.collectionBar}>
          <span className={styles.collectionBarLabel}>{t('collectionsSectionLabel')}</span>
          <span className={styles.collectionBarSpacer} />
          <button
            type="button"
            className={styles.collectionIconButton}
            aria-label={t('collectionsNew')}
            title={t('collectionsNew')}
            onClick={() => {
              setNewName('')
              setCreating(true)
            }}
          >
            ＋
          </button>
          <button
            type="button"
            className={styles.collectionIconButton}
            aria-label={t('collectionsManage')}
            title={t('collectionsManage')}
            onClick={() => setManaging(true)}
          >
            <IconSettingsOutline16 />
          </button>
        </div>
      ) : null}

      {needBackup && !searchingMode ? (
        <button
          type="button"
          className={styles.backupBanner}
          onClick={() => {
            openSettings('data')
            closeMobileSider()
          }}
        >
          {exportDays === null ? t('backupNever') : t('backupStale', { days: exportDays })}
        </button>
      ) : null}

      <div className={styles.listWrap}>
        <div className={styles.list}>
          {searchingMode ? (
            <>
              <div className={styles.searchMeta}>
                {searching
                  ? t('searchProgress', { done: progress.done, total: progress.total })
                  : hits.length
                    ? t('searchResultCount', { count: hits.length })
                    : t('searchEmpty')}
              </div>
              {hits.map((hit) => (
                <div
                  key={hit.sessionId}
                  className={styles.hit}
                  onClick={() => {
                    jumpToMessage(hit.sessionId, hit.messageId)
                    closeMobileSider()
                  }}
                >
                  <div className={styles.hitTitle}>
                    <span>{hit.title}</span>
                    <span className={styles.hitCount}>
                      {t('searchHitCount', { count: hit.matches })}
                    </span>
                  </div>
                  {hit.snippet && !hit.fromTitle ? (
                    <div className={styles.hitSnippet}>{hit.snippet}</div>
                  ) : null}
                </div>
              ))}
            </>
          ) : (
            sections.map((section) => (
              <div key={section.key} className={styles.section}>
                <button
                  type="button"
                  className={styles.sectionToggle}
                  aria-expanded={!collapsed[section.key]}
                  onClick={() => setSectionCollapsed(section.key, !collapsed[section.key])}
                >
                  <span
                    className={clsx(
                      styles.chevron,
                      !collapsed[section.key] && styles.chevronOpen
                    )}
                  >
                    ▸
                  </span>
                  <span className={styles.sectionLabel}>{section.label}</span>
                  <span className={styles.sectionCount}>{section.sessions.length}</span>
                </button>
                {collapsed[section.key] ? null : section.sessions.length === 0 ? (
                  <div className={styles.sectionEmpty}>{t('collectionsNoChats')}</div>
                ) : (
                  section.sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeId}
                      onDelete={() => setDeleting(session)}
                      onExport={(format) => void exportSession(session, format)}
                      onMove={() => {
                        setMoveName('')
                        setMoving(session)
                      }}
                      onSaveStyle={() => openStylePicker(session)}
                    />
                  ))
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        {archivedCount > 0 || showArchived ? (
          <button
            type="button"
            className={clsx(styles.settings, showArchived && styles.settingsActive)}
            onClick={() => {
              setShowArchived((value) => !value)
              setQuery('')
            }}
          >
            <span className={styles.settingsIcon}>
              <IconArchiveOutline16 />
            </span>
            <span className={styles.settingsLabel}>
              {showArchived
                ? t('backToSessions')
                : t('archivedSessions', { count: archivedCount })}
            </span>
          </button>
        ) : null}
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}

      {creating ? (
        <Modal
          title={t('collectionsNew')}
          closable
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setCreating(false)}>
                {t('collectionsCancel')}
              </Button>
              <Button disabled={!newName.trim()} onClick={submitCreating}>
                {t('collectionsCreate')}
              </Button>
            </>
          }
        >
          <input
            className={styles.groupInput}
            autoFocus
            value={newName}
            placeholder={t('collectionsNamePlaceholder')}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                submitCreating()
              }
            }}
          />
          {activeId ? <div className={styles.groupHint}>{t('collectionsMoveHint')}</div> : null}
        </Modal>
      ) : null}

      {moving ? (
        <Modal
          title={t('collectionsMoveTitle')}
          closable
          onClose={() => setMoving(null)}
        >
          <div className={styles.groupHint}>{t('collectionsMoveHint')}</div>
          <div className={styles.groupOptions}>
            <button
              type="button"
              className={clsx(styles.groupOption, !moving.collectionId && styles.groupOptionActive)}
              onClick={() => {
                moveSessionToCollection(moving.id, null)
                showToast({ key: 'collectionsRemoved' })
                setMoving(null)
              }}
            >
              {t('collectionsUngrouped')}
            </button>
            {collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={clsx(
                  styles.groupOption,
                  moving.collectionId === collection.id && styles.groupOptionActive
                )}
                onClick={() => {
                  moveSessionToCollection(moving.id, collection.id)
                  showToast({ key: 'collectionsMoved' })
                  setMoving(null)
                }}
              >
                {collection.name}
              </button>
            ))}
          </div>
          <div className={styles.groupNewRow}>
            <input
              className={styles.groupInput}
              value={moveName}
              placeholder={t('collectionsNamePlaceholder')}
              onChange={(event) => setMoveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  submitMoveNew()
                }
              }}
            />
            <Button size="s" disabled={!moveName.trim()} onClick={submitMoveNew}>
              {t('collectionsCreate')}
            </Button>
          </div>
        </Modal>
      ) : null}

      {managing ? (
        <Modal title={t('collectionsManage')} closable onClose={() => setManaging(false)}>
          {collections.length === 0 ? (
            <div className={styles.groupHint}>{t('collectionsEmptyHint')}</div>
          ) : (
            collections.map((collection) => (
              <div key={collection.id} className={styles.manageRow}>
                <input
                  className={styles.groupInput}
                  defaultValue={collection.name}
                  aria-label={t('collectionsRename')}
                  onBlur={(event) => {
                    const changed = event.target.value.trim() !== collection.name
                    if (!renameCollection(collection.id, event.target.value)) {
                      event.target.value = collection.name
                      showToast({ key: 'collectionsNameRequired', type: 'error' })
                    } else if (changed) {
                      showToast({ key: 'collectionsRenamed' })
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.currentTarget.blur()
                    }
                  }}
                />
                <Button
                  size="s"
                  variant="dangerOutlined"
                  onClick={() => setRemovingGroup(collection)}
                >
                  {t('collectionsDelete')}
                </Button>
              </div>
            ))
          )}
        </Modal>
      ) : null}

      {removingGroup ? (
        <Modal
          title={t('collectionsDelete')}
          onClose={() => setRemovingGroup(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setRemovingGroup(null)}>
                {t('collectionsCancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteCollection(removingGroup.id)
                  showToast({ key: 'collectionsDeleted' })
                  setRemovingGroup(null)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('collectionsDeleteConfirm', { name: removingGroup.name })}
        </Modal>
      ) : null}

      {styleSession ? (
        <Modal
          title={t('collectionsStylePickTitle')}
          closable
          onClose={() => setStyleSession(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setStyleSession(null)}>
                {t('collectionsCancel')}
              </Button>
              <Button
                disabled={pickedRounds.length === 0}
                onClick={() => {
                  const saved = saveStyleAsGroupTemplate(styleSession.id, pickedRounds)
                  showToast({
                    key: saved ? 'collectionsStyleSaved' : 'collectionsStyleEmpty',
                    type: saved ? undefined : 'error',
                  })
                  if (saved) {
                    setStyleSession(null)
                  }
                }}
              >
                {t('collectionsStyleSave', { count: pickedRounds.length })}
              </Button>
            </>
          }
        >
          <div className={styles.styleHint}>{t('collectionsStylePickHint')}</div>
          <div className={styles.styleRounds}>
            {styleRounds.map((round, position) => {
              const picked = pickedRounds.includes(round.index)
              return (
                <button
                  key={round.index}
                  type="button"
                  className={clsx(
                    styles.styleRound,
                    picked && styles.styleRoundPicked
                  )}
                  onClick={() => togglePickedRound(round.index)}
                >
                  <div className={styles.styleRoundHead}>
                    <span className={styles.styleRoundCheck}>{picked ? '✓' : ''}</span>
                    <span className={styles.styleRoundIndex}>#{position + 1}</span>
                  </div>
                  <div className={styles.styleRoundText}>
                    <div className={styles.styleRoundQ}>{round.question}</div>
                    <div className={styles.styleRoundA}>{round.answer}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
