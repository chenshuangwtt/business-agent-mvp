export interface OrderRecord {
  order_id: string;
  customer_id: string;
  created_at: string;
  channel: string;
  region: string;
  order_status: "paid" | "cancelled" | "payment_failed" | "refunded" | "partially_refunded";
}

export interface OrderItemRecord {
  order_item_id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  line_amount_cents: number;
}

export interface PaymentRecord {
  payment_id: string;
  order_id: string;
  payment_status: "success" | "failed";
  amount_cents: number;
  succeeded_at: string;
}

export interface RefundRecord {
  refund_id: string;
  payment_id: string;
  order_id: string;
  refund_status: "success" | "pending" | "failed";
  refund_amount_cents: number;
  completed_at: string;
  refund_reason: string;
}

export interface ProductRecord {
  product_id: string;
  product_name: string;
  category: string;
  price_cents: number;
}

export interface CustomerRecord {
  customer_id: string;
  customer_name: string;
  customer_level: string;
  registered_at: string;
}

export interface BusinessDataModel {
  orders: OrderRecord[];
  orderItems: OrderItemRecord[];
  payments: PaymentRecord[];
  refunds: RefundRecord[];
  products: ProductRecord[];
  customers: CustomerRecord[];
}

export interface BusinessQuery {
  start_date: string;
  end_date: string;
  channel?: string;
  region?: string;
  product_id?: string;
}

export interface DatasetSummary {
  dataset_id: string;
  record_count: number;
  query: BusinessQuery;
  source: string;
  expires_at: string;
}

export interface MetricSnapshot {
  period: { start_date: string; end_date: string; label: string };
  created_order_count: number;
  successful_payment_order_count: number;
  successful_payment_amount_cents: number;
  successful_refund_amount_cents: number;
  net_cash_inflow_cents: number;
  average_paid_order_amount_cents: number | null;
  refund_to_payment_ratio: number | null;
  by_channel: Record<string, DimensionMetric>;
  by_region: Record<string, DimensionMetric>;
  by_category: Record<string, DimensionMetric>;
}

export interface DimensionMetric {
  successful_payment_amount_cents: number;
  successful_refund_amount_cents: number;
  net_cash_inflow_cents: number;
}

export interface MetricChange {
  current: number;
  previous: number;
  absolute_change: number;
  change_rate: number | null;
  change_rate_status: "calculated" | "not_calculable";
}

export interface PeriodComparison {
  comparison_id: string;
  dataset_id: string;
  current: MetricSnapshot;
  previous: MetricSnapshot;
  changes: {
    successful_payment_amount_cents: MetricChange;
    successful_refund_amount_cents: MetricChange;
    net_cash_inflow_cents: MetricChange;
    refund_to_payment_ratio: {
      current: number | null;
      previous: number | null;
      percentage_point_change: number | null;
    };
  };
  filters: Omit<BusinessQuery, "start_date" | "end_date">;
}

export interface DiagnosisAnomaly {
  anomaly_id: string;
  dataset_id: string;
  type: "refund_ratio_increase" | "channel_sales_decline" | "product_sales_change" | "high_frequency_ordering";
  severity: "low" | "medium" | "high";
  title: string;
  trigger: string;
  facts: string[];
  comparison_id: string;
  dimensions: Array<"product" | "channel" | "region" | "refund_reason" | "customer">;
  scope?: { channel?: string; product_id?: string; customer_id?: string; date?: string };
}

export type DiagnosisGoal = "refund_increase" | "refund_contribution" | "channel_decline" | "product_change" | "behavior_risk" | "general_health";
export type AnalysisDimension = "overall" | "product" | "channel" | "region" | "refund_reason" | "customer";

export interface DimensionContribution {
  dimension: AnalysisDimension;
  value: string;
  current_amount_cents: number;
  previous_amount_cents: number;
  delta_amount_cents: number;
  contribution_ratio: number | null;
  record_count: number;
}

export interface DiagnosisStep {
  step: number;
  action: string;
  reason: string;
  dimension?: AnalysisDimension;
  result_summary: string;
}

export interface DiagnosisState {
  diagnosis_id: string;
  user_question: string;
  goal: DiagnosisGoal;
  dataset_id: string;
  query: BusinessQuery;
  comparison: PeriodComparison;
  confirmed_facts: string[];
  anomalies: DiagnosisAnomaly[];
  analyzed_dimensions: AnalysisDimension[];
  pending_questions: string[];
  evidence: Array<{ source: string; summary: string }>;
  contributions: DimensionContribution[];
  steps: DiagnosisStep[];
  depth: number;
  continue_analysis: boolean;
  stop_reason: string;
  uncertainties: string[];
}
