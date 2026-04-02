import {
  applyBookmarkGroups,
  loadBookmarks,
  restoreOriginalBookmarkParents,
} from '../popup/services/bookmarkService'
import { analyzeBookmarksWithAgent, reclassifyPendingBookmarks } from '../popup/services/aiAgentService'

function mockAnalyze(bookmarks) {
  const byHost = new Map()
  for (const item of bookmarks) {
    let host = '其他'
    try {
      host = new URL(item.url).host || '其他'
    } catch {
      host = '其他'
    }
    if (!byHost.has(host)) byHost.set(host, [])
    byHost.get(host).push(item.id)
  }
  return {
    groups: Array.from(byHost.entries()).map(([host, ids]) => ({
      name: `${host} 相关`,
      reason: `按域名聚合：${host}`,
      confidence: 0.75,
      attributes: { basis: 'domain', host },
      bookmarkIds: ids,
    })),
  }
}

function ok(data) {
  return { ok: true, data }
}

function fail(error) {
  return { ok: false, error: error?.message || String(error) }
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'bookmarks:getAll': {
      const payload = await loadBookmarks()
      return ok(payload)
    }
    case 'bookmarks:analyze': {
      const { config, bookmarks } = message.payload || {}
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
        return ok({ result: { groups: [] }, source: 'empty' })
      }
      try {
        if (!config?.apiKey) {
          return ok({ result: mockAnalyze(bookmarks), source: 'mock' })
        }
        const result = await analyzeBookmarksWithAgent(config, bookmarks)
        return ok({ result, source: 'agent' })
      } catch (error) {
        if (config?.useMockWhenFailed) {
          return ok({ result: mockAnalyze(bookmarks), source: 'mock-fallback', warning: error.message })
        }
        return fail(error)
      }
    }
    case 'bookmarks:applyGroups': {
      const { groups, bookmarks, options } = message.payload || {}
      const result = await applyBookmarkGroups(groups || [], bookmarks || [], options || {})
      return ok(result)
    }
    case 'bookmarks:restoreOriginal': {
      const { parentMap } = message.payload || {}
      await restoreOriginalBookmarkParents(parentMap || {})
      return ok({ restored: true })
    }
    case 'bookmarks:reclassify': {
      const { bookmarks, existingGroups, config } = message.payload || {}
      if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
        return ok({ result: { items: [] }, source: 'empty' })
      }
      try {
        if (!config?.apiKey) {
          // Mock 模式：随机分配到现有分组或创建新分组
          const items = bookmarks.map((bookmark) => {
            const shouldMatch = Math.random() > 0.3
            if (shouldMatch && existingGroups.length > 0) {
              const randomGroup = existingGroups[Math.floor(Math.random() * existingGroups.length)]
              return {
                bookmarkId: bookmark.id,
                action: 'match',
                targetGroupId: randomGroup.id,
                confidence: 0.7,
              }
            } else {
              return {
                bookmarkId: bookmark.id,
                action: 'new_group',
                newGroupName: `新分组 ${Math.floor(Math.random() * 100)}`,
                reason: 'Mock 模式创建',
                attributes: { mock: true },
                confidence: 0.6,
              }
            }
          })
          return ok({ result: { items }, source: 'mock' })
        }
        const result = await reclassifyPendingBookmarks(config, bookmarks, existingGroups)
        return ok({ result, source: 'agent' })
      } catch (error) {
        if (config?.useMockWhenFailed) {
          return fail(error)
        }
        return fail(error)
      }
    }
    default:
      return fail(new Error(`未知消息类型: ${message?.type || 'empty'}`))
  }
}

chrome.runtime.onInstalled.addListener((detail) => {
  console.log('[vue-demo] onInstalled', detail.reason)
  // 设置点击图标时自动切换侧边栏开/关
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// 设置初始行为（service worker 重启后也生效）
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sender
  handleMessage(message)
    .then((payload) => sendResponse(payload))
    .catch((error) => sendResponse(fail(error)))
  return true
})

// 监听书签变化，通知所有扩展页面刷新（防抖 800ms，避免批量操作时频繁触发）
let notifyTimer = null
function notifyBookmarkChanged() {
  clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'bookmarks:changed' }).catch(() => {})
  }, 800)
}

chrome.bookmarks.onCreated.addListener(notifyBookmarkChanged)
chrome.bookmarks.onRemoved.addListener(notifyBookmarkChanged)
chrome.bookmarks.onMoved.addListener(notifyBookmarkChanged)
chrome.bookmarks.onChanged.addListener(notifyBookmarkChanged)
