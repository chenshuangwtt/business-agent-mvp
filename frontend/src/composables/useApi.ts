import { computed, ref } from 'vue'
import type {
  AgentResponse,
  HealthResponse,
  SessionInfo,
  ToolInfo,
  Trace,
} from '@/types/api'

const BASE_URL = ''
const pendingRequests = ref(0)
const error = ref<string | null>(null)

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  pendingRequests.value += 1
  error.value = null

  try {
    const res = await fetch(`${BASE_URL}${path}`, init)
    const text = await res.text()
    const payload = text ? JSON.parse(text) : null

    if (!res.ok) {
      const message = payload?.message || payload?.error || `HTTP ${res.status}`
      throw new Error(message)
    }

    return payload as T
  } catch (e: any) {
    error.value = e?.message || '请求失败'
    throw e
  } finally {
    pendingRequests.value = Math.max(0, pendingRequests.value - 1)
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function useApi() {
  return {
    loading: computed(() => pendingRequests.value > 0),
    error,
    sendChat: (message: string, sessionId?: string) =>
      post<AgentResponse>('/api/chat', { message, sessionId }),
    approve: (approvalId: string, approved: boolean) =>
      post<AgentResponse>('/api/approve', { approvalId, approved }),
    getTools: () => get<ToolInfo[]>('/api/tools'),
    getSessions: () => get<SessionInfo[]>('/api/sessions'),
    getTraces: () => get<{ traceId: string; createdAt: string; stepCount: number }[]>('/api/traces'),
    getTrace: (traceId: string) => get<Trace>(`/api/traces/${traceId}`),
    getHealth: () => get<HealthResponse>('/api/health'),
  }
}
