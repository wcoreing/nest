<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Edit, Delete } from '@element-plus/icons-vue'
import { removeBookmark, removeFolderRecursive } from '../../popup/services/bookmarkService.js'

const props = defineProps({
  treeData: { type: Array, required: true },
  bookmarksCount: { type: Number, required: true },
  analyzing: { type: Boolean, default: false },
})

const emit = defineEmits(['node-update', 'node-delete', 'folder-analyze', 'save-snapshot'])

// 编辑弹窗
const editDialog = ref(false)
const editTarget = ref(null)
const editForm = ref({ label: '', targetFolderId: '' })

const folderTreeData = computed(() => {
  // 收集要排除的 ID（当前编辑的文件夹及其所有子目录，避免循环移动）
  const excludeIds = new Set()
  if (editTarget.value?.isFolder) {
    function collectIds(nodes) {
      for (const n of nodes || []) {
        if (n.isFolder) {
          excludeIds.add(n.id)
          collectIds(n.children)
        }
      }
    }
    // 找到当前文件夹节点并收集其子树
    function findAndCollect(nodes) {
      for (const n of nodes || []) {
        if (n.isFolder) {
          if (n.id === editTarget.value.id) {
            collectIds([n])
            return true
          }
          if (findAndCollect(n.children)) return true
        }
      }
      return false
    }
    findAndCollect(props.treeData)
  }

  function filterFolders(nodes) {
    if (!nodes || nodes.length === 0) return []
    return nodes
      .filter(n => n.isFolder && !excludeIds.has(n.id))
      .map(n => ({ value: n.id, label: n.label, children: filterFolders(n.children) }))
  }
  return filterFolders(props.treeData).filter(n => !['0', '1', '2'].includes(n.id))
})

const filteredTreeData = computed(() => {
  const result = []
  for (const root of props.treeData || []) {
    if (['0', '1', '2'].includes(root.id)) {
      result.push(...(root.children || []))
    } else {
      result.push(root)
    }
  }
  return result
})

const stats = computed(() => {
  let folders = 0, bookmarks = 0
  const count = (nodes) => {
    for (const n of nodes || []) {
      if (n.isFolder) { folders++; count(n.children) } else { bookmarks++ }
    }
  }
  count(props.treeData)
  return { folders, bookmarks }
})

function openEdit(node) {
  editTarget.value = node
  editForm.value = { label: node.label, targetFolderId: '' }
  editDialog.value = true
}

function confirmEdit() {
  if (!editTarget.value) return
  const { id, label, isFolder } = editTarget.value
  const updates = { nodeId: id, newLabel: editForm.value.label || label, isFolder }
  if (editForm.value.targetFolderId) {
    updates.targetFolderId = editForm.value.targetFolderId
  }
  if (editForm.value.label !== label || editForm.value.targetFolderId) {
    emit('node-update', updates)
  }
  editDialog.value = false
}

async function handleDelete(node) {
  const confirmText = node.isFolder
    ? `确定要删除文件夹"${node.label}"及其所有内容吗？此操作不可恢复。`
    : `确定要删除书签"${node.label}"吗？`
  try {
    await ElMessageBox.confirm(confirmText, '确认删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
    if (node.isFolder) {
      await removeFolderRecursive(node.id)
      ElMessage.success('文件夹已删除')
    } else {
      await removeBookmark(node.id)
      ElMessage.success('书签已删除')
    }
    emit('node-delete', { nodeId: node.id, isFolder: node.isFolder })
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(`删除失败：${error.message}`)
  }
}

function handleFolderAnalyze(node, event) {
  event.stopPropagation()
  emit('folder-analyze', { folderId: node.id, folderName: node.label })
}

// 搜索
const searchQuery = ref('')

function countNodes(nodes) {
  let count = 0
  for (const n of nodes || []) {
    count++
    if (n.isFolder && n.children) count += countNodes(n.children)
  }
  return count
}

const searchResultCount = computed(() => countNodes(searchedTreeData.value))

const searchedTreeData = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return filteredTreeData.value

  function matchNode(node) {
    const labelMatch = node.label.toLowerCase().includes(q)
    const urlMatch = !node.isFolder && (node.url || '').toLowerCase().includes(q)
    if (node.isFolder) {
      if (labelMatch) return { ...node }
      const matchedChildren = node.children?.map(matchNode).filter(Boolean) || []
      return matchedChildren.length > 0 ? { ...node, children: matchedChildren } : null
    }
    return (labelMatch || urlMatch) ? { ...node } : null
  }

  return filteredTreeData.value.map(matchNode).filter(Boolean)
})

