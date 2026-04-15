import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // Pipeline runs
  runs: [],
  activeRunId: null,

  setRuns: (runs) => set({ runs }),
  addRun: (run) => set((s) => ({ runs: [run, ...s.runs] })),
  updateRun: (id, patch) =>
    set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  setActiveRun: (id) => set({ activeRunId: id }),
  getActiveRun: () => {
    const { runs, activeRunId } = get()
    return runs.find((r) => r.id === activeRunId) || null
  },

  // Chat messages per run
  chatMessages: {},   // { [runId]: [{role, content, ts}] }
  addMessage: (runId, msg) =>
    set((s) => ({
      chatMessages: {
        ...s.chatMessages,
        [runId]: [...(s.chatMessages[runId] || []), msg],
      },
    })),
  clearChat: (runId) =>
    set((s) => ({ chatMessages: { ...s.chatMessages, [runId]: [] } })),
}))
