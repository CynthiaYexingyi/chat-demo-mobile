import { create } from 'zustand'

/**
 * 「开启新对话」弹窗：侧边栏、收起态、移动端顶栏三个入口共用。
 * 打开后先让用户选分组，选完才真正 newChat(collectionId)。
 */
export const useNewChatDialog = create(() => ({
  open: false,
}))

export const openNewChatDialog = () => useNewChatDialog.setState({ open: true })

export const closeNewChatDialog = () => useNewChatDialog.setState({ open: false })
