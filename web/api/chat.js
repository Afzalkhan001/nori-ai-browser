// Vercel serverless function — the shared "demo key" path. The API key lives ONLY
// as a server-side environment variable (OPENROUTER_KEY), never in client code or
// the repo, so visitors can try Nori Web with no key of their own and the secret
// stays secret. Users who paste their own key bypass this entirely (client-side).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const key = process.env.OPENROUTER_KEY || process.env.OPENAI_API_KEY
  if (!key) {
    // No shared key configured — tell the client to prompt for the user's own.
    res.status(200).json({ error: 'NO_SHARED_KEY' })
    return
  }
  let body = req.body
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      body = {}
    }
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const model = typeof body.model === 'string' && body.model ? body.model : 'openrouter/free'
  if (!messages.length) {
    res.status(400).json({ error: 'messages required' })
    return
  }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://github.com/Afzalkhan001/nori-ai-browser',
        'X-Title': 'Nori Web'
      },
      body: JSON.stringify({ model, messages, max_tokens: 1600 })
    })
    const data = await r.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: 'Upstream error: ' + String(e).slice(0, 140) })
  }
}
