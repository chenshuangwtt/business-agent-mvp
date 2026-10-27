import { z } from "zod";
import { getDataset } from "../business/datasetStore.js";
import { runDiagnosis } from "../business/diagnosisEngine.js";
import type { DiagnosisState } from "../business/types.js";
import type { AgentTool, ToolContext } from "../agent/types.js";

const states = new Map<string, DiagnosisState>();
const InputSchema = z.object({ dataset_id: z.string().min(1), question: z.string().min(1) });

export const diagnoseBusinessTool: AgentTool = {
  name: "diagnose_business",
  description: "以服务端状态机完成动态经营诊断：先比较，再按贡献选择商品、渠道或退款原因下钻。",
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { dataset_id, question } = InputSchema.parse(args);
    const dataset = getDataset(dataset_id);
    const state = runDiagnosis({ datasetId: dataset_id, userQuestion: question, query: dataset.query, data: dataset.data });
    states.set(state.diagnosis_id, state);
    context.logger(`动态诊断完成: ${state.steps.length} 步, ${state.stop_reason}`);
    return { diagnosis_id: state.diagnosis_id, goal: state.goal, comparison: state.comparison, anomalies: state.anomalies, contributions: state.contributions.slice(0, 12), steps: state.steps, stop_reason: state.stop_reason, uncertainties: state.uncertainties };
  },
};

export function getDiagnosisState(diagnosisId: string): DiagnosisState | undefined { return states.get(diagnosisId); }

export function getBusinessDiagnosisAnomaly(anomalyId: string) {
  for (const state of states.values()) {
    const anomaly = state.anomalies.find((item) => item.anomaly_id === anomalyId);
    if (anomaly) return anomaly;
  }
  return undefined;
}
