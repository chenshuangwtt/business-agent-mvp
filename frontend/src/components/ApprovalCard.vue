<script setup lang="ts">
import { ref, watch } from 'vue'
import { AlertTriangle, Check, CheckCircle2, Loader2, X } from '@lucide/vue'
import type { AgentResponse, RiskLevel } from '@/types/api'

const props = defineProps<{
  data: AgentResponse
  resolved: boolean
  resultLabel?: string
}>()

const emit = defineEmits<{ approve: [approvalId: string, approved: boolean] }>()
const processing = ref(false)

const riskLabel: Record<RiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
}

const riskTone: Record<RiskLevel, string> = {
  low: 'risk-low',
  medium: 'risk-medium',
  high: 'risk-high',
  critical: 'risk-critical',
}

watch(
  () => props.resolved,
  (resolved) => {
    if (resolved) processing.value = false
  }
)

function doApprove(approved: boolean) {
  if (!props.data.approvalId || processing.value || props.resolved) return
  processing.value = true
  emit('approve', props.data.approvalId, approved)
}
</script>

<template>
  <article class="approval-card">
    <header>
      <div class="approval-icon">
        <AlertTriangle :size="16" />
      </div>
      <div>
        <div class="approval-title">需要审批</div>
        <div class="approval-subtitle">该工具会执行中高风险动作，请确认后继续</div>
      </div>
    </header>

    <dl class="approval-meta">
      <div>
        <dt>工具</dt>
        <dd>{{ data.toolName }}</dd>
      </div>
      <div>
        <dt>风险</dt>
        <dd>
          <span class="risk-pill" :class="riskTone[data.riskLevel || 'medium']">
            {{ riskLabel[data.riskLevel || 'medium'] }}
          </span>
        </dd>
      </div>
    </dl>

    <div class="approval-args">
      <div class="args-label">参数</div>
      <pre>{{ JSON.stringify(data.arguments, null, 2) }}</pre>
    </div>

    <footer>
      <div v-if="resolved" class="resolved-state">
        <CheckCircle2 :size="15" />
        {{ resultLabel || '已处理' }}
      </div>
      <div v-else-if="processing" class="processing-state">
        <Loader2 :size="15" class="animate-spin" />
        处理中...
      </div>
      <template v-else>
        <button class="approve-button" type="button" @click="doApprove(true)">
          <Check :size="15" />
          批准
        </button>
        <button class="reject-button" type="button" @click="doApprove(false)">
          <X :size="15" />
          拒绝
        </button>
      </template>
    </footer>
  </article>
</template>
