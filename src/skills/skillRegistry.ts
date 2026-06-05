import type { SkillDefinition, SkillInfo } from "./types.js";

const skills = new Map<string, SkillDefinition>();

export function registerSkill(skill: SkillDefinition): void {
  skills.set(skill.name, skill);
}

export function clearSkills(): void {
  skills.clear();
}

export function listSkills(): SkillDefinition[] {
  return Array.from(skills.values());
}

export function getSkill(name: string): SkillDefinition | undefined {
  return skills.get(name);
}

export function getSkillInfos(): SkillInfo[] {
  return listSkills().map((skill) => ({
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    tools: skill.tools,
    executionMode: skill.executionMode,
    riskLevel: skill.riskLevel,
    requiresApproval: skill.requiresApproval,
    selection: skill.selection,
  }));
}

export function findSkillByKeyword(message: string): SkillDefinition | null {
  const normalized = message.toLowerCase();
  let best: { skill: SkillDefinition; score: number } | null = null;

  for (const skill of listSkills()) {
    const triggerScore = skill.triggers.reduce((sum, trigger) => {
      const value = trigger.toLowerCase();
      return normalized.includes(value) ? sum + Math.max(value.length, 1) : sum;
    }, 0);

    const score = triggerScore > 0 ? triggerScore + skill.selection.priority : 0;

    if (score > 0 && (!best || score > best.score)) {
      best = { skill, score };
    }
  }

  return best?.skill || null;
}
