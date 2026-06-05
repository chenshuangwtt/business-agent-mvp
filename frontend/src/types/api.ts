export type AgentResponseStatus = 'success' | 'need_approval' | 'error'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface AgentResponse {
  status: AgentResponseStatus
  traceId: string
  sessionId: string
  answer?: string
  approvalId?: string
  toolName?: string
  riskLevel?: RiskLevel
  arguments?: any
  message?: string
  code?: string
}

export interface ToolInfo {
  name: string
  description: string
  riskLevel: RiskLevel
  requiresApproval: boolean
}

export interface SkillInfo {
  name: string
  displayName: string
  description: string
  tools: string[]
  executionMode: string
  riskLevel: RiskLevel
  requiresApproval: boolean
  selection: {
    priority: number
    confidenceThreshold: number
  }
}

export interface SessionInfo {
  sessionId: string
  createdAt: string
  lastActivity: string
  messageCount: number
  traceCount: number
}

export interface TraceStep {
  id: string
  type: string
  timestamp: string
  data: any
}

export interface Trace {
  traceId: string
  steps: TraceStep[]
  createdAt: string
  updatedAt: string
}

export interface HealthResponse {
  status: string
  timestamp: string
  llmAvailable: boolean
  skills?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system' | 'approval' | 'trace'
  content: string
  timestamp: string
  approvalId?: string
  approvalData?: AgentResponse
  traceId?: string
  agentData?: AgentResponse
}
