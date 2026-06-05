<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  RefreshCw,
  Wrench,
  X,
  XCircle,
  Zap,
} from '@lucide/vue'
import type { Trace, TraceStep } from '@/types/api'

const props = defineProps<{ traceId: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const trace = ref<Trace | null>(null)
const loading = ref(false)
const expanded = ref<Set<string>>(new Set())

watch(
  () => [props.traceId, open.value] as const,
  async ([id, isOpen]) => {
    if (!id) {
      trace.value = null
      return
    }
    if (!isOpen) return

    loading.value = true
    try {
      trace.value = await (await fetch(`/api/traces/${id}`)).json()
    } catch {
      trace.value = null
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

const stats = computed(() => {
  if (!trace.value) return null
  let tools = 0
  let errors = 0
  let rounds = 0
  let duration = 0

  for (const step of trace.value.steps) {
    if (step.type === 'tool_call') tools += 1
    if (step.type === 'tool_error') errors += 1
    if (step.type === 'llm_request') rounds += 1
    if (step.data?.duration) duration += step.data.duration
  }

  return { total: trace.value.steps.length, tools, errors, rounds, duration }
})

const maxDur = computed(() => {
  if (!trace.value) return 1
  const values = trace.value.steps.map((s) => s.data?.duration || 0)
  return Math.max(...values, 1)
})

const META: Record<string, { label: string; icon: any; tone: string }> = {
  user_message: { label: '用户输入', icon: MessageSquare, tone: 'trace-accent' },
  llm_request: { label: 'LLM 请求', icon: Brain, tone: 'trace-accent' },
  llm_response: { label: 'LLM 响应', icon: Brain, tone: 'trace-accent' },
  tool_decision: { label: '工具决策', icon: Wrench, tone: 'trace-neutral' },
  tool_call: { label: '工具调用', icon: Zap, tone: 'trace-accent' },
  tool_result: { label: '工具结果', icon: CheckCircle2, tone: 'trace-success' },
  tool_error: { label: '工具错误', icon: XCircle, tone: 'trace-danger' },
  approval_required: { label: '等待审批', icon: AlertTriangle, tone: 'trace-warning' },
  approval_result: { label: '审批结果', icon: AlertTriangle, tone: 'trace-warning' },
  fallback: { label: '降级处理', icon: RefreshCw, tone: 'trace-warning' },
  final_answer: { label: '最终回答', icon: FileText, tone: 'trace-success' },
}

function meta(type: string) {
  return META[type] || { label: type, icon: Activity, tone: 'trace-neutral' }
}

function toolBatchText(data: any) {
  const names = Array.isArray(data.toolNames) ? data.toolNames.filter(Boolean) : []
  const count =
    typeof data.toolCount === 'number'
      ? data.toolCount
      : typeof data.count === 'number'
        ? data.count
        : names.length

  if (count > 0) return `并发 ${count} 个工具`
  if (names.length > 0) return `并发工具：${names.join('、')}`
  return '并发工具调用'
}

function summary(step: TraceStep): string {
  const data = step.data || {}
  switch (step.type) {
    case 'user_message':
      return (data.content || '').slice(0, 60)
    case 'llm_request':
      return `${data.model || 'model'} · ${data.messagesCount || 0} 条消息`
    case 'llm_response':
      return data.hasToolCalls ? '模型请求调用工具' : '模型给出回答'
    case 'tool_decision':
      return data.batch ? toolBatchText(data) : data.toolName || '工具决策'
    case 'tool_call':
      return data.concurrent ? toolBatchText(data) : data.toolName || '工具调用'
    case 'tool_result':
      return `${data.toolName || 'tool'} · ${data.duration || 0}ms`
    case 'tool_error':
      return `${data.code || 'ERROR'}：${(data.message || '').slice(0, 40)}`
    case 'approval_required':
      return `${data.toolName || 'tool'} 需要确认`
    case 'approval_result':
      return data.approved ? '用户已批准' : '用户已拒绝'
    case 'fallback':
      return data.reason || data.toolName || '使用降级策略'
    case 'final_answer':
      return (data.content || '').slice(0, 60)
    default:
      return JSON.stringify(data).slice(0, 60)
  }
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
</script>

<template>
  <Transition name="drawer">
    <aside v-if="open" class="trace-drawer" aria-label="执行链路">
      <header class="trace-header">
        <div>
          <h2>执行链路</h2>
          <p>{{ traceId || '暂无 trace' }}</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭执行链路" @click="open = false">
          <X :size="16" />
        </button>
      </header>

      <div v-if="loading" class="drawer-state">
        <RefreshCw :size="15" class="animate-spin" />
        加载中
      </div>

      <div v-else-if="!trace" class="drawer-state">
        暂无数据
      </div>

      <template v-else>
        <div v-if="stats" class="trace-stats">
          <div>
            <strong>{{ stats.total }}</strong>
            <span>步骤</span>
          </div>
          <div>
            <strong>{{ stats.tools }}</strong>
            <span>工具</span>
          </div>
          <div>
            <strong>{{ stats.errors }}</strong>
            <span>错误</span>
          </div>
          <div>
            <Clock :size="13" />
            <span>{{ stats.duration }}ms</span>
          </div>
        </div>

        <div class="trace-list">
          <div v-for="(step, i) in trace.steps" :key="step.id" class="trace-item">
            <button class="trace-step" type="button" @click="toggle(`${traceId}-${i}`)">
              <span class="trace-rail" :class="meta(step.type).tone"></span>
              <span class="trace-step-icon" :class="meta(step.type).tone">
                <component :is="meta(step.type).icon" :size="13" />
              </span>
              <span class="trace-step-body">
                <strong>{{ meta(step.type).label }}</strong>
                <span>{{ summary(step) }}</span>
              </span>
              <span v-if="step.data?.duration != null" class="trace-duration">
                {{ step.data.duration }}ms
              </span>
            </button>

            <div v-if="step.data?.duration != null" class="duration-track">
              <div
                :class="meta(step.type).tone"
                :style="{ width: Math.max(8, (step.data.duration / maxDur) * 100) + '%' }"
              ></div>
            </div>

            <div v-if="expanded.has(`${traceId}-${i}`)" class="trace-json">
              <pre>{{ JSON.stringify(step.data, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </template>
    </aside>
  </Transition>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: width 180ms ease, opacity 180ms ease;
}

.drawer-enter-from,
.drawer-leave-to {
  width: 0;
  opacity: 0;
}
</style>
