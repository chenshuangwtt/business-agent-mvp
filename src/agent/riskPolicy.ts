import type { RiskLevel } from "./types.js";

export function checkPermission(riskLevel: RiskLevel): {
  allowed: boolean;
  reason?: string;
} {
  if (riskLevel === "critical") {
    return {
      allowed: false,
      reason: "该操作属于 Critical 风险，已拒绝执行",
    };
  }
  return { allowed: true };
}

export function getRiskLevelLabel(riskLevel: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
    critical: "极高风险",
  };
  return labels[riskLevel];
}
