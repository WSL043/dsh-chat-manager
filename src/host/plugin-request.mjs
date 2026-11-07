const MAX_REQUEST_BYTES = 8 * 1024

export const failure = (code, message) => ({ ok: false, error: { code, message } })

export function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

export async function readPluginPost(req, res, isTrustedRequest, confirmation) {
  if (req.method !== 'POST') {
    sendJson(res, 405, failure('method-not-allowed', '此操作仅接受 POST 请求。'))
    return
  }

  const admission = isTrustedRequest(req)
  if (admission !== true || (confirmation && req.headers['x-dsh-session-delete-confirmation'] !== confirmation)) {
    sendJson(res, admission === 401 ? 401 : 403, failure('forbidden', '请求未通过宿主认证或确认校验。'))
    return
  }

  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    sendJson(res, 415, failure('unsupported-media-type', '此操作需要 JSON 请求。'))
    return
  }

  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) {
        sendJson(res, 413, failure('request-too-large', '请求过大。'))
        return
      }
      chunks.push(buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    if (!res.headersSent) sendJson(res, 400, failure('invalid-json', '请求不是有效 JSON。'))
  }
}
