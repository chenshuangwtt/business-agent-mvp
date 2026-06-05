import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import app from "../src/server.ts";
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

test("loadSkills throws when a skill references a missing tool", () => {
  initToolRegistry();
  const dir = mkdtempSync(join(tmpdir(), "business-agent-skills-"));
  const skillDir = join(dir, "broken_skill");
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(
    join(skillDir, "skill.yaml"),
    [
      "name: broken_skill",
      "displayName: Broken Skill",
      "description: Broken skill for tests",
      "triggers:",
      "  - broken",
      "tools:",
      "  - missing_tool",
      "workflow:",
      "  - run missing tool",
      "execution_mode: sequential",
      "risk_level: low",
      "requires_approval: false",
      "output_format: Markdown",
    ].join("\n"),
    "utf-8"
  );
  writeFileSync(join(skillDir, "prompt.md"), "Broken prompt", "utf-8");

  try {
    assert.throws(() => loadSkills(dir), /missing_tool/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    loadSkills();
  }
});

test("selectSkill matches business analysis intent", () => {
  initToolRegistry();
  loadSkills();

  const selection = selectSkill("帮我分析本周订单情况");

  assert.equal(selection.selectedSkill?.name, "business_analysis");
});

test("selectSkill matches anomaly investigation intent", () => {
  initToolRegistry();
  loadSkills();

  const selection = selectSkill("帮我排查退款异常和疑似刷单");

  assert.equal(selection.selectedSkill?.name, "anomaly_investigation");
  assert.equal(selection.confidence, 0.8);
});

test("selectSkill matches report delivery intent", () => {
  initToolRegistry();
  loadSkills();

  const selection = selectSkill("帮我导出 weekly-report.md");

  assert.equal(selection.selectedSkill?.name, "report_delivery");
});

test("skill selector prioritizes report delivery for mixed delivery intents", () => {
  initToolRegistry();
  loadSkills();

  assert.equal(selectSkill("帮我分析本周订单情况并导出").selectedSkill?.name, "report_delivery");
  assert.equal(selectSkill("帮我分析本周订单情况，生成报告并保存").selectedSkill?.name, "report_delivery");
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

test("/api/skills returns built-in skills", async () => {
  initToolRegistry();
  loadSkills();

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/skills`);
    const skills = (await response.json()) as Array<{ name: string }>;

    assert.equal(response.status, 200);
    assert.equal(skills.length, 3);
    assert.deepEqual(
      skills.map((skill) => skill.name).sort(),
      ["anomaly_investigation", "business_analysis", "report_delivery"]
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
