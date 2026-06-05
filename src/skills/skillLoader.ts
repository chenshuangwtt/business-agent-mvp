import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getTool } from "../agent/toolRegistry.js";
import { logger } from "../utils/logger.js";
import { clearSkills, registerSkill } from "./skillRegistry.js";
import type { SkillDefinition } from "./types.js";

type ParsedYaml = Record<string, any>;

export function loadSkills(skillsDir = join(process.cwd(), "skills")): SkillDefinition[] {
  clearSkills();

  if (!existsSync(skillsDir)) {
    logger.warn(`[SkillLoader] skills 目录不存在: ${skillsDir}`);
    return [];
  }

  const loaded: SkillDefinition[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry.name);
    const yamlPath = join(skillDir, "skill.yaml");
    const promptPath = join(skillDir, "prompt.md");

    if (!existsSync(yamlPath) || !existsSync(promptPath)) {
      logger.warn(`[SkillLoader] 跳过不完整 skill: ${entry.name}`);
      continue;
    }

    const parsed = parseSkillYaml(readFileSync(yamlPath, "utf-8"));
    const prompt = readFileSync(promptPath, "utf-8").trim();
    const skill = normalizeSkill(parsed, prompt);
    validateSkillTools(skill);
    registerSkill(skill);
    loaded.push(skill);
    logger.info(`[SkillLoader] 注册 Skill: ${skill.name} (${skill.tools.length} tools)`);
  }

  logger.info(`[SkillLoader] 初始化完成，共 ${loaded.length} 个 skills`);
  return loaded;
}

function normalizeSkill(parsed: ParsedYaml, prompt: string): SkillDefinition {
  const required = ["name", "displayName", "description", "triggers", "tools", "workflow"];
  for (const key of required) {
    if (parsed[key] === undefined) {
      throw new Error(`Skill 配置缺少字段: ${key}`);
    }
  }

  return {
    name: String(parsed.name),
    displayName: String(parsed.displayName),
    metadata: parsed.metadata || {},
    description: String(parsed.description).trim(),
    triggers: asStringArray(parsed.triggers?.keywords || parsed.triggers),
    tools: asStringArray(parsed.tools),
    workflow: asStringArray(parsed.workflow),
    executionMode: String(parsed.execution_mode || "sequential"),
    riskLevel: parsed.risk_level || "low",
    requiresApproval: Boolean(parsed.requires_approval),
    outputFormat: String(parsed.output_format || "Markdown"),
    selection: normalizeSelection(parsed.selection),
    constraints: asStringArray(parsed.constraints),
    expectedSections: asStringArray(parsed.expected_sections),
    approval: normalizeApproval(parsed.approval),
    prompt,
  };
}

function validateSkillTools(skill: SkillDefinition): void {
  for (const toolName of skill.tools) {
    if (!getTool(toolName)) {
      throw new Error(`Skill ${skill.name} 引用了不存在的工具: ${toolName}`);
    }
  }
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeSelection(value: any): SkillDefinition["selection"] {
  return {
    priority: Number(value?.priority) || 0,
    confidenceThreshold: Number(value?.confidence_threshold) || 0,
  };
}

function normalizeApproval(value: any): SkillDefinition["approval"] | undefined {
  if (!value) return undefined;
  return {
    requiredTools: asStringArray(value.required_tools),
    policy: String(value.policy || "").trim(),
  };
}

function parseSkillYaml(content: string): ParsedYaml {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const result: ParsedYaml = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/.exec(line);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    const value = match[2] || "";

    if (value === "|") {
      const block: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || !lines[i].trim())) {
        block.push(lines[i].startsWith("  ") ? lines[i].slice(2) : "");
        i++;
      }
      result[key] = block.join("\n").trim();
      continue;
    }

    if (value) {
      result[key] = parseScalar(value);
      i++;
      continue;
    }

    const blockLines: string[] = [];
    i++;
    while (i < lines.length && (lines[i].startsWith("  ") || !lines[i].trim())) {
      if (lines[i].trim()) blockLines.push(lines[i]);
      i++;
    }
    result[key] = parseIndentedBlock(blockLines);
  }

  return result;
}

function parseIndentedBlock(lines: string[]): any {
  if (lines.some((line) => line.trimStart().startsWith("- ")) && !lines.some((line) => /:\s*$/.test(line.trim()))) {
    return lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => parseScalar(line.slice(2)));
  }

  const record: Record<string, any> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    const value = match[2] || "";

    if (value === "|") {
      const block: string[] = [];
      i++;
      while (i < lines.length && lines[i].startsWith("    ")) {
        block.push(lines[i].slice(4));
        i++;
      }
      i--;
      record[key] = block.join("\n").trim();
      continue;
    }

    if (value) {
      record[key] = parseScalar(value);
      continue;
    }

    const items: string[] = [];
    i++;
    while (i < lines.length && lines[i].startsWith("    ")) {
      const item = lines[i].trim();
      if (item.startsWith("- ")) items.push(String(parseScalar(item.slice(2))));
      i++;
    }
    i--;
    record[key] = items;
  }
  return record;
}

function parseScalar(value: string): any {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}
