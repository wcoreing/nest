<script setup>
import { computed, ref } from 'vue'
import { Folder, Link, Edit } from '@element-plus/icons-vue'

const props = defineProps({
  groups: { type: Array, required: true },
  bookmarks: { type: Array, required: true },
  showReviewOnly: { type: Boolean, required: true },
})

const emit = defineEmits(['add-group', 'remove-group', 'move-bookmark', 'rename-group', 'update:showReviewOnly'])

// 编辑弹窗状态
const editDialog = ref(false)
const editTarget = ref(null) // { type: 'bookmark' | 'group', id, label, url?, groupId? }
const editForm = ref({ label: '', url: '', groupId: '' })

function openEditDialog(data) {
  editTarget.value = data
  editForm.value = {
    label: data.label,
    url: data.url || '',
    groupId: data.groupId || '',
  }
  editDialog.value = true
}

function confirmEdit() {
  if (!editTarget.value) return
  const { type, id } = editTarget.value
  if (type === 'group') {
    if (editForm.value.label !== editTarget.value.label) {
      emit('rename-group', { groupId: id, newName: editForm.value.label })
    }
  } else {
    // bookmark: 只处理分组移动（标题/URL 编辑需要 chrome API，这里只做分组）
    if (editForm.value.groupId && editForm.value.groupId !== editTarget.value.groupId) {
      emit('move-bookmark', { bookmarkId: id, newGroupId: editForm.value.groupId })
    }
    if (editForm.value.label !== editTarget.value.label) {
      emit('rename-group', { groupId: id, newName: editForm.value.label })
    }
  }
  editDialog.value = false
}

// 构建树形数据
const treeData = computed(() => {
  return props.groups.map((group) => {
    const groupBookmarks = props.bookmarks.filter((item) => item.groupId === group.id)
    return {
      id: group.id,
      label: group.name,
      type: 'group',
      color: group.color,
      reason: group.reason,
      isNew: group.isNew || false,
      children: groupBookmarks.map((bookmark) => ({
        id: bookmark.id,
        label: bookmark.title,
        type: 'bookmark',
        url: bookmark.url,
        groupId: bookmark.groupId,
        confidence: bookmark.ai?.confidence || 0,
        reviewNeeded: bookmark.ai?.reviewNeeded || false,
      })),
    }
  })
})

const filteredTreeData = computed(() => {
  if (!props.showReviewOnly) return treeData.value
  return treeData.value
    .map((group) => ({
      ...group,
      children: group.children.filter((bookmark) => bookmark.reviewNeeded),
    }))
    .filter((group) => group.children.length > 0)
})

const treeKey = computed(() => props.bookmarks.map(b => `${b.id}:${b.groupId}`).join(','))

const getNodeIcon = (node) => node.type === 'group' ? Folder : Link

const getNodeClass = (node) => {
  if (node.type === 'group') return `tree-node-color-${node.color}`
  return node.reviewNeeded ? 'tree-node-bookmark-warning' : 'tree-node-bookmark'
}
</script>

<template>
  <div class="group-tree-editor">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-checkbox
        :model-value="showReviewOnly"
        @update:model-value="(v) => emit('update:showReviewOnly', v)"
        size="small"
      >仅低置信度</el-checkbox>
      <el-button size="small" type="primary" @click="emit('add-group')">+ 分组</el-button>
    </div>

    <!-- 空状态 -->
    <div v-if="groups.length === 0" class="empty-state">
      <el-empty description="暂无分组，请先进行 AI 分析" :image-size="60" />
    </div>

    <!-- 树形结构 -->
    <el-tree
      v-else
      :key="treeKey"
      :data="filteredTreeData"
      :props="{ children: 'children', label: 'label' }"
      default-expand-all
      :highlight-current="false"
      node-key="id"
      class="bookmark-tree"
    >
      <template #default="{ data }">
        <div class="custom-tree-node" :class="getNodeClass(data)">

          <!-- 分组节点 -->
          <template v-if="data.type === 'group'">
            <div class="group-node">
              <div class="group-header">
                <el-icon class="folder-icon"><Folder /></el-icon>
                <span class="group-name">{{ data.label }}</span>
                <el-tag v-if="data.isNew" size="small" class="new-tag">新增</el-tag>
                <el-tag v-else size="small" class="existing-tag">已有</el-tag>
                <el-tag size="small" type="info" class="count-tag">{{ data.children.length }}</el-tag>
                <el-button text size="small" class="action-btn" @click.stop="openEditDialog(data)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button text type="danger" size="small" class="action-btn" @click.stop="emit('remove-group', data.id)">✕</el-button>
              </div>
              <div class="group-reason">{{ data.reason || '暂无描述' }}</div>
            </div>
          </template>

          <!-- 书签节点 -->
          <template v-else>
            <div class="bookmark-node">
              <el-icon class="link-icon"><Link /></el-icon>
              <!-- 点击标题直接打开 -->
              <a :href="data.url" target="_blank" class="bookmark-link" :title="data.url" @click.stop>
                {{ data.label }}
              </a>
              <el-tag :type="data.reviewNeeded ? 'warning' : 'success'" size="small" class="confidence-tag">
                {{ (data.confidence * 100).toFixed(0) }}%
              </el-tag>
              <!-- 移动分组下拉 -->
              <el-select
                v-model="data.groupId"
                size="small"
                placeholder="移动..."
                class="move-select"
                @click.stop
                @change="(newGroupId) => emit('move-bookmark', { bookmarkId: data.id, newGroupId })"
              >
                <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
              </el-select>
              <!-- 编辑按钮 -->
              <el-button text size="small" class="action-btn" @click.stop="openEditDialog(data)">
                <el-icon><Edit /></el-icon>
              </el-button>
            </div>
          </template>

        </div>
      </template>
    </el-tree>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="editDialog"
      :title="editTarget?.type === 'group' ? '编辑分组' : '编辑书签'"
      width="320px"
      :append-to-body="true"
    >
      <el-form label-width="60px" size="small">
        <el-form-item label="名称">
          <el-input v-model="editForm.label" placeholder="名称" />
        </el-form-item>
        <template v-if="editTarget?.type === 'bookmark'">
          <el-form-item label="分组">
            <el-select v-model="editForm.groupId" style="width:100%">
              <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="URL">
            <el-input v-model="editForm.url" placeholder="URL" disabled />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button size="small" @click="editDialog = false">取消</el-button>
        <el-button size="small" type="primary" @click="confirmEdit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.group-tree-editor {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.bookmark-tree {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  padding: 8px;
}

