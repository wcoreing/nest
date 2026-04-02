import { StateGraph, Annotation } from '@langchain/langgraph'

/**
 * 书签分类 AI Agent 工作流
 * 使用 LangGraph 进行多节点编排
 */

// ==================== 工具函数 ====================

function safeJsonParse(text) {
  // 先尝试直接解析
  try {
    return JSON.parse(text)
  } catch {
    // 尝试从 markdown 代码块中提取
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (codeBlock) {
      try { return JSON.parse(codeBlock[1]) } catch { /* continue */ }
    }
    // 提取第一个完整的 JSON 对象（贪婪匹配最外层 {}）
    const start = text.indexOf('{')
    if (start !== -1) {
      let depth = 0
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
          depth--
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)) } catch { break }
          }
        }
      }
    }
    return null
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function calculateStats(bookmarks) {
  const domains = new Map()
  const pathKeywords = new Map()
  let totalLength = 0

  for (const bm of bookmarks) {
    // 统计域名
    const domain = extractDomain(bm.url)
    if (domain) {
      domains.set(domain, (domains.get(domain) || 0) + 1)
    }

    // 统计路径关键词
    const pathParts = bm.path?.split(/[/\s]+/).filter(Boolean) || []
    for (const part of pathParts) {
      if (part.length > 1) {
        pathKeywords.set(part.toLowerCase(), (pathKeywords.get(part.toLowerCase()) || 0) + 1)
      }
    }

    totalLength += (bm.title?.length || 0) + (bm.url?.length || 0)
  }

  return {
    totalCount: bookmarks.length,
    uniqueDomains: domains.size,
    topDomains: Array.from(domains.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count })),
    avgLength: Math.round(totalLength / bookmarks.length),
  }
}

// ==================== 状态定义 ====================

const BookmarkState = Annotation.Root({
  // 输入：原始书签数据
  inputBookmarks: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),

  // 配置：LLM 配置信息
  config: Annotation({
    reducer: (_, right) => right,
    default: () => ({}),
  }),

  // 预处理后的书签数据
  enrichedBookmarks: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),

  // 统计信息
  stats: Annotation({
    reducer: (_, right) => right,
    default: () => ({}),
  }),

  // LLM 原始输出
  rawGroups: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),

  // 最终分组结果
  finalGroups: Annotation({
    reducer: (_, right) => right,
    default: () => [],
  }),

  // 处理日志（用于调试）
  logs: Annotation({
    reducer: (left, right) => [...(left || []), ...(right || [])],
    default: () => [],
  }),
})

// ==================== 节点函数 ====================

/**
 * 节点 1: 数据预处理
 * - 增强书签数据（提取域名、关键词等）
 * - 计算统计信息
 */
async function preprocessNode(state) {
  const logs = []
  const startTime = Date.now()

  try {
    // 增强书签数据
    const enriched = state.inputBookmarks.map((bm) => ({
      ...bm,
      domain: extractDomain(bm.url),
      keywords: bm.path?.split(/[/\s]+/).filter(Boolean) || [],
    }))

    // 计算统计信息
    const stats = calculateStats(enriched)

    logs.push(`✓ 预处理完成：${enriched.length} 个书签，${stats.uniqueDomains} 个域名`)

    return {
      enrichedBookmarks: enriched,
      stats,
      logs: [`[预处理] ${logs.join(' | ')} (耗时: ${Date.now() - startTime}ms)`],
    }
  } catch (error) {
    return {
      logs: [`[预处理] ✗ 失败: ${error.message}`],
    }
  }
}

/**
 * 节点 2: LLM 智能分类
 * - 调用 LLM API 进行语义分组
 * - 返回分组建议
 */
