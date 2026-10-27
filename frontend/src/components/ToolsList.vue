<script setup lang="ts">
import { AlertTriangle, BarChart3, FileText, Search } from '@lucide/vue'

const capabilities = [
  { label: '经营概览', desc: '查看支付、退款、净收入与周期变化', icon: BarChart3 },
  { label: '异常排查', desc: '定位退款、渠道、商品和异常购买信号', icon: AlertTriangle },
  { label: '明细核查', desc: '按时间、渠道和地区梳理业务证据', icon: Search },
  { label: '报告交付', desc: '生成经营报告，交付前需确认', icon: FileText },
]
</script>

<template>
  <div class="tools-list">
    <article v-for="item in capabilities" :key="item.label" class="tool-card">
      <div class="tool-icon">
        <component :is="item.icon" :size="16" />
      </div>
      <div class="tool-body">
        <h3>{{ item.label }}</h3>
        <p>{{ item.desc }}</p>
      </div>
    </article>
  </div>
</template>
