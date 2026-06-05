import test from "node:test";
import assert from "node:assert/strict";
import { getAvailableLLMConfigs, getLLMConfig, getLLMConfigs } from "../src/llm/llmClient.js";

const KEYS = [
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_PROFILES",
  "LLM_PRIMARY_PROVIDER",
  "LLM_PRIMARY_API_KEY",
  "LLM_PRIMARY_BASE_URL",
  "LLM_PRIMARY_MODEL",
  "LLM_BACKUP_PROVIDER",
  "LLM_BACKUP_API_KEY",
  "LLM_BACKUP_BASE_URL",
  "LLM_BACKUP_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
];

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const old = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const key of KEYS) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

test("llm config uses provider defaults", () => {
  withEnv({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "test-key" }, () => {
    const config = getLLMConfig();
    assert.equal(config.provider, "deepseek");
    assert.equal(config.baseURL, "https://api.deepseek.com");
    assert.equal(config.model, "deepseek-v4-flash");
  });
});

test("llm config prefers generic LLM variables", () => {
  withEnv(
    {
      LLM_PROVIDER: "custom",
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: "https://example.com/v1",
      LLM_MODEL: "custom-model",
    },
    () => {
      const config = getLLMConfig();
      assert.equal(config.provider, "custom");
      assert.equal(config.baseURL, "https://example.com/v1");
      assert.equal(config.model, "custom-model");
    }
  );
});

test("llm config reads profile chain in order", () => {
  withEnv(
    {
      LLM_PROFILES: "primary,backup",
      LLM_PRIMARY_PROVIDER: "deepseek",
      LLM_PRIMARY_API_KEY: "deepseek-key",
      LLM_PRIMARY_MODEL: "deepseek-v4-flash",
      LLM_BACKUP_PROVIDER: "mimo",
      LLM_BACKUP_API_KEY: "backup-key",
      LLM_BACKUP_BASE_URL: "https://backup.example.com/v1",
      LLM_BACKUP_MODEL: "backup-model",
    },
    () => {
      const configs = getLLMConfigs();
      assert.equal(configs.length, 2);
      assert.equal(configs[0].profile, "primary");
      assert.equal(configs[0].provider, "deepseek");
      assert.equal(configs[1].profile, "backup");
      assert.equal(configs[1].provider, "mimo");
      assert.equal(configs[1].baseURL, "https://backup.example.com/v1");

      const available = getAvailableLLMConfigs();
      assert.equal(available.length, 2);
    }
  );
});

test("llm profiles can use arbitrary names", () => {
  withEnv(
    {
      LLM_PROFILES: "fast,strong",
      LLM_FAST_PROVIDER: "custom",
      LLM_FAST_API_KEY: "fast-key",
      LLM_FAST_BASE_URL: "https://fast.example.com/v1",
      LLM_FAST_MODEL: "fast-model",
      LLM_STRONG_PROVIDER: "openai",
      LLM_STRONG_API_KEY: "strong-key",
      LLM_STRONG_BASE_URL: "https://api.openai.com/v1",
      LLM_STRONG_MODEL: "gpt-4o-mini",
    },
    () => {
      const configs = getLLMConfigs();
      assert.equal(configs[0].profile, "fast");
      assert.equal(configs[0].provider, "custom");
      assert.equal(configs[0].model, "fast-model");
      assert.equal(configs[1].profile, "strong");
      assert.equal(configs[1].provider, "openai");
    }
  );
});
