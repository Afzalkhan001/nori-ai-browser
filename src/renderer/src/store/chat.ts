import { create } from 'zustand'
import type { ChatMessage } from '@shared/types'

interface ChatStore {
  /** chatId (== tabId) -> messages */
  threads: Record<string, ChatMessage[]>
  /** chatIds with a stream in flight */
  streaming: Record<string, boolean>
  /** live agent step labels while a reply is being worked on */
  steps: Record<string, string[]>
  /** pending submit-approval request per chat */
  approval: Record<string, { requestId: string; summary: string } | null>
  loadThread: (chatId: string) => Promise<void>
  send: (chatId: string, text: string) => Promise<void>
  clear: (chatId: string) => Promise<void>
}

export const useChat = create<ChatStore>((set, get) => ({
  threads: {},
  streaming: {},
  steps: {},
  approval: {},

  loadThread: async (chatId) => {
    if (get().threads[chatId]) return
    const messages = await window.nori.ai.getMessages(chatId)
    set((s) => ({ threads: { ...s.threads, [chatId]: messages } }))
  },

  send: async (chatId, text) => {
    const now = Date.now()
    const optimisticUser: ChatMessage = {
      id: `local-${now}`,
      chatId,
      role: 'user',
      content: text,
      model: null,
      costUsd: null,
      createdAt: now
    }
    set((s) => ({
      streaming: { ...s.streaming, [chatId]: true },
      steps: { ...s.steps, [chatId]: [] },
      threads: { ...s.threads, [chatId]: [...(s.threads[chatId] ?? []), optimisticUser] }
    }))
    const { messageId } = await window.nori.ai.sendMessage(chatId, text)
    const assistant: ChatMessage = {
      id: messageId,
      chatId,
      role: 'assistant',
      content: '',
      model: null,
      costUsd: null,
      createdAt: now + 1
    }
    set((s) => ({
      threads: { ...s.threads, [chatId]: [...(s.threads[chatId] ?? []), assistant] }
    }))
  },

  clear: async (chatId) => {
    await window.nori.ai.clearChat(chatId)
    set((s) => ({ threads: { ...s.threads, [chatId]: [] } }))
  }
}))

// Stream events — append deltas to the right message.
window.nori.ai.onChunk(({ chatId, messageId, delta }) => {
  useChat.setState((s) => ({
    threads: {
      ...s.threads,
      [chatId]: (s.threads[chatId] ?? []).map((m) =>
        m.id === messageId ? { ...m, content: m.content + delta } : m
      )
    }
  }))
})

window.nori.ai.onDone(({ chatId, messageId, costUsd }) => {
  useChat.setState((s) => ({
    streaming: { ...s.streaming, [chatId]: false },
    steps: { ...s.steps, [chatId]: [] },
    approval: { ...s.approval, [chatId]: null },
    threads: {
      ...s.threads,
      [chatId]: (s.threads[chatId] ?? []).map((m) => (m.id === messageId ? { ...m, costUsd } : m))
    }
  }))
})

window.nori.ai.onApprovalRequest(({ chatId, requestId, summary }) => {
  useChat.setState((s) => ({
    approval: { ...s.approval, [chatId]: { requestId, summary } }
  }))
})

window.nori.ai.onStep(({ chatId, label }) => {
  useChat.setState((s) => ({
    steps: { ...s.steps, [chatId]: [...(s.steps[chatId] ?? []), label] }
  }))
})

window.nori.ai.onError(({ chatId, messageId, message }) => {
  useChat.setState((s) => ({
    streaming: { ...s.streaming, [chatId]: false },
    threads: {
      ...s.threads,
      [chatId]: (s.threads[chatId] ?? []).map((m) =>
        m.id === messageId && !m.content ? { ...m, content: `⚠ ${message}` } : m
      )
    }
  }))
})
