const STORAGE_KEY = 'nestBookmarkSnapshots'
const MAX_AUTO_SNAPSHOTS = 10  // 系统自动保存最多10个
const MAX_MANUAL_SNAPSHOTS = 20 // 手动保存最多20个

/**
 * 获取当前完整书签树快照
 * @param {string} label - 版本名称
 * @param {'manual'|'auto'} type - 手动或自动
 */
export async function captureSnapshot(label = '', type = 'auto') {
  const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve))
  const snapshot = {
    id: `snap-${Date.now()}`,
    label: label || `版本 ${new Date().toLocaleString()}`,
    type, // 'manual' | 'auto'
    createdAt: Date.now(),
    tree: tree[0],
  }

  const saved = await loadSnapshots()
  const manuals = saved.filter(s => s.type === 'manual')
  const autos = saved.filter(s => s.type !== 'manual')

  let updated
  if (type === 'manual') {
    // 手动保存：只限制手动保存的数量，不影响自动保存
    updated = [snapshot, ...manuals].slice(0, MAX_MANUAL_SNAPSHOTS).concat(autos)
  } else {
    // 自动保存：只清理自动保存，手动保存完全不受影响
    updated = manuals.concat([snapshot, ...autos].slice(0, MAX_AUTO_SNAPSHOTS))
  }

  await new Promise(resolve => chrome.storage.local.set({ [STORAGE_KEY]: updated }, resolve))
  return snapshot
}

/**
 * 加载所有快照（不含 tree 数据，只含元信息，减少内存占用）
 */
export async function loadSnapshots() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [])
    })
  })
}

/**
 * 加载单个快照的完整数据
 */
export async function loadSnapshot(id) {
  const all = await loadSnapshots()
  return all.find(s => s.id === id) || null
}

/**
 * 删除快照（手动和自动都可以手动删除，但自动清除只清除系统保存）
 */
export async function deleteSnapshot(id) {
  const all = await loadSnapshots()
  const updated = all.filter(s => s.id !== id)
  await new Promise(resolve => chrome.storage.local.set({ [STORAGE_KEY]: updated }, resolve))
}

/**
 * 恢复快照：清空当前书签树，重建快照中的结构
 */
export async function restoreSnapshot(snapshot) {
  // 先保存当前状态作为恢复前的快照
  await captureSnapshot('恢复前自动保存', 'auto')

  // 获取当前书签树根节点的子节点
  const currentTree = await new Promise(resolve => chrome.bookmarks.getTree(resolve))
  const root = currentTree[0]

  // 清空书签栏（id=1）和其他书签（id=2）下的所有内容
  for (const rootChild of root.children || []) {
    if (rootChild.id === '0') continue // 跳过根节点本身
    const children = await new Promise(resolve => chrome.bookmarks.getChildren(rootChild.id, resolve))
    for (const child of children || []) {
      await removeNodeRecursive(child.id, !child.url)
    }
  }

  // 重建快照中的书签树
  for (const rootChild of snapshot.tree.children || []) {
    if (rootChild.id === '0') continue
    const targetParentId = rootChild.id // 书签栏=1，其他书签=2
    await rebuildTree(rootChild.children || [], targetParentId)
  }
}

async function removeNodeRecursive(id, isFolder) {
  try {
    if (isFolder) {
      await new Promise(resolve => chrome.bookmarks.removeTree(id, resolve))
    } else {
      await new Promise(resolve => chrome.bookmarks.remove(id, resolve))
    }
  } catch {
    // 忽略已删除的节点
  }
}

async function rebuildTree(nodes, parentId) {
  for (const node of nodes || []) {
    if (node.url) {
      // 书签
      await new Promise(resolve => chrome.bookmarks.create({
        parentId,
        title: node.title || '',
        url: node.url,
      }, resolve))
    } else {
      // 文件夹
      const folder = await new Promise(resolve => chrome.bookmarks.create({
        parentId,
        title: node.title || '未命名',
      }, resolve))
      await rebuildTree(node.children || [], folder.id)
    }
  }
}
