<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BookmarkTreePanel from './components/BookmarkTreePanel.vue'
import GroupEditorPanel from './components/GroupEditorPanel.vue'
import ModelConfigPanel from './components/ModelConfigPanel.vue'
import appLogo from '../../logo.png'

const loading = ref(false)
const applying = ref(false)
const showReviewOnly = ref(false)
const treeData = ref([])
const bookmarks = ref([])
const groups = ref([])
const rootFolders = ref([])
const targetRootId = ref('')
const historyRuns = ref([])
const folderHistory = ref([]) // 分组文件夹历史
const createdFolderIds = ref([]) // 新增：当前创建的文件夹 ID 列表
const applySource = ref('current')
const originalParentMap = ref({})

// 当前分析状态
const currentAnalysisType = ref('global') // 'global' 或 'folder'
const currentAnalysisFolderId = ref(null) // 文件夹分析时记录文件夹 ID
const currentAnalysisFolderName = ref('') // 文件夹分析时记录文件夹名称

// UI 状态
const activeStep = ref(0)
const showConfig = ref(false)
const showTree = ref(false)

const config = reactive({
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  graphName: 'bookmark_classifier',
  modelName: 'qwen-plus',
  apiKey: '',
  useMockWhenFailed: true,
  reviewThreshold: 0.50, // 降低阈值，减少待分类数量
})

const colorPool = ['blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan', 'grey']

// 计算属性：统计信息
const stats = computed(() => ({
  total: bookmarks.value.length,
  grouped: bookmarks.value.filter((b) => b.groupId).length,
  ungrouped: bookmarks.value.filter((b) => !b.groupId).length,
  groupCount: groups.value.length,
  needReview: bookmarks.value.filter((b) => b.ai?.reviewNeeded).length,
}))

// 计算属性：是否可以应用
const canApply = computed(() => {
  return groups.value.length > 0 && stats.value.grouped > 0
})


function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve))
}

function sendBackgroundMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '后台处理失败'))
        return
      }
      resolve(response.data)
    })
  })
}

