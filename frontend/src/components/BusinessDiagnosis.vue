<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, CircleMinus, CircleHelp, Info } from '@lucide/vue'
import type { BusinessBreakdownRow, BusinessMetric, BusinessMetricDirection, BusinessPresentation } from '@/types/api'

const props = defineProps<{ data: BusinessPresentation }>()

const periodLabel = computed(() => `${props.data.period.label}，对照 ${props.data.comparisonPeriod.label}`)

function formatMoney(value: number) {
  return `¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatValue(metric: BusinessMetric) {
  if (metric.value === null || !Number.isFinite(metric.value)) return '暂无数据'
  if (metric.unit === 'CNY') return formatMoney(metric.value)
  if (metric.unit === 'percent') return `${(metric.value * 100).toFixed(1)}%`
  return metric.value.toLocaleString('zh-CN')
}

function compareLabel(metric: BusinessMetric) {
  if (metric.percentagePointChange !== undefined && metric.percentagePointChange !== null) {
    return `${metric.percentagePointChange >= 0 ? '上升' : '下降'} ${Math.abs(metric.percentagePointChange * 100).toFixed(1)} 个百分点`
  }
  if (metric.changeRate !== undefined && metric.changeRate !== null) {
    return `${metric.changeRate >= 0 ? '上涨' : '下降'} ${Math.abs(metric.changeRate * 100).toFixed(1)}%`
  }
  if (metric.changeValue !== undefined && metric.changeValue !== null && metric.unit === 'CNY') {
    return `${metric.changeValue >= 0 ? '增加' : '减少'} ${formatMoney(metric.changeValue)}`
  }
  return metric.description || '暂无可比基数'
}

function iconFor(direction: BusinessMetricDirection) {
  if (direction === 'up') return ArrowUp
  if (direction === 'down') return ArrowDown
  if (direction === 'stable') return CircleMinus
  return CircleHelp
}

function directionClass(direction: BusinessMetricDirection) {
  return `direction-${direction}`
}

function changeText(row: BusinessBreakdownRow) {
  const action = row.changeValue > 0 ? '增加' : row.changeValue < 0 ? '减少' : '持平'
  return row.changeValue === 0 ? '与对照周期持平' : `${action} ${formatMoney(row.changeValue)}`
}

function shareText(row: BusinessBreakdownRow) {
  return row.contributionRatio === null ? '暂无可比基数' : `贡献 ${Math.abs(row.contributionRatio * 100).toFixed(1)}%`
}

function maxMagnitude(rows: BusinessBreakdownRow[]) {
  return Math.max(...rows.map((row) => Math.abs(row.changeValue)), 1)
}

function barWidth(row: BusinessBreakdownRow, rows: BusinessBreakdownRow[]) {
  return `${Math.max((Math.abs(row.changeValue) / maxMagnitude(rows)) * 100, 5)}%`
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderDetail(markdown: string) {
  const lines = markdown.split('\n')
  const output: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) output.push('</ul>')
    inList = false
  }

  for (const line of lines) {
    const text = line.trim()
    if (!text) {
      closeList()
      continue
    }
    if (text.startsWith('## ')) {
      closeList()
      output.push(`<h3>${escapeHtml(text.slice(3))}</h3>`)
    } else if (/^[-*]\s+/.test(text)) {
      if (!inList) {
        output.push('<ul>')
        inList = true
      }
      output.push(`<li>${escapeHtml(text.replace(/^[-*]\s+/, ''))}</li>`)
    } else {
      closeList()
      output.push(`<p>${escapeHtml(text)}</p>`)
    }
  }
  closeList()
  return output.join('')
}
</script>

<template>
  <section class="business-diagnosis" aria-label="经营诊断结果">
    <p class="diagnosis-period">{{ periodLabel }}</p>

    <div class="kpi-grid">
      <article
        v-for="metric in data.metrics"
        :key="metric.id"
        class="kpi-card"
        :class="directionClass(metric.direction)"
      >
        <span class="kpi-label">{{ metric.label }}</span>
        <strong>{{ formatValue(metric) }}</strong>
        <div class="kpi-change" :class="directionClass(metric.direction)">
          <component :is="iconFor(metric.direction)" :size="14" />
          <span>{{ compareLabel(metric) }}</span>
        </div>
      </article>
    </div>

    <section class="diagnosis-summary">
      <Info :size="18" />
      <div>
        <h2>核心结论</h2>
        <p v-for="line in data.conclusions" :key="line">{{ line }}</p>
      </div>
    </section>

    <section v-if="data.breakdowns.length" class="breakdown-section">
      <h2>变化来源分析</h2>
      <article v-for="breakdown in data.breakdowns" :key="breakdown.id" class="breakdown-card">
        <div class="breakdown-heading">
          <h3>{{ breakdown.title }}</h3>
          <p>{{ breakdown.description }}</p>
        </div>

        <div v-if="breakdown.display === 'bar'" class="bar-list">
          <div v-for="row in breakdown.rows" :key="row.label" class="bar-row">
            <div class="bar-label-line">
              <strong>{{ row.label }}</strong>
              <span :class="directionClass(row.direction)">{{ changeText(row) }}</span>
            </div>
            <div class="bar-track" aria-hidden="true">
              <span :class="directionClass(row.direction)" :style="{ width: barWidth(row, breakdown.rows) }"></span>
            </div>
            <p>当前 {{ formatMoney(row.currentValue) }}，对照 {{ formatMoney(row.previousValue) }}，{{ shareText(row) }}</p>
          </div>
        </div>

        <div v-else class="breakdown-table-wrap">
          <table>
            <thead>
              <tr><th>项目</th><th>当前</th><th>对照</th><th>变化</th><th>贡献</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in breakdown.rows" :key="row.label">
                <td>{{ row.label }}</td>
                <td>{{ formatMoney(row.currentValue) }}</td>
                <td>{{ formatMoney(row.previousValue) }}</td>
                <td :class="directionClass(row.direction)">{{ changeText(row) }}</td>
                <td>{{ shareText(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="analysis-section">
      <h2>业务解释</h2>
      <p v-for="paragraph in data.analysis" :key="paragraph">{{ paragraph }}</p>
    </section>

    <section v-if="data.recommendations.length" class="recommendation-section">
      <h2>建议措施</h2>
      <ol>
        <li v-for="item in data.recommendations" :key="item">{{ item }}</li>
      </ol>
    </section>

    <details class="diagnosis-detail">
      <summary>查看完整分析依据</summary>
      <div class="detail-markdown" v-html="renderDetail(data.detailMarkdown)"></div>
    </details>
    <p class="data-context">{{ data.dataContext.label }}</p>
  </section>
</template>

<style scoped>
.business-diagnosis { flex: 1; min-width: 0; color: var(--c-text-secondary); }
.diagnosis-period { margin: 2px 0 10px; color: var(--c-text-muted); font-size: 12px; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.kpi-card { min-width: 0; padding: 12px; border: 1px solid var(--c-border); border-radius: 8px; background: var(--c-bg-card); }
.kpi-label { display: block; min-height: 16px; color: var(--c-text-muted); font-size: 11px; font-weight: 700; }
.kpi-card > strong { display: block; margin: 8px 0 5px; color: var(--c-text); font-size: 19px; line-height: 1.2; overflow-wrap: anywhere; }
.kpi-change { display: flex; align-items: center; gap: 4px; min-height: 18px; font-size: 12px; font-weight: 700; }
.direction-up { color: var(--c-danger); }
.direction-down { color: var(--c-success); }
.direction-stable { color: var(--c-text-secondary); }
.direction-unknown { color: var(--c-text-muted); }
.kpi-card.direction-up { border-color: color-mix(in srgb, var(--c-danger), transparent 68%); }
.kpi-card.direction-down { border-color: color-mix(in srgb, var(--c-success), transparent 68%); }
.diagnosis-summary { display: flex; gap: 10px; margin: 14px 0; padding: 12px 0; border-top: 1px solid var(--c-border-light); border-bottom: 1px solid var(--c-border-light); color: var(--c-text); }
.diagnosis-summary > svg { flex-shrink: 0; margin-top: 2px; color: var(--c-text-secondary); }
.diagnosis-summary h2, .breakdown-section > h2, .analysis-section h2, .recommendation-section h2 { margin: 0 0 6px; color: var(--c-text); font-size: 14px; font-weight: 780; }
.diagnosis-summary p, .analysis-section p { margin: 4px 0; color: var(--c-text-secondary); font-size: 13px; line-height: 1.6; }
.breakdown-section { margin: 14px 0; }
.breakdown-card { padding: 12px 0; border-top: 1px solid var(--c-border-light); }
.breakdown-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.breakdown-heading h3 { margin: 0; color: var(--c-text); font-size: 13px; }
.breakdown-heading p { margin: 0; color: var(--c-text-muted); font-size: 11px; line-height: 1.45; text-align: right; }
.bar-list { display: grid; gap: 11px; }
.bar-label-line { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
.bar-label-line strong { color: var(--c-text); font-weight: 700; }.bar-label-line span { white-space: nowrap; font-weight: 700; }
.bar-track { height: 6px; margin-top: 5px; overflow: hidden; border-radius: 4px; background: var(--c-bg-muted); }.bar-track span { display: block; height: 100%; border-radius: inherit; background: currentColor; }
.bar-row p { margin: 4px 0 0; color: var(--c-text-muted); font-size: 11px; line-height: 1.45; }
.breakdown-table-wrap { overflow-x: auto; }.breakdown-table-wrap table { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 12px; }.breakdown-table-wrap th, .breakdown-table-wrap td { padding: 8px 9px; border-bottom: 1px solid var(--c-border-light); text-align: left; white-space: nowrap; }.breakdown-table-wrap th { color: var(--c-text-muted); font-size: 11px; font-weight: 700; }.breakdown-table-wrap td:first-child { color: var(--c-text); font-weight: 650; }
.analysis-section, .recommendation-section { margin: 14px 0; padding-top: 12px; border-top: 1px solid var(--c-border-light); }
.recommendation-section ol { margin: 6px 0 0 20px; padding: 0; color: var(--c-text-secondary); font-size: 13px; line-height: 1.6; }.recommendation-section li { margin: 4px 0; }
.diagnosis-detail { margin-top: 14px; border-top: 1px solid var(--c-border-light); padding-top: 10px; }.diagnosis-detail summary { color: var(--c-text); cursor: pointer; font-size: 13px; font-weight: 750; }.detail-markdown { margin-top: 10px; color: var(--c-text-secondary); }.detail-markdown :deep(h3) { margin: 14px 0 6px; color: var(--c-text); font-size: 13px; }.detail-markdown :deep(p) { margin: 0 0 8px; }.detail-markdown :deep(ul) { margin: 5px 0 10px 18px; padding: 0; }.detail-markdown :deep(li) { margin: 4px 0; }
.data-context { margin: 12px 0 0; color: var(--c-text-muted); font-size: 11px; line-height: 1.5; }
@media (max-width: 760px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.kpi-card > strong { font-size: 17px; }.breakdown-heading { display: block; }.breakdown-heading p { margin-top: 3px; text-align: left; } }
@media (max-width: 380px) { .kpi-grid { grid-template-columns: 1fr; } }
</style>
