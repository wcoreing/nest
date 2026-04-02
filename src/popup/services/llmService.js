function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseModelError(payload, status) {
  const message = payload?.error?.message || payload?.message || ''
  if (!message) return `模型请求失败: ${status}`
  if (status === 429) {
    if (/quota|insufficient|billing|余额|额度/i.test(message)) {
      return `模型请求失败(429)：账号额度不足或未开通计费。${message}`
    }
    return `模型请求失败(429)：请求过于频繁，请稍后重试。${message}`
  }
  return `模型请求失败(${status})：${message}`
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[1] || match[0])
    } catch {
      return null
    }
  }
}

export async function analyzeBookmarksWithModel(config, bookmarks) {
  const payload = bookmarks.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    path: item.path,
  }))

  const prompt = [
    '你是浏览器书签分组助手。',
    '必须根据书签语义动态生成分组，不使用固定分类模板。',
    '返回严格 JSON，不要 markdown，不要额外解释。',
    'JSON 结构：{"groups":[{"name":"", "reason":"", "confidence":0.85, "attributes":{}, "bookmarkIds":[string]}]}',
    '要求：',
    '- 每个书签 id 必须且只能出现一次',
    '- confidence 在 0~1',
    '- attributes 必须是对象',
  ].join('\n')

  const body = JSON.stringify({
    model: config.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify({ bookmarks: payload }) },
    ],
  })

  let response = null
  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    })

    if (response.ok) break

    let errPayload = null
    try {
      errPayload = await response.clone().json()
    } catch {
      errPayload = null
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get('retry-after') || 0)
      await sleep(retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1500)
      continue
    }
    throw new Error(parseModelError(errPayload, response.status))
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''
  const parsed = safeJsonParse(content)
  if (!parsed || !Array.isArray(parsed.groups)) {
    throw new Error('模型输出无法解析为目标 JSON 结构')
  }
  return parsed
}
