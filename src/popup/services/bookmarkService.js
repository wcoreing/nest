function getTree() {
  return new Promise((resolve) => chrome.bookmarks.getTree(resolve))
}

function create(payload) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(payload, (node) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(node)
    })
  })
}

function move(id, destination) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.move(id, destination, (node) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(node)
    })
  })
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString()
  } catch {
    return url || ''
  }
}

function pickDefaultRootId(rootFolders) {
  const byId = rootFolders.find((item) => item.id === '1')
  if (byId) return byId.id
  const byName = rootFolders.find((item) => /书签栏|bookmarks bar|favorites bar/i.test(item.title))
  if (byName) return byName.id
  return rootFolders[0]?.id || null
}

// Chrome 根目录 ID 到名称的映射
const rootFolderNames = {
  '0': '书签分类',
  '1': '书签栏',
  '2': '移动书签',
}

// 获取节点的显示名称
function getNodeLabel(node) {
  if (node.title) return node.title

  // 如果是根目录，使用默认名称
  if (node.id in rootFolderNames) {
    return rootFolderNames[node.id]
  }

  // 如果是书签且有 URL，使用 URL
  if (node.url) return node.url

  // 其他情况使用通用名称
  return '未命名'
}

function walk(nodes, folderPath, treeRows, bookmarkRows) {
  for (const node of nodes || []) {
    const isFolder = !node.url
    const label = getNodeLabel(node)
    const currentPath = isFolder ? [...folderPath, label] : folderPath
    const treeNode = {
      id: node.id,
      label,
      isFolder,
      url: node.url || '',
      children: [],
    }
    treeRows.push(treeNode)

    if (isFolder) {
      walk(node.children || [], currentPath, treeNode.children, bookmarkRows)
    } else {
      bookmarkRows.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title || node.url || '(无标题)',
        url: normalizeUrl(node.url || ''),
        path: folderPath.join(' / '),
        groupId: null,
        ai: null,
      })
    }
  }
}

export async function loadBookmarks() {
  const tree = await getTree()
  const rootFolders = (tree?.[0]?.children || [])
    .filter((item) => !item.url)
    .map((item) => ({ id: item.id, title: getNodeLabel(item) }))
  const treeData = []
  const bookmarks = []
  walk(tree, [], treeData, bookmarks)
  return {
    treeData,
    bookmarks,
    rootFolders,
    defaultRootId: pickDefaultRootId(rootFolders),
  }
}

// 获取根目录下的所有文件夹（不删除）
async function getAllFoldersInRoot(targetRootId) {
  const folders = []

  try {
    const children = await new Promise((resolve) => chrome.bookmarks.getChildren(targetRootId, resolve))

    for (const child of children || []) {
      if (!child.url) {
        // 这是一个文件夹
        folders.push({
          id: child.id,
          title: child.title,
        })
      }
    }
  } catch (error) {
    console.warn('获取文件夹列表时出错:', error.message)
  }

  return folders
}

// 递归删除空文件夹（书签已经被移走）
async function deleteEmptyFolderRecursive(folderId) {
  try {
    const children = await new Promise((resolve) => chrome.bookmarks.getChildren(folderId, resolve))

    // 如果还有子项，先递归处理
    for (const child of children || []) {
      if (!child.url) {
        // 如果是子文件夹，递归删除
        await deleteEmptyFolderRecursive(child.id)
      } else {
        // 如果还有书签，先移到根目录（安全保护）
        try {
          await move(child.id, { parentId: folderId.split('-')[0] || '1' })
        } catch (error) {
          console.warn(`移动书签 ${child.id} 到根目录失败:`, error.message)
        }
      }
    }

    // 删除文件夹本身
    await new Promise((resolve) => chrome.bookmarks.remove(folderId, resolve))
  } catch (error) {
    console.warn('删除文件夹时出错:', error.message)
  }
}

