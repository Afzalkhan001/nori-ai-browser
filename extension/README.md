# Nori — Chrome extension (early)

Run Nori inside the Chrome you already have — no separate browser to install.
This is **v1**: a side panel that chats about the page you're on, using your own
free API key. More features (analyze, compose, extract, and click/fill automation
via Chrome's debugger API) are being ported from the desktop app.

## Load it (30 seconds)

1. Open **chrome://extensions**
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select this **`extension`** folder
5. Pin Nori and click its icon → the side panel opens
6. Click the **⚙** → pick **OpenRouter (free)**, paste your key, **Save**

Now open any article and ask Nori about it.

## What works today
- Side panel chat grounded in the current page
- Provider setup (OpenRouter / Groq / Gemini / OpenAI / Ollama), key stored locally

## Coming next (ported from desktop)
- Analyze · Compose · Extract
- Acting on the page (click / fill / submit) via `chrome.debugger`
- Recall (local memory) and Agents/Skills
