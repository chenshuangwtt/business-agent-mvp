import { findSkillByKeyword } from "./skillRegistry.js";
import type { SkillSelection } from "./types.js";

export function selectSkill(message: string): SkillSelection {
  const selectedSkill = findSkillByKeyword(message);

  if (!selectedSkill) {
    return {
      selectedSkill: null,
      confidence: 0,
      reason: "未命中 keyword trigger",
    };
  }

  return {
    selectedSkill,
    confidence: 0.8,
    reason: "命中 keyword trigger",
  };
}