export async function applyBookmarkGroups(groups, bookmarks, options = {}) {
  try {
    const targetRootId = options.targetRootId || '1'
    const previousFolderIds = options.previousFolderIds || []
    const isFolderAnalysis = options.isFolderAnalysis || false

    console.log('[applyBookmarkGroups] 开始应用分组', {
      targetRootId,
      groupsCount: groups.length,
      bookmarksCount: bookmarks.length,
      previousFolderIdsCount: previousFolderIds.length,
      isFolderAnalysis,
    })

    // 步骤 1: 提前记录要清理的旧文件夹（必须在创建新文件夹之前）
    // 如果是对"待分类"目录分析，不清理目标目录（书签会被移走，目录保留）
    const isPendingFolder = options.isPendingFolder || false
    const existingFolders = isPendingFolder ? [] : await getAllFoldersInRoot(targetRootId)
    const oldFolderIds = existingFolders.map(f => f.id)

    // 步骤 2: 创建新的分组文件夹
    const createdFolders = []

    for (const group of groups) {
      const itemIds = bookmarks.filter((item) => item.groupId === group.id).map((item) => item.id)
      if (!itemIds.length) continue

      // isPendingFolder 模式下："待分类"分组的书签留在原目录，不创建新的待分类目录
      if (isPendingFolder && group.name === '待分类') {
        console.log('[applyBookmarkGroups] 跳过待分类分组，书签留在原目录')
        continue
      }

      // 其他情况：正常创建分组文件夹
      const folderParentId = group.name === '待分类' ? '2' : targetRootId

      const folder = await create({
        parentId: folderParentId,
        title: group.name.slice(0, 35),
      })

      createdFolders.push({
        id: folder.id,
        title: folder.title,
        groupId: group.id,
        groupName: group.name,
      })

      // 移动书签到新创建的分组文件夹
      for (const bookmarkId of itemIds) {
        try {
          await move(bookmarkId, { parentId: folder.id })
        } catch (error) {
          console.warn(`移动书签 ${bookmarkId} 失败:`, error.message)
        }
      }
    }

    console.log('[applyBookmarkGroups] 创建和移动完成', { createdCount: createdFolders.length })

    // 步骤 3: 删除所有旧的文件夹（此时书签已经移到新分组，文件夹应该是空的）
    let deletedCount = 0
    for (const oldFolderId of oldFolderIds) {
      try {
        // 先递归删除空文件夹（书签已经被移走）
        await deleteEmptyFolderRecursive(oldFolderId)
        deletedCount++
      } catch (error) {
        console.warn(`删除旧文件夹 ${oldFolderId} 失败:`, error.message)
      }
    }

    console.log('[applyBookmarkGroups] 删除旧文件夹完成', { deletedCount })

    // 返回创建的文件夹信息
    return {
      createdFolderIds: createdFolders.map(f => f.id),
      createdFolders: createdFolders,
      clearedCount: deletedCount,
      timestamp: Date.now(),
    }
  } catch (error) {
    console.error('[applyBookmarkGroups] 应用分组失败:', error)
    throw error
  }
}

export async function restoreOriginalBookmarkParents(parentMap) {
  const pairs = Object.entries(parentMap || {})
  for (const [bookmarkId, parentId] of pairs) {
    try {
      await move(bookmarkId, { parentId })
    } catch {
      // 忽略被删除或不可移动的书签
    }
  }
}

// 删除单个书签或文件夹（如果是文件夹，只删除文件夹本身，不删除子项）
export async function removeBookmark(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(id, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve()
    })
  })
}

// 递归删除文件夹及其所有子项
export async function removeFolderRecursive(folderId) {
  try {
    // 先获取所有子项
    const children = await new Promise((resolve) => chrome.bookmarks.getChildren(folderId, resolve))

    // 递归删除所有子项
    for (const child of children || []) {
      if (child.url) {
        // 如果是书签，直接删除
        await new Promise((resolve) => chrome.bookmarks.remove(child.id, resolve))
      } else {
        // 如果是文件夹，递归删除
        await removeFolderRecursive(child.id)
      }
    }

    // 最后删除文件夹本身
    await new Promise((resolve) => chrome.bookmarks.remove(folderId, resolve))
  } catch (error) {
    console.error(`递归删除文件夹 ${folderId} 失败:`, error)
    throw error
  }
}
