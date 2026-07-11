// Vercel serverless function — fetch a URL server-side (avoids browser CORS) and
// return its readable text. The AI call stays client-side with the user's own key,
// so no secrets ever touch this function.

module.exports = async function handler(req, res) {
  const url = (req.query.url || '').toString()
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Provide a valid http(s) url.' })
    return
  }
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    })
    const html = await r.text()
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : url
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()
    res.setHeader('Cache-Control', 's-maxage=600')
    res.status(200).json({ title, text: text.slice(0, 12000) })
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch that page: ' + String(e).slice(0, 120) })
  }
}
