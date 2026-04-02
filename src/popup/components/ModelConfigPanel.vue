<script setup>
const props = defineProps({
  config: { type: Object, required: true },
})

const emit = defineEmits(['save'])
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="title">⚙️ AI 分组配置</div>
    </template>
    <el-form label-position="top" size="small">
      <el-form-item label="模型接口地址（OpenAI 兼容）">
        <el-input v-model="config.endpoint" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" />
      </el-form-item>
      <el-form-item label="模型名称">
        <el-input v-model="config.modelName" placeholder="qwen-plus" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="config.apiKey" type="password" show-password placeholder="Bearer Token" />
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="label-with-tip">
            分组创意度（Temperature）
            <el-tooltip content="控制 AI 分组的随机性和创意程度。值越高，每次分组结果差异越大、越有创意；值越低，结果越稳定保守。推荐 0.5~0.8。" placement="top">
              <span class="tip-icon">ⓘ</span>
            </el-tooltip>
          </span>
        </template>
        <el-slider v-model="config.temperature" :min="0" :max="1" :step="0.05" show-input />
      </el-form-item>

      <el-form-item>
        <template #label>
          <span class="label-with-tip">
            待审核阈值
            <el-tooltip content="AI 对书签分组的置信度低于此值时，该书签会被标记为「待审核」（橙色显示），提示你手动确认分组是否合适。值越高，被标记的书签越多。" placement="top">
              <span class="tip-icon">ⓘ</span>
            </el-tooltip>
          </span>
        </template>
        <el-slider v-model="config.reviewThreshold" :min="0.1" :max="0.95" :step="0.05" show-input />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" @click="emit('save')">💾 保存配置</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.title { font-weight: 600; font-size: 13px; }

.label-with-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.tip-icon {
  color: #909399;
  cursor: help;
  font-size: 13px;
  line-height: 1;
}

:deep(.el-form-item) { margin-bottom: 14px; }
:deep(.el-form-item__label) { font-size: 12px; line-height: 1.5; padding-bottom: 4px; }
:deep(.el-input__inner) { font-size: 12px; }
:deep(.el-slider__button-wrapper) { height: 12px; width: 12px; }
:deep(.el-slider__button) { width: 12px; height: 12px; }
</style>
