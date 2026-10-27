<script setup lang="ts">
import { ref, watch } from 'vue'
import { AlertTriangle, Check, CheckCircle2, Loader2, X } from '@lucide/vue'
import type { AgentResponse } from '@/types/api'

const props = defineProps<{
  data: AgentResponse
  resolved: boolean
  resultLabel?: string
}>()

const emit = defineEmits<{ approve: [approvalId: string, approved: boolean] }>()
const processing = ref(false)

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
        <div class="approval-title">请确认操作</div>
        <div class="approval-subtitle">{{ data.message || '确认后将继续处理。' }}</div>
      </div>
    </header>

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