function findFolderLabel(nodes, value) {
  for (const n of nodes || []) {
    if (n.value === value) return n.label
    const found = findFolderLabel(n.children, value)
    if (found) return found
  }
  return value
}

// 展开/折叠
const treeRef = ref(null)
const isAllExpanded = ref(true)
const expandedNodeIds = ref(new Set())

// 从 storage 恢复展开状态
async function loadExpandedState() {
  return new Promise(resolve => {
    chrome.storage.local.get(['bookmarkTreeExpandedIds'], (result) => {
      const ids = result.bookmarkTreeExpandedIds
      if (Array.isArray(ids)) {
        expandedNodeIds.value = new Set(ids)
        resolve(false) // 有保存的状态
      } else {
        resolve(true) // 没有保存的状态，默认全展开
      }
    })
  })
}

function saveExpandedState() {
  chrome.storage.local.set({
    bookmarkTreeExpandedIds: [...expandedNodeIds.value]
  })
}

function onNodeExpand(data) {
  expandedNodeIds.value.add(data.id)
  saveExpandedState()
}

function onNodeCollapse(data) {
  expandedNodeIds.value.delete(data.id)
  saveExpandedState()
}

// 恢复展开状态到树
function applyExpandedState() {
  if (!treeRef.value) return
  const nodes = treeRef.value.store._getAllNodes()
  nodes.forEach(node => {
    if (node.data.isFolder) {
      node.expanded = expandedNodeIds.value.has(node.data.id)
    }
  })
}

function toggleExpandAll() {
  if (!treeRef.value) return
  const nodes = treeRef.value.store._getAllNodes()
  isAllExpanded.value = !isAllExpanded.value
  if (isAllExpanded.value) {
    nodes.forEach(node => { node.expanded = true })
    expandedNodeIds.value = new Set(nodes.filter(n => n.data.isFolder).map(n => n.data.id))
  } else {
    nodes.forEach(node => {
      if (!node.data.isFolder) return
      const hasSubFolder = (node.childNodes || []).some(c => c.data.isFolder)
      node.expanded = hasSubFolder
      if (hasSubFolder) expandedNodeIds.value.add(node.data.id)
      else expandedNodeIds.value.delete(node.data.id)
    })
  }
  saveExpandedState()
}

// 标记是否已恢复过状态（只恢复一次）
let hasRestoredState = false

onMounted(() => {
  loadExpandedState()
})

// 监听 treeData 变化，数据加载后恢复展开状态
watch(() => props.treeData, async (newVal) => {
  if (!newVal || newVal.length === 0 || hasRestoredState) return
  await nextTick()
  // 再等一帧确保树节点已渲染
  await new Promise(r => setTimeout(r, 50))
  if (expandedNodeIds.value.size > 0) {
    applyExpandedState()
    hasRestoredState = true
  }
}, { deep: false })

// 拖拽排序
function allowDrop(draggingNode, dropNode, type) {
  if (type === 'inner') return false
  return draggingNode.parent?.id === dropNode.parent?.id
}

const isDraggingFromHandle = ref(false)
const draggingParentId = ref(null)

function onHandleDragStart(data) {
  isDraggingFromHandle.value = true
  draggingParentId.value = findParentId(props.treeData, data.id)
}

function findParentId(nodes, targetId, parentId = null) {
  for (const n of nodes || []) {
    if (n.id === targetId) return parentId
    const found = findParentId(n.children, targetId, n.id)
    if (found !== undefined) return found
  }
  return undefined
}

function allowDrag() {
  return isDraggingFromHandle.value
}