.custom-tree-node { width: 100%; }

/* 分组节点 */
.group-node {
  width: 100%;
  padding: 6px 8px;
  background: #f5f7fa;
  border-radius: 6px;
  border-left: 3px solid #409eff;
  margin-bottom: 4px;
}
.tree-node-color-blue .group-node  { border-left-color: #409eff; }
.tree-node-color-green .group-node { border-left-color: #67c23a; }
.tree-node-color-yellow .group-node{ border-left-color: #e6a23c; }
.tree-node-color-orange .group-node{ border-left-color: #ff6600; }
.tree-node-color-purple .group-node{ border-left-color: #9c27b0; }
.tree-node-color-pink .group-node  { border-left-color: #e91e63; }
.tree-node-color-cyan .group-node  { border-left-color: #00bcd4; }
.tree-node-color-grey .group-node  { border-left-color: #909399; }

.group-header {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  overflow-x: auto;
}
.group-header::-webkit-scrollbar { height: 3px; }
.group-header::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 2px; }

.folder-icon { font-size: 14px; color: #409eff; flex-shrink: 0; }

.group-name {
  flex: 1;
  font-weight: 600;
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.new-tag {
  flex-shrink: 0;
  font-size: 9px;
  height: 16px;
  line-height: 16px;
  padding: 0 5px;
  background: #f0700a;
  color: #fff;
  border: none;
  border-radius: 3px;
  font-weight: 600;
}

.existing-tag {
  flex-shrink: 0;
  font-size: 9px;
  height: 16px;
  line-height: 16px;
  padding: 0 5px;
  background: #909399;
  color: #fff;
  border: none;
  border-radius: 3px;
}

.count-tag {
  flex-shrink: 0;
  font-size: 9px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
}

.action-btn {
  flex-shrink: 0;
  padding: 2px 4px;
  font-size: 12px;
}

.group-reason {
  font-size: 10px;
  color: #909399;
  padding-left: 20px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 书签节点 */
.bookmark-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}
.bookmark-node:hover { background: #f5f7fa; }
.tree-node-bookmark-warning { background: #fef0f0; }
.tree-node-bookmark-warning:hover { background: #fde2e2; }

.link-icon { font-size: 12px; color: #67c23a; flex-shrink: 0; }

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

.confidence-tag {
  flex-shrink: 0;
  font-size: 9px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
}

.move-select { flex-shrink: 0; width: 70px; }
.move-select :deep(.el-input__wrapper) { font-size: 10px; }

/* 滚动条 */
.bookmark-tree::-webkit-scrollbar { width: 5px; }
.bookmark-tree::-webkit-scrollbar-track { background: #f1f1f1; }
.bookmark-tree::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }

/* Element Plus 覆盖 */
:deep(.el-tree-node__content) {
  height: auto;
  min-height: 30px;
  padding: 1px 0;
  background: transparent !important;
}
:deep(.el-tree-node__content:hover) { background: transparent !important; }
:deep(.el-tree-node__expand-icon) { padding: 4px; }
:deep(.el-tree-node__expand-icon.is-leaf) { color: transparent; cursor: default; }
</style>