async function classifyNode(state) {
  const logs = []
  const startTime = Date.now()

  try {
    const endpoint = state.config?.endpoint
    const model = state.config?.modelName || state.config?.model || 'qwen-plus'
    const apiKey = state.config?.apiKey || ''

    if (!endpoint) {
      throw new Error('缺少模型接口地址 endpoint')
    }

    // 构建提示词
    const systemPrompt = [
      '你是浏览器书签分组助手，专门帮助用户以全新视角整理书签收藏。',
      '',
      '任务要求：',
      '1. 完全忽略书签原有的目录结构，仅基于标题和 URL 内容进行语义分析',
      '2. 从内容主题、使用场景、技术领域等多个维度重新思考分组方式',
      '3. 动态生成有创意的分组名称，鼓励产生与原有分类不同的新视角',
      '4. 每个分组应该有明确的主题和命名依据',
      '5. 对分组质量给出置信度评分（0.7-1.0）：',
      '   - 只要书签有共同主题就应该给出 0.75 以上的置信度',
      '   - 大胆分组，不要过度谨慎',
      '',
      '严格要求：只输出一个合法的 JSON 对象，不要任何解释、注释或多余文字。',
      '输出格式：{"groups":[{"name":"分组名称","reason":"理由","confidence":0.85,"attributes":{"basis":"依据","keyFactor":"关键因素"},"bookmarkIds":["id1","id2"]}]}',
    ].join('\n')

    // 构建请求数据（只传标题和 URL，不传 path，避免 LLM 受原有目录结构影响）
    const requestData = {
      bookmarks: state.enrichedBookmarks.map((bm) => ({
        id: bm.id,
        title: bm.title,
        url: bm.url,
        domain: bm.domain,
      })),
      stats: state.stats,
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: state.config?.temperature ?? 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(requestData, null, 2) },
        ],
      }),
    })

    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const err = await response.json()
        detail = `${detail} - ${err?.error?.message || JSON.stringify(err)}`
      } catch {
        // ignore
      }
      throw new Error(detail)
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content || ''
    const parsed = safeJsonParse(content)

    if (!parsed || !Array.isArray(parsed.groups)) {
      throw new Error('模型输出无法解析为 groups 结构')
    }

    logs.push(`✓ LLM 分类完成：生成 ${parsed.groups.length} 个分组`)

    return {
      rawGroups: parsed.groups,
      logs: [`[LLM分类] ${logs.join(' | ')} (耗时: ${Date.now() - startTime}ms)`],
    }
  } catch (error) {
    return {
      logs: [`[LLM分类] ✗ 失败: ${error.message} (耗时: ${Date.now() - startTime}ms)`],
    }
  }
}

/**
 * 节点 3: 结果优化
 * - 清理低质量分组
 * - 合并相似分组（未来可增强）
 * - 验证分组完整性
 */
async function optimizeNode(state) {
  const logs = []
  const startTime = Date.now()

  try {
    const groups = state.rawGroups || []
    const allBookmarkIds = new Set(state.inputBookmarks.map((bm) => String(bm.id)))
    const assignedIds = new Set()

    console.log('[optimizeNode] inputBookmarks IDs:', [...allBookmarkIds].slice(0, 5))
    console.log('[optimizeNode] rawGroups sample bookmarkIds:', groups[0]?.bookmarkIds?.slice(0, 3))

    // 验证并清理分组
    const cleaned = groups
      .filter((group) => {
        const hasBookmarks = Array.isArray(group.bookmarkIds) && group.bookmarkIds.length > 0
        if (!hasBookmarks) {
          logs.push(`⚠ 跳过空分组: ${group.name}`)
        }
        return hasBookmarks
      })
      .map((group) => {
        // 验证书签 ID 有效性（统一转字符串比较）
        const validIds = group.bookmarkIds.filter((id) => allBookmarkIds.has(String(id)))
        validIds.forEach((id) => assignedIds.add(id))

        return {
          ...group,
          bookmarkIds: validIds,
          confidence: Number(group.confidence ?? 0.7),
        }
      })
      .filter((group) => group.bookmarkIds.length > 0)

    // 处理未分配的书签
    const unassigned = Array.from(allBookmarkIds).filter((id) => !assignedIds.has(id))
    if (unassigned.length > 0) {
      logs.push(`⚠ ${unassigned.length} 个书签未分配，创建"待分类"分组`)
      cleaned.push({
        name: '待分类',
        reason: '未能明确分类的书签',
        confidence: 0.3,
        attributes: { basis: 'unassigned' },
        bookmarkIds: unassigned,
      })
    }

    logs.push(`✓ 优化完成：${cleaned.length} 个有效分组`)

    return {
      finalGroups: cleaned,
      logs: [`[优化] ${logs.join(' | ')} (耗时: ${Date.now() - startTime}ms)`],
    }
  } catch (error) {
    return {
      logs: [`[优化] ✗ 失败: ${error.message} (耗时: ${Date.now() - startTime}ms)`],
    }
  }
}

// ==================== 条件路由函数 ====================

/**
 * 决定是否继续优化节点
 */
function shouldContinue(state) {
  // 只检查最后一条 log（classify 节点的输出）是否有错误
  const lastLog = state.logs[state.logs.length - 1] || ''
  return lastLog.includes('✗') ? 'end' : 'optimize'
}

// ==================== 图构建工厂 ====================

function createBookmarkGraph() {
  return new StateGraph(BookmarkState)
    .addNode('preprocess', preprocessNode)
    .addNode('classify', classifyNode)
    .addNode('optimize', optimizeNode)
    .addEdge('__start__', 'preprocess')
    .addEdge('preprocess', 'classify')
    .addConditionalEdges('classify', shouldContinue, {
      optimize: 'optimize',
      end: '__end__',
    })
    .addEdge('optimize', '__end__')
    .compile()
}

// ==================== 导出接口 ====================

/**
 * 分析书签并生成分组
 * @param {Object} config - LLM 配置
 * @param {Array} bookmarks - 书签列表
 * @returns {Promise<{groups: Array, logs?: Array}>}
 */
