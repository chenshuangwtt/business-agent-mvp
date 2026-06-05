<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Download,
  FileText,
  Mail,
  Search,
} from '@lucide/vue'
import type { ToolInfo } from '@/types/api'

const tools = ref<ToolInfo[]>([])

const toolDisplay: Record<string, { label: string; desc: string; icon: any }> = {
  query_orders: {
    label: '订单查询',
    desc: '按时间、状态、渠道和地区读取订单数据',
    icon: Search,
  },
  calculate_metrics: {
    label: '指标计算',
    desc: '计算 GMV、净销售额、退款率和客单价',
    icon: BarChart3,
  },
  find_anomalies: {
    label: '异常发现',
    desc: '识别大额订单、高退款和疑似刷单',
    icon: AlertTriangle,
  },
  search_business_rules: {
    label: '规则检索',
    desc: '检索指标口径、业务规则和权限策略',
    icon: BookOpen,
  },
  generate_report: {
    label: '报告生成',
    desc: '生成 Markdown 经营分析报告',
    icon: FileText,
  },
  export_report: {
    label: '导出报告',
    desc: '写入 reports 目录，需要审批',
    icon: Download,
  },
  send_report_email: {
    label: '发送邮件',
    desc: '模拟发送报告邮件，需要审批',
    icon: Mail,
  },
}

const riskLabel: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高',
}

onMounted(async () => {
  try {
    tools.value = await (await fetch('/api/tools')).json()
  } catch {
    tools.value = []
  }
})
</script>

<template>
  <div class="tools-list">
    <div v-if="!tools.length" class="tools-empty">工具列表加载中...</div>

    <article v-for="tool in tools" :key="tool.name" class="tool-card">
      <div class="tool-icon">
        <component :is="toolDisplay[tool.name]?.icon" :size="16" />
      </div>
      <div class="tool-body">
        <div class="tool-head">
          <h3>{{ toolDisplay[tool.name]?.label || tool.name }}</h3>
          <span class="risk-mini" :class="`risk-${tool.riskLevel}`">
            {{ riskLabel[tool.riskLevel] || tool.riskLevel }}
          </span>
        </div>
        <p>{{ toolDisplay[tool.name]?.desc || tool.description }}</p>
        <div class="tool-foot">
          <code>{{ tool.name }}</code>
          <span v-if="tool.requiresApproval">需审批</span>
        </div>
      </div>
    </article>
  </div>
</template>
