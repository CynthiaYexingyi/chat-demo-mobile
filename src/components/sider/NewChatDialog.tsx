import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { createCollection, newChat, useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './Sider.module.css'
import { closeNewChatDialog, useNewChatDialog } from './newChatDialogState.js'

/**
 * 开启新对话前先选分组：不分组 / 现有分组 / 现场新建。
 * 选完把分组 id 交给 newChat，写入待建会话。
 */
export const NewChatDialog = () => {
  const open = useNewChatDialog((state) => state.open)
  const collections = useChatStore((state) => state.collections)
  const t = useTranslate()
  const [newName, setNewName] = useState('')

  if (!open) {
    return null
  }

  const close = () => {
    setNewName('')
    closeNewChatDialog()
  }

  const create = (collectionId: string | null) => {
    newChat(collectionId)
    close()
  }

  const submitNew = () => {
    const clean = newName.trim()
    if (!clean) {
      return
    }
    const existing = collections.find((collection) => collection.name === clean)
    const created = existing ?? createCollection(clean)
    if (created) {
      create(created.id)
    }
  }

  return (
    <Modal title={t('newChatDialogTitle')} closable onClose={close}>
      <div className={styles.groupHint}>{t('newChatDialogHint')}</div>
      <div className={styles.groupOptions}>
        <button type="button" className={styles.groupOption} onClick={() => create(null)}>
          {t('collectionsUngrouped')}
        </button>
        {collections.map((collection) => (
          <button
            key={collection.id}
            type="button"
            className={styles.groupOption}
            onClick={() => create(collection.id)}
          >
            {collection.name}
          </button>
        ))}
      </div>
      {collections.length > 0 ? <div className={styles.styleHint}>{t('newChatDialogOr')}</div> : null}
      <div className={styles.groupNewRow}>
        <input
          className={styles.groupInput}
          value={newName}
          placeholder={t('collectionsNamePlaceholder')}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              submitNew()
            }
          }}
        />
        <Button size="s" disabled={!newName.trim()} onClick={submitNew}>
          {t('collectionsCreate')}
        </Button>
      </div>
    </Modal>
  )
}