export async function analyzeBookmarksWithAgent(config, bookmarks) {
  const bookmarkGraph = createBookmarkGraph()
  const initialState = {
    inputBookmarks: bookmarks.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
    })),
    config,
  }

  const state = await bookmarkGraph.invoke(initialState)

  // 检查 classify 节点是否失败
  const classifyFailed = state.logs.some((log) => log.includes('[LLM分类]') && log.includes('✗'))
  if (classifyFailed) {
    const error = new Error('工作流执行失败')
    error.logs = state.logs
    throw error
  }

  // 返回结果（兼容原有接口）
  return {
    groups: state.finalGroups || state.rawGroups || [],
    logs: state.logs,
  }
}

/**
 * 对"待确认"分组的书签进行二次分类
 * 尝试将其匹配到现有分组，或在根目录创建新分组
 */
export async function reclassifyPendingBookmarks(config, pendingBookmarks, existingGroups) {
  if (!pendingBookmarks || pendingBookmarks.length === 0) {
    return { items: [] }
  }

  console.log('[reclassifyPendingBookmarks] 开始二次分类', {
    pendingCount: pendingBookmarks.length,
    existingGroupCount: existingGroups.length,
  })

  // 构建现有分组的描述
  const groupsDescription = existingGroups
    .map((g, idx) => `${idx + 1}. ${g.name}: ${g.reason || '无描述'}`)
    .join('\n')

  // 构建系统提示词
  const systemPrompt = [
    '你是书签二次分类助手。你的任务是判断"待确认"的书签能否归类到已有的分组中。',
    '',
    '已有分组如下：',
    groupsDescription,
    '',
    '对于每个书签，你需要：',
    '1. 仔细分析书签的标题、URL和路径',
    '2. 判断它是否属于上述某个已有分组',
    '3. 如果能匹配，返回该分组的编号和置信度',
    '4. 如果不能匹配到任何现有分组，根据书签内容创建一个合适的新分组名称',
    '',
    '**重要规则：',
    '- 只有当书签与分组主题高度相关时才匹配（置信度 > 0.7）',
    '- 如果不确定，宁可创建新分组也不要强行匹配',
    '- 新分组名称应该简洁、准确，反映书签的真实主题',
    '- 新分组应该在根目录下创建（不要创建子分组）',
    '',
    '请以JSON格式返回结果，格式如下：',
    '```json',
    '[',
    '  {',
    '    "bookmarkId": "书签ID",',
    '    "action": "match" | "new_group",',
    '    "targetGroupIndex": 1,  // 仅当 action=match 时',
    '    "newGroupName": "新分组名称",  // 仅当 action=new_group 时',
    '    "reason": "选择理由",',
    '    "confidence": 0.8',
    '  }',
    ']',
    '```',
  ].join('\n')

  // 构建用户提示词
  const userPrompt = [
    `请对以下 ${pendingBookmarks.length} 个书签进行二次分类：`,
    '',
    ...pendingBookmarks.map((bm, idx) => {
      return [
        `${idx + 1}. ID: ${bm.id}`,
        `   标题: ${bm.title}`,
        `   URL: ${bm.url}`,
        `   原路径: ${bm.path || '无'}`,
        '',
      ].join('\n')
    }),
    '',
    '请返回JSON格式的分类结果。',
  ].join('\n')

  try {
    // 调用 LLM
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        temperature: 0.1, // 降低温度，更确定性的输出
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM 请求失败: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // 解析 JSON 结果
    const result = safeJsonParse(content)
    if (!result || !Array.isArray(result)) {
      throw new Error('无法解析 LLM 返回的 JSON 结果')
    }

    // 验证并转换结果
    const items = result.map((item) => {
      if (item.action === 'match' && item.targetGroupIndex !== undefined) {
        // 匹配到现有分组
        const groupIndex = item.targetGroupIndex - 1 // 转换为 0-based
        const targetGroup = existingGroups[groupIndex]
        if (!targetGroup) {
          throw new Error(`无效的分组索引: ${item.targetGroupIndex}`)
        }
        return {
          bookmarkId: item.bookmarkId,
          action: 'match',
          targetGroupId: targetGroup.id,
          confidence: item.confidence || 0.7,
        }
      } else if (item.action === 'new_group') {
        // 创建新分组
        return {
          bookmarkId: item.bookmarkId,
          action: 'new_group',
          newGroupName: item.newGroupName || '新分组',
          reason: item.reason || '',
          attributes: item.attributes || {},
          confidence: item.confidence || 0.6,
        }
      } else {
        throw new Error(`无效的 action: ${item.action}`)
      }
    })

    console.log('[reclassifyPendingBookmarks] 完成', {
      total: items.length,
      matched: items.filter(i => i.action === 'match').length,
      newGroups: items.filter(i => i.action === 'new_group').length,
    })

    return { items }
  } catch (error) {
    console.error('[reclassifyPendingBookmarks] 失败', error)
    throw error
  }
}

/**
 * 导出节点函数，方便单独测试或组合使用
 */
export const nodes = {
  preprocess: preprocessNode,
  classify: classifyNode,
  optimize: optimizeNode,
}
