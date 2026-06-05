# 经营分析简报

**报告周期**：{{period}}
**生成时间**：{{generated_at}}
**数据来源**：{{data_source}}

---

## 1. 核心结论

{{conclusion}}

---

## 2. 核心指标

| 指标 | 数值 | 说明 |
|---|---:|---|
| GMV（总交易额） | ¥{{gmv}} | 所有订单总金额 |
| 净销售额 | ¥{{net_sales}} | 有效支付订单金额 |
| 订单数 | {{order_count}} 笔 | 总订单数量 |
| 有效订单数 | {{paid_orders}} 笔 | 已支付订单数量 |
| 退款金额 | ¥{{refund_amount}} | 总退款金额 |
| 退款率 | {{refund_rate}}% | 退款金额占 GMV 比例 |
| 客单价 | ¥{{avg_order_value}} | 平均每笔有效订单金额 |

### 渠道分布

| 渠道 | 销售额 | 占比 |
|---|---:|---:|
{{channel_rows}}

### 地区分布

| 地区 | 销售额 | 占比 |
|---|---:|---:|
{{region_rows}}

### 热门品类

| 品类 | 销售额 | 订单数 |
|---|---:|---:|
{{category_rows}}

---

## 3. 异常发现

{{anomalies}}

---

## 4. 原因分析

{{analysis}}

---

## 5. 建议动作

{{recommendations}}

---

## 6. 数据来源

- **订单数据**：`data/orders.csv`，查询时间范围 {{period}}
- **业务规则**：`data/business_rules.md`、`data/company_policy.md`
- **指标计算**：使用 `calculate_metrics` 工具确定性计算
- **异常识别**：使用 `find_anomalies` 工具基于规则识别
- **报告生成**：{{report_method}}

---

## 7. 风险提示

{{risk_notes}}
