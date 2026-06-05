import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger.js";
import { withTimeout } from "../utils/timeout.js";

export type LLMProvider = string;

export interface LLMConfig {
  profile: string;
  provider: LLMProvider;
  apiKey?: string;
  baseURL: string;
  model: string;
}

export interface LLMCallAttempt {
  profile: string;
  provider: LLMProvider;
  model: string;
  duration: number;
  error?: string;
  code?: string;
}

export interface LLMCallResult {
  response: OpenAI.Chat.Completions.ChatCompletion;
  config: LLMConfig;
  duration: number;
  attempts: LLMCallAttempt[];
}

const PROVIDER_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  custom: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
};

const clients = new Map<string, OpenAI>();

function readProvider(): LLMProvider {
  return normalizeProvider(process.env.LLM_PROVIDER || "openai");
}

function readProfileProvider(profile: string): LLMProvider {
  const raw = process.env[`LLM_${profile.toUpperCase()}_PROVIDER`] || process.env.LLM_PROVIDER || "custom";
  return normalizeProvider(raw);
}

function normalizeProvider(value: string | undefined): LLMProvider {
  return (value || "custom").trim().toLowerCase() || "custom";
}

function readProfileConfig(profile: string, index: number): LLMConfig {
  const profileKey = profile.toUpperCase();
  const provider = readProfileProvider(profile);
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;

  return {
    profile,
    provider,
    apiKey:
      process.env[`LLM_${profileKey}_API_KEY`] ||
      (index === 0 ? process.env.LLM_API_KEY : undefined) ||
      process.env[`${provider.toUpperCase()}_API_KEY`] ||
      process.env.OPENAI_API_KEY,
    baseURL:
      process.env[`LLM_${profileKey}_BASE_URL`] ||
      (index === 0 ? process.env.LLM_BASE_URL : undefined) ||
      process.env[`${provider.toUpperCase()}_BASE_URL`] ||
      defaults.baseURL,
    model:
      process.env[`LLM_${profileKey}_MODEL`] ||
      (index === 0 ? process.env.LLM_MODEL : undefined) ||
      process.env[`${provider.toUpperCase()}_MODEL`] ||
      defaults.model,
  };
}

export function getLLMConfigs(): LLMConfig[] {
  const profiles = (process.env.LLM_PROFILES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (profiles.length > 0) {
    return profiles.map((profile, index) => readProfileConfig(profile, index));
  }

  const provider = readProvider();
  const config = readProfileConfig(provider, 0);
  return [{ ...config, profile: process.env.LLM_PROFILE || provider }];
}

export function getLLMConfig(): LLMConfig {
  return getLLMConfigs()[0];
}

export function getAvailableLLMConfigs(): LLMConfig[] {
  return getLLMConfigs().filter((config) => !!config.apiKey);
}

export function getLLMClient(config: LLMConfig = getLLMConfig()): OpenAI | null {
  if (!config.apiKey) {
    logger.warn(`[LLM] ${config.profile} API Key 未设置，将使用 fallback 模式`);
    return null;
  }

  const clientKey = `${config.profile}:${config.provider}:${config.baseURL}:${config.apiKey}`;
  const cached = clients.get(clientKey);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  clients.set(clientKey, client);

  logger.info(
    `[LLM] 客户端已初始化: profile=${config.profile}, provider=${config.provider}, model=${config.model}`
  );
  return client;
}

export function getModel(): string {
  return getLLMConfig().model;
}

export async function createChatCompletionWithFallback(
  params: any,
  options: { timeoutMs: number; label?: string }
): Promise<LLMCallResult> {
  const configs = getAvailableLLMConfigs();
  if (configs.length === 0) {
    const err: any = new Error("LLM API Key 未设置");
    err.code = "LLM_UNAVAILABLE";
    err.attempts = [];
    throw err;
  }

  const attempts: LLMCallAttempt[] = [];

  for (const config of configs) {
    const client = getLLMClient(config);
    if (!client) continue;

    const start = Date.now();
    try {
      logger.info(
        `[LLM] 请求开始: profile=${config.profile}, provider=${config.provider}, model=${config.model}`
      );
      const response = await withTimeout(
        client.chat.completions.create({
          ...params,
          model: config.model,
        }),
        options.timeoutMs,
        `LLM:${config.profile}`
      );
      const duration = Date.now() - start;
      const attempt = {
        profile: config.profile,
        provider: config.provider,
        model: config.model,
        duration,
      };
      attempts.push(attempt);
      logger.info(`[LLM] 请求完成: profile=${config.profile}, duration=${duration}ms`);
      return { response, config, duration, attempts };
    } catch (err: any) {
      const duration = Date.now() - start;
      attempts.push({
        profile: config.profile,
        provider: config.provider,
        model: config.model,
        duration,
        error: err.message || String(err),
        code: err.code,
      });
      logger.warn(
        `[LLM] 调用失败: profile=${config.profile}, duration=${duration}ms, message=${err.message}`
      );
    }
  }

  const last = attempts[attempts.length - 1];
  const err: any = new Error(last?.error || "所有 LLM 调用失败");
  err.code = attempts.every((attempt) => attempt.code === "TOOL_TIMEOUT")
    ? "LLM_TIMEOUT"
    : "LLM_ERROR";
  err.attempts = attempts;
  throw err;
}

export function loadSystemPrompt(): string {
  const promptPath = join(process.cwd(), "prompts", "system-prompt.md");
  return readFileSync(promptPath, "utf-8");
}

export function loadReportPrompt(): string {
  const promptPath = join(process.cwd(), "prompts", "report-prompt.md");
  return readFileSync(promptPath, "utf-8");
}

export function isLLMAvailable(): boolean {
  return getAvailableLLMConfigs().length > 0;
}
