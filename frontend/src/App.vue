<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  Moon,
  PanelRightOpen,
  Sun,
} from '@lucide/vue'
import { useTheme } from './composables/useTheme'
import ChatPanel from './components/ChatPanel.vue'
import ToolsList from './components/ToolsList.vue'
import TraceDrawer from './components/TraceDrawer.vue'
import type { HealthResponse } from './types/api'

const { theme, toggle } = useTheme()
const health = ref<HealthResponse | null>(null)
const sidebarOpen = ref(true)
const traceDrawerOpen = ref(false)
const activeTraceId = ref<string | null>(null)

const statusLabel = computed(() => {
  if (!health.value) return '连接中'
  return health.value.status === 'ok' ? '服务在线' : '服务异常'
})

const llmLabel = computed(() => (health.value?.llmAvailable ? 'LLM 在线' : 'Fallback 模式'))

function openTrace(traceId: string) {
  activeTraceId.value = traceId
  traceDrawerOpen.value = true
}

onMounted(async () => {
  try {
    health.value = await (await fetch('/api/health')).json()
  } catch {
    health.value = { status: 'error', timestamp: '', llmAvailable: false }
  }
})
</script>

<template>
  <div class="app-shell h-screen bg-bg text-text">
    <aside
      class="app-sidebar"
      :class="sidebarOpen ? 'w-[320px]' : 'w-0 border-r-0'"
      aria-label="Agent 能力侧栏"
    >
      <div class="sidebar-inner">
        <div class="brand-block">
          <div class="brand-mark">
            <Bot :size="20" />
          </div>
          <div class="min-w-0">
            <div class="brand-title">Business Agent</div>
            <div class="brand-subtitle">经营分析工作台</div>
          </div>
        </div>

        <div class="status-card">
          <div class="status-line">
            <span
              class="status-dot"
              :class="health?.status === 'ok' ? 'bg-success' : 'bg-danger'"
            ></span>
            <span>{{ statusLabel }}</span>
          </div>
          <div class="status-meta">
            <Activity :size="13" />
            <span>{{ llmLabel }}</span>
          </div>
        </div>

        <div class="sidebar-section-head">
          <span>Agent 能力</span>
          <span class="section-pill">7 tools</span>
        </div>

        <ToolsList />
      </div>
    </aside>

    <main class="app-main min-w-0">
      <header class="topbar">
        <div class="flex items-center gap-2">
          <button
            class="icon-button"
            type="button"
            :aria-label="sidebarOpen ? '收起侧栏' : '展开侧栏'"
            @click="sidebarOpen = !sidebarOpen"
          >
            <ChevronLeft v-if="sidebarOpen" :size="18" />
            <ChevronRight v-else :size="18" />
          </button>
          <div>
            <div class="topbar-title">新对话</div>
            <div class="topbar-subtitle">查询订单、计算指标、生成报告</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="text-button hidden sm:inline-flex"
            type="button"
            @click="traceDrawerOpen = !traceDrawerOpen"
          >
            <PanelRightOpen :size="16" />
            执行链路
          </button>
          <button
            class="icon-button"
            type="button"
            :aria-label="theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'"
            @click="toggle"
          >
            <Sun v-if="theme === 'dark'" :size="17" />
            <Moon v-else :size="17" />
          </button>
        </div>
      </header>

      <ChatPanel @open-trace="openTrace" />
    </main>

    <TraceDrawer v-model:open="traceDrawerOpen" :trace-id="activeTraceId" />
  </div>
</template>
