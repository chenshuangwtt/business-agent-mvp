export type AgentResponseStatus = 'success' | 'need_approval' | 'error'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface AgentResponse {
  status: AgentResponseStatus
  traceId: string
  sessionId: string
  answer?: string
  businessData?: BusinessPresentation
  approvalId?: string
  toolName?: string
  riskLevel?: RiskLevel
  arguments?: any
  message?: string
  code?: string
}

export type BusinessMetricUnit = 'CNY' | 'percent' | 'count'
export type BusinessMetricDirection = 'up' | 'down' | 'stable' | 'unknown'
export type BusinessMetricStatus = 'favorable' | 'unfavorable' | 'warning' | 'neutral' | 'unknown'

export interface BusinessMetric {
  id: string
  label: string
  value: number | null
  unit: BusinessMetricUnit
  previousValue?: number | null
  changeValue?: number | null
  changeRate?: number | null
  percentagePointChange?: number | null
  direction: BusinessMetricDirection
  status: BusinessMetricStatus
  description?: string
}

export interface BusinessHighlight {
  title: string
  content: string
  severity: 'low' | 'medium' | 'high'
  status: BusinessMetricStatus
}

export interface BusinessBreakdownRow {
  label: string
  currentValue: number
  previousValue: number
  changeValue: number
  contributionRatio: number | null
  direction: BusinessMetricDirection
}

export interface BusinessBreakdown {
  id: string
  title: string
  description: string
  display: 'bar' | 'table'
  rows: BusinessBreakdownRow[]
}

export interface BusinessPresentation {
  summary: string
  summaryStatus: BusinessMetricStatus
  conclusions: string[]
  period: { startDate: string; endDate: string; label: string }
  comparisonPeriod: { startDate: string; endDate: string; label: string }
  metrics: BusinessMetric[]
  highlights: BusinessHighlight[]
  breakdowns: BusinessBreakdown[]
  analysis: string[]
  recommendations: string[]
  detailMarkdown: string
  dataContext: { label: string; dataNature: 'sample' | 'production' }
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
  dataEnvironment?: string
  dataCoverage?: string
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
  businessData?: BusinessPresentation
}