async function refreshBookmarks() {
  loading.value = true
  try {
    const payload = await sendBackgroundMessage('bookmarks:getAll')
    treeData.value = payload.treeData
    bookmarks.value = payload.bookmarks
    rootFolders.value = payload.rootFolders
    if (!targetRootId.value) targetRootId.value = payload.defaultRootId || ''
    if (Object.keys(originalParentMap.value).length === 0) {
      const map = {}
      for (const item of payload.bookmarks) map[item.id] = item.parentId
      originalParentMap.value = map
    }
    activeStep.value = 1
    ElMessage.success(`已加载 ${payload.bookmarks.length} 个书签`)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function mergeGroup(name, reason, attributesText, color, isNew = false) {
  const existing = groups.value.find((item) => item.name === name)
  if (existing) return existing
  const created = {
    id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    reason,
    attributesText,
    color,
    isNew, // 标记是否为新增分组
  }
  groups.value.push(created)
  return created
}

function applyAiResult(result, targetBookmarkIds = null) {
  // 清空所有分组（无论全局分析还是文件夹分析，都只显示当前结果）
  groups.value = []

  // 如果指定了目标书签 ID 列表，只处理这些书签
  const targetBookmarks = targetBookmarkIds
    ? bookmarks.value.filter(b => targetBookmarkIds.includes(b.id))
    : bookmarks.value

  // 清空目标书签的分组信息
  for (const row of targetBookmarks) {
    row.groupId = null
    row.ai = null
  }

  const matched = new Set()
  for (let i = 0; i < result.groups.length; i += 1) {
    const item = result.groups[i]
    const group = mergeGroup(
      item.name || `分组 ${i + 1}`,
      item.reason || '',
      JSON.stringify(item.attributes || {}, null, 2),
      colorPool[i % colorPool.length],
    )
    const confidence = Number(item.confidence ?? 0.7)
    for (const bookmarkId of item.bookmarkIds || []) {
      const row = bookmarks.value.find((bookmark) => bookmark.id === bookmarkId)
      if (!row) continue
      // 只处理目标书签
      if (!targetBookmarkIds || targetBookmarkIds.includes(bookmarkId)) {
        row.groupId = group.id
        row.ai = { confidence, reviewNeeded: confidence < config.reviewThreshold }
        matched.add(row.id)
      }
    }
  }

  // 只对目标书签中未分配的创建"待确认"分组
  const unassigned = targetBookmarks.filter((item) => !matched.has(item.id))
  if (unassigned.length > 0) {
    const fallback = mergeGroup(
      '待确认',
      '模型未覆盖的书签',
      JSON.stringify({ reviewNeeded: true }, null, 2),
      colorPool[groups.value.length % colorPool.length],
    )
    for (const row of unassigned) {
      row.groupId = fallback.id
      row.ai = { confidence: 0.4, reviewNeeded: true }
    }
  }
  activeStep.value = 2
}

function saveCurrentRunToHistory(sourceLabel) {
  const run = {
    id: `run-${Date.now()}`,
    name: `${sourceLabel}-${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    analysisType: currentAnalysisType.value,
    folderId: currentAnalysisFolderId.value,
    folderName: currentAnalysisFolderName.value,
    groups: groups.value.map((item) => ({
      name: item.name,
      reason: item.reason,
      attributesText: item.attributesText,
      color: item.color,
    })),
    assignments: bookmarks.value.map((item) => ({
      bookmarkId: item.id,
      groupName: groups.value.find((group) => group.id === item.groupId)?.name || '',
      confidence: item.ai?.confidence ?? null,
      reviewNeeded: !!item.ai?.reviewNeeded,
    })),
  }
  historyRuns.value.unshift(run)
  if (historyRuns.value.length > 20) historyRuns.value = historyRuns.value.slice(0, 20)
  applySource.value = run.id
}

// 从文件夹 ID 获取该文件夹下的所有书签
function getBookmarksInFolder(folderId) {
  function collectBookmarks(nodes) {
    const result = []
    for (const node of nodes || []) {
      if (node.isFolder) {
        if (node.id === folderId) {
          // 找到目标文件夹，收集其所有子书签
          function collectFromFolder(folderNode) {
            for (const child of folderNode.children || []) {
              if (child.isFolder) {
                collectFromFolder(child)
              } else {
                // 在 bookmarks 中找到对应的书签对象
                const bookmark = bookmarks.value.find(b => b.id === child.id)
                if (bookmark) result.push(bookmark)
              }
            }
          }
          collectFromFolder(node)
        } else {
          // 继续递归查找
          result.push(...collectBookmarks(node.children))
        }
      }
    }
    return result
  }
  return collectBookmarks(treeData.value)
}

// 对文件夹进行 AI 分组
async function analyzeFolder({ folderId, folderName }) {
  const folderBookmarks = getBookmarksInFolder(folderId)
  const folderBookmarkIds = folderBookmarks.map(b => b.id)

  if (folderBookmarks.length === 0) {
    ElMessage.warning(`文件夹"${folderName}"中没有书签`)
    return
  }

  // 设置当前分析状态
  currentAnalysisType.value = 'folder'
  currentAnalysisFolderId.value = folderId
  currentAnalysisFolderName.value = folderName

  loading.value = true
  try {
    const payload = await sendBackgroundMessage('bookmarks:analyze', {
      config: { ...config },
      bookmarks: folderBookmarks,
    })
    // 传入目标书签 ID 列表，只处理这些书签
    applyAiResult(payload.result, folderBookmarkIds)
    if (payload.source === 'agent') {
      ElMessage.success(`已对"${folderName}"进行 AI 分组，共 ${folderBookmarks.length} 个书签`)
    } else if (payload.source === 'mock') {
      ElMessage.info(`未配置 API Key，已使用模拟分组（${folderBookmarks.length} 个书签）`)
    } else if (payload.source === 'mock-fallback') {
      ElMessage.warning(`Agent 失败，已回退模拟分组：${payload.warning || 'unknown error'}`)
    }
    saveCurrentRunToHistory(`${folderName}-AI分组`)
    await storageSet({ bookmarkGroupHistoryRuns: historyRuns.value })
  } catch (error) {
    ElMessage.error(error.message || 'Agent 分析失败')
  } finally {
    loading.value = false
  }
}

async function analyze() {
  if (bookmarks.value.length === 0) {
    ElMessage.warning('请先加载书签')
    return
  }

  // 设置当前分析状态为全局
  currentAnalysisType.value = 'global'
  currentAnalysisFolderId.value = null
  currentAnalysisFolderName.value = ''

  loading.value = true
  try {
    const payload = await sendBackgroundMessage('bookmarks:analyze', {
      config: { ...config },
      bookmarks: bookmarks.value,
    })
    applyAiResult(payload.result)
    if (payload.source === 'agent') {
      ElMessage.success('AI 分析完成')
    } else if (payload.source === 'mock') {
      ElMessage.info('未配置 API Key，已使用模拟分组')
    } else if (payload.source === 'mock-fallback') {
      ElMessage.warning(`Agent 失败，已回退模拟分组：${payload.warning || 'unknown error'}`)
    }
    saveCurrentRunToHistory('AI分组')
    await storageSet({ bookmarkGroupHistoryRuns: historyRuns.value })
  } catch (error) {
    ElMessage.error(error.message || 'Agent 分析失败')
  } finally {
    loading.value = false
  }
}

function addGroup() {
  groups.value.push({
    id: `g-${Date.now()}`,
    name: `新分组 ${groups.value.length + 1}`,
    reason: '',
    attributesText: JSON.stringify({ source: 'manual' }, null, 2),
    color: colorPool[groups.value.length % colorPool.length],
  })
}

function removeGroup(groupId) {
  const fallback = groups.value.find((item) => item.id !== groupId)
  if (!fallback) {
    ElMessage.warning('至少保留一个分组')
    return
  }
  for (const row of bookmarks.value) {
    if (row.groupId === groupId) row.groupId = fallback.id
  }
  groups.value = groups.value.filter((item) => item.id !== groupId)
}

function syncGroupAssignment() {
  for (const row of bookmarks.value) {
    if (!groups.value.some((item) => item.id === row.groupId)) {
      row.groupId = groups.value[0]?.id || null
    }
  }
}

function handleBookmarkMove({ bookmarkId, newGroupId }) {
  const bookmark = bookmarks.value.find((b) => b.id === bookmarkId)
  if (bookmark) bookmark.groupId = newGroupId
}

function handleRenameGroup({ groupId, newName }) {
  const group = groups.value.find((g) => g.id === groupId)
  if (group) group.name = newName
}

// 对"待确认"分组进行二次分类
async function reclassifyPendingGroup() {
  const pendingGroup = groups.value.find(g => g.name === '待确认')
  if (!pendingGroup) return

  const pendingBookmarks = bookmarks.value.filter(b => b.groupId === pendingGroup.id)
  if (pendingBookmarks.length === 0) return

  console.log('[reclassifyPendingGroup] 开始二次分类', { count: pendingBookmarks.length })

  // 获取除了"待确认"之外的所有分组
  const existingGroups = groups.value.filter(g => g.name !== '待确认')

  // 如果没有其他分组，就无法二次分类，保持原样
  if (existingGroups.length === 0) {
    console.log('[reclassifyPendingGroup] 没有其他分组可用于二次分类')
    return
  }

  loading.value = true
  try {
    // 调用后台进行二次分类
    const payload = await sendBackgroundMessage('bookmarks:reclassify', {
      bookmarks: pendingBookmarks,
      existingGroups: existingGroups.map(g => ({
        id: g.id,
        name: g.name,
        reason: g.reason,
        attributes: g.attributesText ? JSON.parse(g.attributesText) : {},
      })),
      config: { ...config },
    })

    // 应用二次分类结果
    let matchedCount = 0
    let newGroupCount = 0

    for (const item of payload.result.items || []) {
      const bookmark = pendingBookmarks.find(b => b.id === item.bookmarkId)
      if (!bookmark) continue

      if (item.action === 'match' && item.targetGroupId) {
        // 匹配到现有分组
        const targetGroup = existingGroups.find(g => g.id === item.targetGroupId)
        if (targetGroup) {
          bookmark.groupId = targetGroup.id
          bookmark.ai = { confidence: item.confidence || 0.7, reviewNeeded: false }
          matchedCount++
        }
      } else if (item.action === 'new_group' && item.newGroupName) {
        // 创建新分组（只在根目录）
        const newGroup = mergeGroup(
          item.newGroupName,
          item.reason || '二次分类创建',
          JSON.stringify(item.attributes || {}, null, 2),
          colorPool[groups.value.length % colorPool.length],
          true // 标记为新增分组
        )
        bookmark.groupId = newGroup.id
        bookmark.ai = { confidence: item.confidence || 0.7, reviewNeeded: false }
        newGroupCount++
      }
    }

    // 删除"待确认"分组（如果已经空了）
    const remainingPending = pendingBookmarks.filter(b => b.groupId === pendingGroup.id)
    if (remainingPending.length === 0) {
      groups.value = groups.value.filter(g => g.id !== pendingGroup.id)
      console.log('[reclassifyPendingGroup] 删除待确认分组')
    }

    console.log('[reclassifyPendingGroup] 完成', {
      matchedCount,
      newGroupCount,
      remainingCount: remainingPending.length,
    })

    ElMessage.success(
      `二次分类完成：${matchedCount} 个匹配到现有分组，${newGroupCount} 个创建新分组` +
      (remainingPending.length > 0 ? `，${remainingPending.length} 个仍需确认` : '')
    )

    // 保存更新后的历史
    saveCurrentRunToHistory('二次分类')
    await storageSet({ bookmarkGroupHistoryRuns: historyRuns.value })
  } catch (error) {
    console.error('[reclassifyPendingGroup] 失败', error)
    ElMessage.warning(`二次分类失败：${error.message}`)
  } finally {
    loading.value = false
  }
}

function setShowReviewOnly(value) {
  showReviewOnly.value = value
}

async function saveConfig() {
  await storageSet({
    llmConfig: { ...config },
    bookmarkGroupHistoryRuns: historyRuns.value,
    bookmarkFolderHistory: folderHistory.value,
    bookmarkCreatedFolderIds: createdFolderIds.value,
    bookmarkOriginalParentMap: originalParentMap.value,
    bookmarkTargetRootId: targetRootId.value,
  })
  ElMessage.success('配置已保存')
  showConfig.value = false
}

// 处理书签树节点删除
async function handleTreeNodeDelete({ nodeId, isFolder }) {
  console.log('[handleTreeNodeDelete] 收到删除事件', { nodeId, isFolder })
  // 删除后重新加载书签树
  await refreshBookmarks()
}

function resolveHistoryToWorkingSet(historyId) {
  const run = historyRuns.value.find((item) => item.id === historyId)
  if (!run) return null

  // 恢复分析状态
  currentAnalysisType.value = run.analysisType || 'global'
  currentAnalysisFolderId.value = run.folderId || null
  currentAnalysisFolderName.value = run.folderName || ''

  groups.value = run.groups.map((item, index) => ({
    id: `h-${historyId}-${index}`,
    name: item.name,
    reason: item.reason,
    attributesText: item.attributesText,
    color: item.color || colorPool[index % colorPool.length],
  }))

  const groupIdByName = new Map(groups.value.map((item) => [item.name, item.id]))
  for (const row of bookmarks.value) {
    row.groupId = null
    row.ai = null
  }

  for (const assignment of run.assignments) {
    const row = bookmarks.value.find((item) => item.id === assignment.bookmarkId)
    if (!row) continue
    row.groupId = groupIdByName.get(assignment.groupName) || null
    row.ai = {
      confidence: assignment.confidence ?? 0.5,
      reviewNeeded: !!assignment.reviewNeeded,
    }
  }
  return run
}

async function applyGroupsToBookmarks() {
  if (applySource.value === 'original') {
    try {
      await ElMessageBox.confirm(
        '确定要恢复到原始目录结构吗？这将撤销所有 AI 分组。',
        '确认操作',
        { type: 'warning' }
      )
      applying.value = true
      await sendBackgroundMessage('bookmarks:restoreOriginal', {
        parentMap: originalParentMap.value,
      })
      ElMessage.success('已恢复到原始目录结构')
      await refreshBookmarks()
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(`恢复失败：${error.message}`)
      }
    } finally {
      applying.value = false
    }
    return
  }

  if (applySource.value !== 'current') {
    const run = resolveHistoryToWorkingSet(applySource.value)
    if (!run) {
      ElMessage.warning('所选历史分组不存在，请重新选择')
      return
    }
  } else if (!groups.value.length) {
    ElMessage.warning('请先生成分组')
    return
  }

  // 对"待确认"分组进行二次分类
  await reclassifyPendingGroup()

  // 重新检查是否还有分组
  if (!groups.value.length) {
    ElMessage.warning('没有可应用的分组')
    return
  }

  // 根据分析类型确定目标文件夹
  const isFolderAnalysis = currentAnalysisType.value === 'folder'
  const targetFolderId = isFolderAnalysis ? currentAnalysisFolderId.value : targetRootId.value
  const locationText = isFolderAnalysis
    ? `文件夹"${currentAnalysisFolderName.value}"中`
    : '书签栏根目录'

  try {
    await ElMessageBox.confirm(
      `确定要应用分组吗？这将在${locationText}创建 "${groups.value.length} 个分组" 文件夹。`,
      '确认操作',
      { type: 'warning' }
    )
    applying.value = true
    const payload = await sendBackgroundMessage('bookmarks:applyGroups', {
      groups: groups.value,
      bookmarks: bookmarks.value,
      options: {
        targetRootId: targetFolderId,
        parentMap: originalParentMap.value,
        previousFolderIds: createdFolderIds.value,
        isFolderAnalysis,
      },
    })

    // 显示清理结果
    const messages = [`创建了 ${payload.createdFolderIds.length} 个新分组`]
    if (payload.clearedCount > 0) {
      messages.push(`清理了 ${payload.clearedCount} 个旧分组`)
    }

    ElMessage.success(messages.join('，'))

    // 保存新创建的文件夹 ID 列表
    createdFolderIds.value = payload.createdFolderIds
    await storageSet({ bookmarkCreatedFolderIds: payload.createdFolderIds })

    activeStep.value = 3
    await refreshBookmarks()

    // 应用成功后清空 AI 分组显示
    groups.value = []
    // 清空所有书签的分组信息
    for (const row of bookmarks.value) {
      row.groupId = null
      row.ai = null
    }
    // 重置分析状态
    currentAnalysisType.value = 'global'
    currentAnalysisFolderId.value = null
    currentAnalysisFolderName.value = ''
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(`应用失败：${error.message}`)
    }
  } finally {
    applying.value = false
  }
}

onMounted(async () => {
  const saved = await storageGet([
    'llmConfig',
    'bookmarkGroupHistoryRuns',
    'bookmarkFolderHistory',
    'bookmarkCreatedFolderIds',
    'bookmarkOriginalParentMap',
    'bookmarkTargetRootId',
  ])
  if (saved.llmConfig) {
    Object.assign(config, saved.llmConfig)
  }
  historyRuns.value = Array.isArray(saved.bookmarkGroupHistoryRuns) ? saved.bookmarkGroupHistoryRuns : []
  folderHistory.value = Array.isArray(saved.bookmarkFolderHistory) ? saved.bookmarkFolderHistory : []
  createdFolderIds.value = Array.isArray(saved.bookmarkCreatedFolderIds) ? saved.bookmarkCreatedFolderIds : []
  originalParentMap.value = saved.bookmarkOriginalParentMap || {}
  targetRootId.value = saved.bookmarkTargetRootId || ''

  // 自动加载书签
  await refreshBookmarks()
})
</script>

<template>
  <div class="wrap">
    <!-- 顶部标题栏 -->
    <div class="header">
      <h1 class="brand">
        <img :src="appLogo" alt="Nest Logo" class="brand-logo" />
        <span>Nest</span>
      </h1>
      <el-button text @click="showConfig = !showConfig">
        {{ showConfig ? '收起配置' : '⚙️ 配置' }}
      </el-button>
    </div>

    <!-- 配置面板 -->
    <el-collapse-transition>
      <div v-show="showConfig" class="config-section">
        <ModelConfigPanel :config="config" @save="saveConfig" />
      </div>
    </el-collapse-transition>

    <!-- 步骤指示器 -->
    <div class="steps-section">
      <el-steps :active="activeStep" finish-status="success" align-center>
        <el-step title="加载书签" description="从浏览器读取书签" />
        <el-step title="AI 分析" description="智能生成分组" />
        <el-step title="应用分组" description="应用到书签栏" />
      </el-steps>
    </div>

    <!-- 统计信息 -->
    <div v-if="stats.total > 0" class="stats-section">
      <el-row :gutter="8">
        <el-col :span="12">
          <el-statistic title="总书签" :value="stats.total" />
        </el-col>
        <el-col :span="12">
          <el-statistic title="分组数" :value="stats.groupCount" />
        </el-col>
        <el-col :span="12">
          <el-statistic title="已分组" :value="stats.grouped" />
        </el-col>
        <el-col :span="12">
          <el-statistic title="待审核" :value="stats.needReview" />
        </el-col>
      </el-row>
    </div>

    <!-- 操作按钮区域 -->
    <div class="actions-section">
      <el-space wrap>
        <el-button :loading="loading" @click="refreshBookmarks">
          🔄 刷新书签
        </el-button>
        <el-button type="primary" :loading="loading" :disabled="stats.total === 0" @click="analyze">
          ✨ AI 分析
        </el-button>
        <el-button
          type="success"
          :loading="applying"
          :disabled="!canApply"
          @click="applyGroupsToBookmarks"
        >
          📦 应用分组
        </el-button>
        <el-button @click="showTree = !showTree">
          {{ showTree ? '隐藏' : '显示' }}书签树
        </el-button>
      </el-space>
    </div>

    <!-- 书签树（可折叠） -->
    <el-collapse-transition>
      <div v-show="showTree" class="tree-section">
        <BookmarkTreePanel
          :tree-data="treeData"
          :bookmarks-count="bookmarks.length"
          @node-delete="handleTreeNodeDelete"
          @folder-analyze="analyzeFolder"
        />
      </div>
    </el-collapse-transition>

    <!-- 分组编辑面板 -->
    <div v-if="groups.length > 0" class="groups-section">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>分组结果</span>
            <el-tag size="small">{{ groups.length }} 个分组</el-tag>
          </div>
        </template>
        <GroupEditorPanel
          :groups="groups"
          :bookmarks="bookmarks"
          :show-review-only="showReviewOnly"
          @add-group="addGroup"
          @remove-group="removeGroup"
          @move-bookmark="handleBookmarkMove"
          @rename-group="handleRenameGroup"
          @update:show-review-only="setShowReviewOnly"
        />
      </el-card>
    </div>

    <!-- 历史记录（可选） -->
    <div v-if="historyRuns.length > 0 || folderHistory.length > 0" class="history-section">
      <el-select
        v-model="applySource"
        placeholder="选择历史版本"
        style="width: 100%"
        @change="resolveHistoryToWorkingSet"
      >
        <el-option label="当前编辑结果" value="current" />
        <el-option label="恢复首次原始结构" value="original" />
        <el-option
          v-for="item in historyRuns"
          :key="item.id"
          :label="item.name"
          :value="item.id"
        />
      </el-select>

      <!-- 分组文件夹历史 -->
      <div v-if="folderHistory.length > 0" class="folder-history">
        <div class="history-title">分组文件夹历史（最近10次）</div>
        <el-timeline size="small" class="timeline">
          <el-timeline-item
            v-for="item in folderHistory"
            :key="item.id"
            :timestamp="item.name"
            placement="top"
          >
            <el-tag size="small" type="info">{{ item.data.length }} 个分组</el-tag>
            <span class="history-count">
              {{ item.data.reduce((sum, f) => sum + f.bookmarks.length, 0) }} 个书签
            </span>
          </el-timeline-item>
        </el-timeline>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  width: 100%;
  height: 100%;
  padding: 12px;
  background: #f5f7fa;
  overflow-y: auto;
  font-size: 12px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  object-fit: cover;
}

.config-section {
  margin-bottom: 12px;
}

.steps-section {
  margin-bottom: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
}

.stats-section {
  margin-bottom: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
}

.actions-section {
  margin-bottom: 12px;
  padding: 10px;
  background: white;
  border-radius: 6px;
}

.tree-section {
  margin-bottom: 12px;
  height: 500px;
  min-height: 500px;
}

.groups-section {
  margin-bottom: 12px;
  flex: 1;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.groups-section :deep(.el-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.groups-section :deep(.el-card__body) {
  flex: 1;
  overflow: hidden;
  padding: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-section {
  margin-top: 12px;
}

.folder-history {
  margin-top: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
}

.history-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.timeline {
  padding-left: 8px;
}

.history-count {
  margin-left: 8px;
  font-size: 11px;
  color: #909399;
}

:deep(.el-statistic__head) {
  font-size: 11px;
  color: #909399;
}

:deep(.el-statistic__content) {
  font-size: 20px;
  font-weight: 600;
}

:deep(.el-step__title) {
  font-size: 12px !important;
}

:deep(.el-step__description) {
  font-size: 11px !important;
}

:deep(.el-card__body) {
  padding: 12px;
}

:deep(.el-button) {
  font-size: 12px;
}

:deep(.el-form-item__label) {
  font-size: 12px;
}

:deep(.el-input__inner) {
  font-size: 12px;
}

/* 滚动条样式 */
.wrap::-webkit-scrollbar {
  width: 6px;
}

.wrap::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.wrap::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.wrap::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
