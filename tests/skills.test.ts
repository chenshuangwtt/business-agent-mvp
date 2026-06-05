import assert from "node:assert/strict";
import test from "node:test";
import { initToolRegistry, getToolsForLLM } from "../src/agent/toolRegistry.ts";
import { runAgent } from "../src/agent/agentLoop.ts";
import { getSession } from "../src/agent/sessionStore.ts";
import { getTrace } from "../src/trace/traceRecorder.ts";
import { loadSkills } from "../src/skills/skillLoader.ts";
import { getSkill, listSkills } from "../src/skills/skillRegistry.ts";
import { selectSkill } from "../src/skills/skillSelector.ts";

test("skill loader registers built-in skills and validates tools", () => {
  initToolRegistry();
  const skills = loadSkills();

  assert.equal(skills.length, 3);
  assert.ok(getSkill("business_analysis"));
  assert.ok(getSkill("anomaly_investigation"));
  assert.ok(getSkill("report_delivery"));
  assert.ok(skills.every((skill) => skill.tools.length > 0));

  const delivery = getSkill("report_delivery");
  assert.equal(delivery?.selection.priority, 90);
  assert.ok(delivery?.constraints.some((item) => item.includes("审批")));
  assert.deepEqual(delivery?.approval?.requiredTools, ["export_report", "send_report_email"]);
});

test("skill selector matches keyword triggers", () => {
  initToolRegistry();
  loadSkills();

  const selection = selectSkill("帮我找出退款率最高的渠道和异常风险");

  assert.equal(selection.selectedSkill?.name, "anomaly_investigation");
  assert.equal(selection.confidence, 0.8);
});

test("skill selector prioritizes report delivery for delivery intents", () => {
  initToolRegistry();
  loadSkills();

  const exportSelection = selectSkill("帮我分析本周订单情况并导出");
  const saveSelection = selectSkill("帮我分析本周订单情况，生成报告并保存");

  assert.equal(exportSelection.selectedSkill?.name, "report_delivery");
  assert.equal(saveSelection.selectedSkill?.name, "report_delivery");
});

test("skill tools limit LLM tool definitions", () => {
  initToolRegistry();
  loadSkills();
  const skill = getSkill("business_analysis");

  assert.ok(skill);
  const tools = getToolsForLLM(skill.tools);
  const names = tools.map((tool) => tool.function.name);

  assert.deepEqual(names, skill.tools);
  assert.equal(listSkills().length, 3);
});

test("agent replaces previous skill context in multi-turn session", async () => {
  const oldProfiles = process.env.LLM_PROFILES;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const oldLLMKey = process.env.LLM_API_KEY;
  const oldPrimaryKey = process.env.LLM_PRIMARY_API_KEY;
  const oldBackupKey = process.env.LLM_BACKUP_API_KEY;

  initToolRegistry();
  loadSkills();

  try {
    delete process.env.LLM_PROFILES;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PRIMARY_API_KEY;
    delete process.env.LLM_BACKUP_API_KEY;

    const first = await runAgent("帮我分析本周订单情况");
    await runAgent("帮我分析本周订单情况，生成报告并导出为 weekly.md", first.sessionId);

    const session = getSession(first.sessionId);
    const skillContexts =
      session?.messages.filter(
        (message: any) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.startsWith("<skill_context>")
      ) || [];

    assert.equal(skillContexts.length, 1);
    assert.match(String((skillContexts[0] as any).content), /report_delivery/);
  } finally {
    restoreEnv("LLM_PROFILES", oldProfiles);
    restoreEnv("OPENAI_API_KEY", oldOpenAIKey);
    restoreEnv("LLM_API_KEY", oldLLMKey);
    restoreEnv("LLM_PRIMARY_API_KEY", oldPrimaryKey);
    restoreEnv("LLM_BACKUP_API_KEY", oldBackupKey);
  }
});

test("skill approval flag does not create approval before approval tool call", async () => {
  const oldProfiles = process.env.LLM_PROFILES;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const oldLLMKey = process.env.LLM_API_KEY;
  const oldPrimaryKey = process.env.LLM_PRIMARY_API_KEY;
  const oldBackupKey = process.env.LLM_BACKUP_API_KEY;

  initToolRegistry();
  loadSkills();

  try {
    delete process.env.LLM_PROFILES;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PRIMARY_API_KEY;
    delete process.env.LLM_BACKUP_API_KEY;

    const result = await runAgent("帮我分析本周订单情况，生成报告并保存");
    const trace = getTrace(result.traceId);
    const selected = trace?.steps.find((step) => step.type === "skill_selected");

    assert.equal(result.status, "success");
    assert.equal(selected?.data.skillName, "report_delivery");
    assert.equal(selected?.data.requiresApproval, true);
  } finally {
    restoreEnv("LLM_PROFILES", oldProfiles);
    restoreEnv("OPENAI_API_KEY", oldOpenAIKey);
    restoreEnv("LLM_API_KEY", oldLLMKey);
    restoreEnv("LLM_PRIMARY_API_KEY", oldPrimaryKey);
    restoreEnv("LLM_BACKUP_API_KEY", oldBackupKey);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
