import "dotenv/config";
import app from "./server.js";
import { initToolRegistry } from "./agent/toolRegistry.js";
import { startSessionCleanup } from "./agent/sessionStore.js";
import { logger } from "./utils/logger.js";
import { getAvailableLLMConfigs, getLLMConfig } from "./llm/llmClient.js";
import { loadSkills } from "./skills/skillLoader.js";
import { listSkills } from "./skills/skillRegistry.js";

const PORT = parseInt(process.env.PORT || "3001");
const HOST = process.env.HOST || "0.0.0.0";

// 初始化工具注册表
initToolRegistry();

// 初始化 Skill 注册表
loadSkills();

// 启动会话清理定时器
startSessionCleanup();

// 启动服务
app.listen(PORT, HOST, () => {
  const llmConfig = getLLMConfig();
  const llmProfiles = getAvailableLLMConfigs();
  logger.info(`🚀 business-agent-mvp 已启动`);
  logger.info(`   地址: http://${HOST}:${PORT}`);
  logger.info(`   健康检查: http://${HOST}:${PORT}/api/health`);
  logger.info(`   工具列表: http://${HOST}:${PORT}/api/tools`);
  logger.info(`   Skills: ${listSkills().length}`);
  logger.info(`   会话列表: http://${HOST}:${PORT}/api/sessions`);
  logger.info(`   前端 UI: http://${HOST}:${PORT}/`);
  logger.info(
    `   LLM: ${llmProfiles.length > 0 ? "已配置" : "未配置（fallback 模式）"} (${llmConfig.provider}/${llmConfig.model}, profiles=${llmProfiles.length})`
  );
});
