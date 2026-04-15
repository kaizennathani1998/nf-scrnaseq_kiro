import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

// ── Runs ──────────────────────────────────────────────────────────────────────
export const getRuns = () => http.get('/runs').then((r) => r.data)

export const createRun = (formData) =>
  http.post('/runs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data)

export const getRunStatus = (runId) =>
  http.get(`/runs/${runId}`).then((r) => r.data)

export const cancelRun = (runId) =>
  http.post(`/runs/${runId}/cancel`).then((r) => r.data)

// ── Outputs ───────────────────────────────────────────────────────────────────
export const getRunOutputs = (runId) =>
  http.get(`/runs/${runId}/outputs`).then((r) => r.data)

export const getRunLogs = (runId) =>
  http.get(`/runs/${runId}/logs`).then((r) => r.data)

// ── AI Agent ──────────────────────────────────────────────────────────────────
export const chatWithAgent = (runId, message, history) =>
  http.post(`/runs/${runId}/chat`, { message, history }).then((r) => r.data)

// ── h5ad Analysis ─────────────────────────────────────────────────────────────
export const uploadH5ad = (file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return http.post('/analyze/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then((r) => r.data)
}

export const analyzeChat = (sessionId, message, history) =>
  http.post(`/analyze/${sessionId}/chat`, { message, history }).then((r) => r.data)
export const getHealthOmicsStatus = () =>
  http.get('/healthomics/status').then((r) => r.data)

export const uploadToS3 = (runId, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return http.post(`/runs/${runId}/upload`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then((r) => r.data)
}
