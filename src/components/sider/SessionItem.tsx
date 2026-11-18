import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import {
  IconArchiveOutline16,
  IconDownloadOutline16,
  IconPinOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import {
  archiveSession,
  pinSession,
  renameSession,
  selectSession,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  groupName,
  onDelete,
  onExport,
  onMove,
  onSaveStyle,
}: {
  session: SessionSummary
  active: boolean
  groupName?: string
  onDelete: () => void
  onExport: (format: 'md' | 'html') => void
  onMove: () => void
  onSaveStyle: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>
        {session.pinned ? (
          <span className={styles.pinMark} aria-label={t('sessionItemMenuUnpinOption')}>
            <IconPinOutline16 />
          </span>
        ) : null}
        <span className={styles.titleText}>{displayTitle}</span>
        {groupName ? <span className={styles.groupTag}>{groupName}</span> : null}
      </div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'group',
              label: t('collectionsMoveTo'),
              icon: <IconSettingsOutline16 />,
              onSelect: onMove,
            },
            {
              key: 'style',
              label: t('collectionsSaveStyle'),
              icon: <IconEditOutline16 />,
              onSelect: onSaveStyle,
            },
            {
              key: 'pin',
              label: session.pinned
                ? t('sessionItemMenuUnpinOption')
                : t('sessionItemMenuPinOption'),
              icon: <IconPinOutline16 />,
              onSelect: () => pinSession(session.id, !session.pinned),
            },
            {
              key: 'archive',
              label: session.archivedAt
                ? t('sessionItemMenuUnarchiveOption')
                : t('sessionItemMenuArchiveOption'),
              icon: <IconArchiveOutline16 />,
              onSelect: () => archiveSession(session.id, !session.archivedAt),
            },
            {
              key: 'export-html',
              label: t('sessionItemMenuExportHtml'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => onExport('html'),
            },
            {
              key: 'export-md',
              label: t('sessionItemMenuExportMarkdown'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => onExport('md'),
            },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
