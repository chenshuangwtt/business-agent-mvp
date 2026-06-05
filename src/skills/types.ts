import type { RiskLevel } from "../agent/types.js";

export interface SkillDefinition {
  name: string;
  displayName: string;
  metadata: Record<string, string>;
  description: string;
  triggers: string[];
  tools: string[];
  workflow: string[];
  executionMode: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  outputFormat: string;
  selection: {
    priority: number;
    confidenceThreshold: number;
  };
  constraints: string[];
  expectedSections: string[];
  approval?: {
    requiredTools: string[];
    policy: string;
  };
  prompt: string;
}

export interface SkillInfo {
  name: string;
  displayName: string;
  description: string;
  tools: string[];
  executionMode: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  selection: {
    priority: number;
    confidenceThreshold: number;
  };
}

export interface SkillSelection {
  selectedSkill: SkillDefinition | null;
  confidence: number;
  reason: string;
}