async function handleNodeDrop(draggingNode, dropNode, dropType) {
  isDraggingFromHandle.value = false
  const siblings = draggingNode.parent?.childNodes || []
  const newIndex = Math.max(0, siblings.findIndex(n => n.data.id === draggingNode.data.id))
  const parentId = draggingNode.parent?.data?.id ?? draggingParentId.value
  if (!parentId) {
    ElMessage.error('无法确定父节点，排序失败')
    emit('node-delete', { nodeId: '__refresh__', isFolder: false })
    return
  }
  try {
    await new Promise((resolve, reject) => {
      chrome.bookmarks.move(draggingNode.data.id, { parentId, index: newIndex }, (node) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
        else resolve(node)
      })
    })
  } catch (error) {
    ElMessage.error(`排序失败：${error.message}`)
    emit('node-delete', { nodeId: '__refresh__', isFolder: false })
  }
}
</script>

<template>
  <div class="bookmark-tree-panel">
    <div class="panel-header">
      <div class="title">📚 书签结构</div>
      <div class="stats">
        <el-tag size="small" type="info">{{ stats.folders }} 个目录</el-tag>
        <el-tag size="small" type="success">{{ stats.bookmarks }} 条书签</el-tag>
        <el-button text size="small" @click="toggleExpandAll">
          {{ isAllExpanded ? '折叠' : '展开' }}
        </el-button>
        <el-button text size="small" style="color:#67c23a;" @click="emit('save-snapshot')">
          保存
        </el-button>
      </div>
    </div>

    <div class="search-bar">
      <el-input v-model="searchQuery" placeholder="搜索书签或目录..." size="small" clearable prefix-icon="Search" />
      <span v-if="searchQuery" class="search-hint">找到 {{ searchResultCount }} 项</span>
    </div>

    <div class="tree-container">
      <el-tree
        ref="treeRef"
        :data="searchedTreeData"
        node-key="id"
        :default-expand-all="true"
        :expand-on-click-node="false"
        :highlight-current="false"
        draggable
        :allow-drag="allowDrag"
        :allow-drop="allowDrop"
        class="bookmark-tree"
        @node-drop="handleNodeDrop"
        @node-expand="onNodeExpand"
        @node-collapse="onNodeCollapse"
      >
        <template #default="{ data }">
          <div class="tree-node" :class="{ 'is-folder': data.isFolder }">
            <template v-if="data.isFolder">
              <span class="drag-handle" title="拖拽排序" @mousedown="onHandleDragStart(data)">⠿</span>
              <span class="node-label">{{ data.label }}</span>
              <el-tag size="small" type="info" class="node-tag">{{ data.children?.length || 0 }}</el-tag>
              <el-button type="primary" size="small" class="ai-button" :loading="analyzing" @click="handleFolderAnalyze(data, $event)">
                {{ analyzing ? '分析中...' : '✨ AI 分组' }}
              </el-button>
              <el-button text size="small" class="icon-btn" @click.stop="openEdit(data)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button text type="danger" size="small" class="icon-btn" @click.stop="handleDelete(data)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>

            <template v-else>
              <span class="drag-handle" title="拖拽排序" @mousedown="onHandleDragStart(data)">⠿</span>
              <a :href="data.url" target="_blank" class="bookmark-link" :title="data.url" @click.stop>{{ data.label }}</a>
              <el-button text size="small" class="icon-btn" @click.stop="openEdit(data)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button text type="danger" size="small" class="icon-btn" @click.stop="handleDelete(data)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>
          </div>
        </template>
      </el-tree>
    </div>

    <el-dialog v-model="editDialog" :title="editTarget?.isFolder ? '编辑文件夹' : '编辑书签'" width="480px" :append-to-body="true">
      <div class="edit-dialog-body">
        <el-form label-width="60px" size="small" class="edit-form">
          <el-form-item label="名称">
            <el-input v-model="editForm.label" placeholder="名称" />
          </el-form-item>
        </el-form>
        <div class="folder-tree-label">移动到（可选）</div>
        <div class="folder-tree-wrap">
            <el-tree
              :data="folderTreeData"
              :props="{ children: 'children', label: 'label' }"
              node-key="value"
              default-expand-all
              :highlight-current="true"
              :current-node-key="editForm.targetFolderId"
              class="folder-picker-tree"
              @node-click="(data) => editForm.targetFolderId = data.value"
            >
              <template #default="{ data }">
                <span class="folder-tree-node" :class="{ 'is-selected': editForm.targetFolderId === data.value }">
                  📁 {{ data.label }}
                </span>
              </template>
            </el-tree>
          </div>
          <div v-if="editForm.targetFolderId" class="selected-hint">
            已选：{{ findFolderLabel(folderTreeData, editForm.targetFolderId) }}
            <el-button text size="small" @click="editForm.targetFolderId = ''">清除</el-button>
          </div>
      </div>
      <template #footer>
        <el-button size="small" @click="editDialog = false">取消</el-button>
        <el-button size="small" type="primary" @click="confirmEdit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bookmark-tree-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  overflow: hidden;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.title { font-size: 11px; font-weight: 600; color: #303133; }
