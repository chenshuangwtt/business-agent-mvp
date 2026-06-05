<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowUp,
  Bot,
  ExternalLink,
  FileText,
  LineChart,
  Search,
  ShieldCheck,
} from '@lucide/vue'
import { useApi } from '@/composables/useApi'
import type { ChatMessage } from '@/types/api'
import ApprovalCard from './ApprovalCard.vue'

const emit = defineEmits<{ openTrace: [traceId: string] }>()
const api = useApi()
const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const sessionId = ref<string | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const isLoading = computed(() => api.loading.value)

const suggestions = [
  { icon: Search, text: '帮我分析本周订单情况' },
  { icon: LineChart, text: '找出最近 7 天 GMV 异常波动' },
  { icon: FileText, text: '生成一份本月经营分析报告' },
  { icon: ShieldCheck, text: '查询退款率最高的商品并分析原因' },
]

let msgId = 0

function addMsg(role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>) {
  messages.value.push({
    id: `m${++msgId}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  })
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  })
}

async function sendMessage() {
  const msg = inputText.value.trim()
  if (!msg || isLoading.value) return

  inputText.value = ''
  addMsg('user', msg)

  try {
    const data = await api.sendChat(msg, sessionId.value || undefined)
    if (data.sessionId) sessionId.value = data.sessionId
    if (data.traceId) addMsg('trace', '', { traceId: data.traceId })

    if (data.status === 'success') {
      addMsg('agent', data.answer || '没有生成回答。', { agentData: data })
    } else if (data.status === 'need_approval') {
      addMsg('approval', '', { approvalId: data.approvalId, approvalData: data })
    } else {
      addMsg('system', `错误：${data.message || data.code || '未知错误'}`)
    }
  } catch (e: any) {
    addMsg('system', `请求失败：${e.message}`)
  }
}

async function handleApprove(approvalId: string, approved: boolean) {
  const card = messages.value.find((m) => m.approvalId === approvalId)

  try {
    const data = await api.approve(approvalId, approved)
    if (card) card.content = approved ? '已批准' : '已拒绝'
    if (data.traceId) addMsg('trace', '', { traceId: data.traceId })

    if (data.status === 'success') {
      addMsg('agent', data.answer || '操作已完成。', { agentData: data })
    } else {
      addMsg('system', `错误：${data.message || data.code || '未知错误'}`)
    }
  } catch (e: any) {
    if (card) card.content = ''
    addMsg('system', `审批失败：${e.message}`)
  }
}

function useSuggestion(text: string) {
  inputText.value = text
  sendMessage()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderMd(md: string): string {
  if (!md) return ''

  const lines = md.split('\n')
  const out: string[] = []
  let table: string[][] = []
  let inList = false
  let inOrderedList = false

  const flushList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    if (inOrderedList) {
      out.push('</ol>')
      inOrderedList = false
    }
  }

  const flushTable = () => {
    if (!table.length) return
    const [head, ...rows] = table
    out.push('<table>')
    out.push(`<thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`)
    out.push('<tbody>')
    for (const row of rows) {
      out.push(`<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    }
    out.push('</tbody></table>')
    table = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        flushList()
        table.push(cells)
      }
      continue
    }

    flushTable()

    if (!trimmed) {
      flushList()
      continue
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList()
      out.push('<hr>')
    } else if (trimmed.startsWith('### ')) {
      flushList()
      out.push(`<h4>${renderInline(trimmed.slice(4))}</h4>`)
    } else if (trimmed.startsWith('## ')) {
      flushList()
      out.push(`<h3>${renderInline(trimmed.slice(3))}</h3>`)
    } else if (trimmed.startsWith('# ')) {
      flushList()
      out.push(`<h2>${renderInline(trimmed.slice(2))}</h2>`)
    } else if (/^[-*]\s+/.test(trimmed)) {
      if (inOrderedList) {
        out.push('</ol>')
        inOrderedList = false
      }
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${renderInline(trimmed.replace(/^[-*]\s+/, ''))}</li>`)
    } else if (/^\d+\.\s+/.test(trimmed)) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      if (!inOrderedList) {
        out.push('<ol>')
        inOrderedList = true
      }
      out.push(`<li>${renderInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`)
    } else {
      flushList()
      out.push(`<p>${renderInline(trimmed)}</p>`)
    }
  }

  flushTable()
  flushList()
  return out.join('')
}
</script>

<template>
  <section class="chat-panel">
    <div ref="scrollEl" class="chat-scroll">
      <div class="chat-width">
        <div v-if="messages.length === 0" class="welcome-screen">
          <div class="welcome-copy">
            <div class="welcome-mark">
              <Bot :size="28" />
            </div>
            <p class="eyebrow">经营分析 Agent</p>
            <h1>把订单数据变成可执行的经营判断</h1>
            <p>
              你可以直接问订单、GMV、退款、异常和报告导出。需要高风险动作时，系统会先停下来让你审批。
            </p>
          </div>

          <div class="suggestion-grid">
            <button
              v-for="item in suggestions"
              :key="item.text"
              class="suggestion-card"
              type="button"
              @click="useSuggestion(item.text)"
            >
              <component :is="item.icon" :size="18" />
              <span>{{ item.text }}</span>
            </button>
          </div>
        </div>

        <template v-for="msg in messages" :key="msg.id">
          <div v-if="msg.role === 'user'" class="message-row justify-end">
            <div class="user-bubble">{{ msg.content }}</div>
          </div>

          <div v-else-if="msg.role === 'agent'" class="message-row">
            <div class="agent-avatar">
              <Bot :size="15" />
            </div>
            <div class="agent-bubble agent-content" v-html="renderMd(msg.content)"></div>
          </div>

          <div v-else-if="msg.role === 'trace' && msg.traceId" class="trace-row">
            <button class="trace-link" type="button" @click="emit('openTrace', msg.traceId!)">
              <ExternalLink :size="13" />
              查看执行链路
            </button>
          </div>

          <div v-else-if="msg.role === 'system'" class="system-message">
            {{ msg.content }}
          </div>

          <div v-else-if="msg.role === 'approval' && msg.approvalData" class="message-row">
            <div class="agent-spacer"></div>
            <ApprovalCard
              :data="msg.approvalData"
              :resolved="msg.content === '已批准' || msg.content === '已拒绝'"
              :result-label="msg.content"
              @approve="(id, ok) => handleApprove(id, ok)"
            />
          </div>
        </template>

        <div v-if="isLoading" class="message-row">
          <div class="agent-avatar">
            <Bot :size="15" />
          </div>
          <div class="typing-bubble" aria-label="Agent 正在处理">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>

    <div class="composer-shell">
      <div class="composer">
        <textarea
          v-model="inputText"
          placeholder="输入你想分析的经营问题..."
          rows="1"
          @keydown="onKeydown"
        ></textarea>
        <button
          class="send-button"
          type="button"
          :disabled="isLoading || !inputText.trim()"
          aria-label="发送"
          @click="sendMessage"
        >
          <ArrowUp :size="18" :stroke-width="2.5" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 12px;
}

.agent-content :deep(th),
.agent-content :deep(td) {
  border: 1px solid var(--c-border);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.agent-content :deep(th) {
  background: var(--c-bg-muted);
  color: var(--c-text);
  font-weight: 650;
}

.agent-content :deep(code) {
  background: var(--c-bg-muted);
  border: 1px solid var(--c-border-light);
  border-radius: 5px;
  font-size: 12px;
  padding: 1px 5px;
}

.agent-content :deep(h2),
.agent-content :deep(h3),
.agent-content :deep(h4) {
  color: var(--c-text);
  font-weight: 700;
  line-height: 1.25;
  margin: 16px 0 8px;
}

.agent-content :deep(h2) { font-size: 18px; }
.agent-content :deep(h3) { font-size: 15px; }
.agent-content :deep(h4) { font-size: 14px; }

.agent-content :deep(p) {
  margin: 0 0 10px;
}

.agent-content :deep(p:last-child) {
  margin-bottom: 0;
}

.agent-content :deep(ul) {
  margin: 8px 0 12px 18px;
}

.agent-content :deep(li) {
  margin: 4px 0;
}

.agent-content :deep(strong) {
  font-weight: 700;
}

.agent-content :deep(hr) {
  border: 0;
  border-top: 1px solid var(--c-border);
  margin: 14px 0;
}
</style>
