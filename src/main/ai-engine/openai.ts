import OpenAI from 'openai'
import { MODELS, type ModelTier } from './cost'

let client: OpenAI | null = null
// A key entered at runtime (settings UI) takes precedence over the .env file, so
// installed copies with no .env still work. Held in memory; persistence is the
// caller's job (store settings). Setting it re-inits the client.
let runtimeKey: string | null = null

function resolveKey(): string | undefined {
  return runtimeKey || process.env.OPENAI_API_KEY
}

export function setApiKey(key: string): void {
  runtimeKey = key.trim() || null
  client = null // force re-creation with the new key on next call
}

export function hasKey(): boolean {
  return Boolean(resolveKey())
}

function getClient(): OpenAI {
  if (!client) {
    const apiKey = resolveKey()
    if (!apiKey)
      throw new Error('No OpenAI API key set. Add one in Nori’s settings, or put OPENAI_API_KEY in a .env file.')
    client = new OpenAI({ apiKey })
  }
  return client
}

// ----- transient-failure resilience: 24x7 runs must survive 429s, 5xx and network blips -----

function isRetriable(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|network|socket hang up|Connection error|terminated/i.test(
    String(err)
  )
}

/** Retry an API call up to 3 times with 1s/3s backoff — only on transient errors. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i === attempts - 1 || !isRetriable(err)) throw err
      console.log('[nori-openai] transient error, retrying in', 1000 * 3 ** i, 'ms:', String(err).slice(0, 160))
      await new Promise((r) => setTimeout(r, 1000 * 3 ** i))
    }
  }
  throw lastErr
}

export type ChatTurn =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface StreamResult {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  toolCalls: ToolCall[]
}

/**
 * Stream a chat completion; onDelta fires per text chunk.
 * Model routing: 'fast' (gpt-4o-mini) for everyday chat,
 * 'smart' (gpt-4o) reserved for analyze/prompt synthesis.
 */
/** Embed text for Recall — text-embedding-3-small, ~$0.02 per 1M tokens. */
export async function embed(
  input: string
): Promise<{ vector: number[]; inputTokens: number }> {
  const res = await withRetry(() =>
    getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: input.slice(0, 24000)
    })
  )
  return { vector: res.data[0].embedding, inputTokens: res.usage?.prompt_tokens ?? 0 }
}

/** Non-streaming completion; optional strict-JSON mode. Returns text + usage. */
export async function completeChat(
  tier: ModelTier,
  messages: ChatTurn[],
  json = false
): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
  const model = MODELS[tier]
  const res = await withRetry(() =>
    getClient().chat.completions.create({
      model,
      messages: messages as never,
      ...(json ? { response_format: { type: 'json_object' as const } } : {})
    })
  )
  return {
    text: res.choices[0]?.message?.content ?? '',
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    model
  }
}

export async function streamChat(
  tier: ModelTier,
  messages: ChatTurn[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  tools?: ToolDef[]
): Promise<StreamResult> {
  const model = MODELS[tier]
  let emitted = false // once text reached the UI we can no longer safely restart

  const consume = async (): Promise<StreamResult> => {
    const stream = await getClient().chat.completions.create(
      {
        model,
        // Our ChatTurn union mirrors the OpenAI message shape.
        messages: messages as never,
        tools: tools as never,
        // Browser tools are STATEFUL (one shared tab): parallel calls like
        // fill(post1)+fill(post2)+submit×5 overwrite the same composer and
        // wreck batches. Force one tool call per round.
        ...(tools ? { parallel_tool_calls: false } : {}),
        stream: true,
        stream_options: { include_usage: true }
      },
      { signal }
    )

    let text = ''
    let inputTokens = 0
    let outputTokens = 0
    // Streamed tool calls arrive as fragments keyed by index — accumulate them.
    const toolAcc: { id: string; name: string; arguments: string }[] = []
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) {
        text += delta.content
        emitted = true
        onDelta(delta.content)
      }
      for (const tc of delta?.tool_calls ?? []) {
        const slot = (toolAcc[tc.index] ??= { id: '', name: '', arguments: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.arguments += tc.function.arguments
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens
        outputTokens = chunk.usage.completion_tokens
      }
    }
    return { text, inputTokens, outputTokens, model, toolCalls: toolAcc.filter((t) => t.name) }
  }

  // Retry a failed/dropped stream up to 3 tries — but never after text was already
  // streamed to the renderer (restarting then would duplicate visible output).
  for (let attempt = 0; ; attempt++) {
    try {
      return await consume()
    } catch (err) {
      if (emitted || attempt >= 2 || !isRetriable(err)) throw err
      console.log('[nori-openai] stream failed, retrying in', 1000 * 3 ** attempt, 'ms:', String(err).slice(0, 160))
      await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt))
    }
  }
}
