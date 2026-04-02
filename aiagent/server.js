import express from 'express'
import { Annotation, StateGraph } from '@langchain/langgraph'

const app = express()
app.use(express.json({ limit: '2mb' }))

const BookmarkState = Annotation.Root({
  bookmarks: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),
  rules: Annotation({
    reducer: (_, right) => right,
    default: () => ({}),
  }),
  endpoint: Annotation({
    reducer: (_, right) => right,
    default: () => '',
  }),
  apiKey: Annotation({
    reducer: (_, right) => right,
    default: () => '',
  }),
  model: Annotation({
    reducer: (_, right) => right,
    default: () => 'qwen-plus',
  }),
  groups: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),
})

function buildPrompt(bookmarks) {
  return [
    '你是浏览器书签分组助手。',
    '请动态生成分组，不要使用固定分类模板。',
    '请严格返回 JSON：{"groups":[{"name":"", "reason":"", "confidence":0.85, "attributes":{}, "bookmarkIds":[string]}]}',
    '要求：每个书签 id 必须且只能出现一次。',
    '',
    JSON.stringify({ bookmarks }),
  ].join('\n')
}

async function callModel({ endpoint, apiKey, model, bookmarks }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: '你是书签分类智能体，只能输出 JSON。',
        },
        {
          role: 'user',
          content: buildPrompt(bookmarks),
        },
      ],
    }),
  })

  if (!response.ok) {
    let detail = `模型请求失败: ${response.status}`
    try {
      const err = await response.json()
      detail = `${detail} - ${err?.error?.message || JSON.stringify(err)}`
    } catch {
      // ignore
    }
    throw new Error(detail)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content || '{}'
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed?.groups)) {
    throw new Error('模型返回格式错误，缺少 groups 数组')
  }
  return parsed.groups
}

const graph = new StateGraph(BookmarkState)
  .addNode('classify', async (state) => {
    const groups = await callModel({
      endpoint: state.endpoint,
      apiKey: state.apiKey,
      model: state.model,
      bookmarks: state.bookmarks,
    })
    return { groups }
  })
  .addEdge('__start__', 'classify')
  .addEdge('classify', '__end__')
  .compile()

app.post('/langgraph/bookmark-classify', async (req, res) => {
  try {
    const input = req.body?.input || {}
    const cfg = req.body?.config || {}
    const state = await graph.invoke({
      bookmarks: input.bookmarks || [],
      rules: input.rules || {},
      endpoint: cfg.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: cfg.apiKey || '',
      model: cfg.model || 'qwen-plus',
    })
    res.json({
      graph: req.body?.graph || 'bookmark_classifier',
      groups: state.groups || [],
    })
  } catch (error) {
    res.status(500).json({
      error: {
        message: error.message || 'LangGraph 执行失败',
      },
    })
  }
})

app.listen(8787, () => {
  console.log('LangGraph aiagent is listening on :8787')
})
