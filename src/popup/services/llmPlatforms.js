export const llmPlatforms = [
  {
    id: 'bailian',
    label: '阿里云百炼',
    endpoints: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoints: ['https://api.openai.com/v1/chat/completions'],
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoints: ['https://api.deepseek.com/chat/completions'],
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'custom',
    label: '自定义',
    endpoints: [],
    models: [],
  },
]

export function getPlatformById(platformId) {
  return llmPlatforms.find((item) => item.id === platformId) || llmPlatforms[0]
}

export function detectPlatformByEndpoint(endpoint) {
  for (const platform of llmPlatforms) {
    if (platform.endpoints.some((item) => item === endpoint)) {
      return platform.id
    }
  }
  return 'custom'
}