.stats { display: flex; gap: 4px; }
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.search-hint { font-size: 10px; color: #909399; white-space: nowrap; flex-shrink: 0; }
.tree-container { flex: 1; overflow: hidden; padding: 8px; }
.bookmark-tree { height: 100%; overflow-y: auto; }
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 2px 0;
  font-size: 11px;
}
.is-folder { font-weight: 500; }
.drag-handle {
  flex-shrink: 0;
  color: #c0c4cc;
  cursor: grab;
  font-size: 14px;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.15s;
  user-select: none;
}
.drag-handle:active { cursor: grabbing; }
.tree-node:hover .drag-handle { opacity: 1; }
.node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #303133;
}
.bookmark-link {
  flex: 1;
  color: #303133;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  cursor: pointer;
}
.bookmark-link:hover { color: #409eff; text-decoration: underline; }
.node-tag { flex-shrink: 0; font-size: 9px; height: 16px; line-height: 16px; padding: 0 4px; }
.ai-button { flex-shrink: 0; font-size: 9px; height: 18px; padding: 0 5px; margin-left: auto; }
.icon-btn { flex-shrink: 0; padding: 2px 3px; font-size: 12px; }
.bookmark-tree::-webkit-scrollbar { width: 4px; }
.bookmark-tree::-webkit-scrollbar-track { background: transparent; }
.bookmark-tree::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 2px; }
.bookmark-tree::-webkit-scrollbar-thumb:hover { background: #c0c4cc; }
:deep(.el-tree-node__content) { height: auto; min-height: 28px; padding: 1px 0; background: transparent !important; }
:deep(.el-tree-node__content:hover) { background: transparent !important; }
:deep(.el-tree-node__expand-icon) { padding: 4px; }
:deep(.el-tree-node__expand-icon.is-leaf) { color: transparent; cursor: default; }
:deep(.el-tree-node.is-drop-inner > .el-tree-node__content) { background: #ecf5ff !important; }
:deep(.el-tree__drop-indicator) { background: #409eff; height: 2px; }
.edit-dialog-body { display: flex; flex-direction: column; gap: 8px; }
.edit-form { margin-bottom: 0; }
.folder-tree-label { font-size: 12px; color: #606266; margin-bottom: 4px; padding-left: 2px; }
.folder-tree-wrap {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  height: 280px;
  overflow-y: auto;
  padding: 6px 4px;
  background: #fff;
}
.folder-tree-wrap::-webkit-scrollbar { width: 4px; }
.folder-tree-wrap::-webkit-scrollbar-track { background: transparent; }
.folder-tree-wrap::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 2px; }
.folder-picker-tree { background: transparent; }
.folder-tree-node { font-size: 12px; color: #303133; padding: 1px 4px; border-radius: 4px; cursor: pointer; display: inline-block; width: 100%; }
.folder-tree-node.is-selected { color: #409eff; background: #ecf5ff; }
.folder-tree-node:hover { color: #409eff; }
.selected-hint { font-size: 11px; color: #909399; display: flex; align-items: center; gap: 4px; }
.folder-picker-tree :deep(.el-tree-node__content) { height: auto; min-height: 26px; background: transparent !important; }
.folder-picker-tree :deep(.el-tree-node__content:hover) { background: #f5f7fa !important; }
.folder-picker-tree :deep(.el-tree-node.is-current > .el-tree-node__content) { background: #ecf5ff !important; }
</style>
