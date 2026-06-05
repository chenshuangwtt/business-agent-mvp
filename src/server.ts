import express from "express";
import { join } from "path";
import { runAgent, resumeAgent } from "./agent/agentLoop.js";
import { getApproval } from "./agent/approvalStore.js";
import { getToolInfos } from "./agent/toolRegistry.js";
import { listSessions } from "./agent/sessionStore.js";
import { getTrace, listTraces } from "./trace/traceRecorder.js";
import { logger } from "./utils/logger.js";
import { getAvailableLLMConfigs, getLLMConfig } from "./llm/llmClient.js";

const app: express.Express = express();
app.use(express.json({ limit: "2mb" }));

app.use(express.static(join(process.cwd(), "frontend", "dist")));
app.use(express.static(join(process.cwd(), "public")));

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({
        status: "error",
        message: "请提供 message 字段",
      });
    }

    logger.info(`[API] /api/chat: "${message.slice(0, 100)}..."`);
    const result = await runAgent(message, sessionId);
    res.json(result);
  } catch (err: any) {
    logger.error(`[API] /api/chat 错误: ${err.message}`);
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

app.post("/api/approve", async (req, res) => {
  try {
    const { approvalId, approved } = req.body;
    if (!approvalId || typeof approved !== "boolean") {
      return res.status(400).json({
        status: "error",
        message: "请提供 approvalId 和 approved 字段",
      });
    }

    const approval = getApproval(approvalId);
    if (!approval) {
      return res.status(404).json({
        status: "error",
        message: "审批请求不存在",
      });
    }

    if (approval.status !== "pending") {
      return res.status(400).json({
        status: "error",
        message: `审批已处理: ${approval.status}`,
      });
    }

    logger.info(`[API] /api/approve: ${approvalId} -> ${approved}`);
    const result = await resumeAgent(approvalId, approved);
    res.json(result);
  } catch (err: any) {
    logger.error(`[API] /api/approve 错误: ${err.message}`);
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

app.get("/api/tools", (_req, res) => {
  res.json(getToolInfos());
});

app.get("/api/sessions", (_req, res) => {
  res.json(listSessions());
});

app.get("/api/traces", (_req, res) => {
  res.json(listTraces());
});

app.get("/api/traces/:traceId", (req, res) => {
  const trace = getTrace(req.params.traceId);
  if (!trace) {
    return res.status(404).json({ message: "Trace 不存在" });
  }
  res.json(trace);
});

app.get("/api/health", (_req, res) => {
  const llmConfig = getLLMConfig();
  const llmProfiles = getAvailableLLMConfigs();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    llmAvailable: llmProfiles.length > 0,
    llmProvider: llmConfig.provider,
    llmModel: llmConfig.model,
    llmProfiles: llmProfiles.map((config) => ({
      profile: config.profile,
      provider: config.provider,
      model: config.model,
    })),
  });
});

export default app;
