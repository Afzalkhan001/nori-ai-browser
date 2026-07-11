// Token-cost guard: pricing, rough estimation, and context trimming.
// OpenAI is the only bill — every call passes through here.

export type ModelTier = 'fast' | 'smart'

export const MODELS: Record<ModelTier, string> = {
  fast: 'gpt-4o-mini',
  smart: 'gpt-4o'
}

/** USD per 1M tokens (input, output). */
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'text-embedding-3-small': { in: 0.02, out: 0 }
}

/** Rough estimate — ~4 chars per token for English/HTML-ish text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  // Unknown/free models (OpenRouter :free, local Ollama, etc.) carry no bill.
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000
}

/** Hard-trim text to a token budget, cutting at a line boundary when possible. */
export function trimToBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastBreak = cut.lastIndexOf('\n')
  return (lastBreak > maxChars * 0.8 ? cut.slice(0, lastBreak) : cut) + '\n…[trimmed]'
}
