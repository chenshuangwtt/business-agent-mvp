import { loadAndSplit, type DocumentChunk } from "./documentLoader.js";
import { logger } from "../utils/logger.js";

/**
 * 简单关键词检索器（模拟 RAG）
 *
 * 使用关键词匹配 + 简单相似度评分，不依赖向量数据库。
 */

// 要加载的文档列表
const DOCUMENT_FILES = ["business_rules.md", "company_policy.md"];

/**
 * 检索与 query 相关的文档片段
 */
export function retrieve(query: string, topK: number = 3): DocumentChunk[] {
  logger.info(`[RAG] 检索: "${query}", topK=${topK}`);

  // 加载所有文档片段
  const allChunks: DocumentChunk[] = [];
  for (const file of DOCUMENT_FILES) {
    allChunks.push(...loadAndSplit(file));
  }

  // 计算每个片段的相关性分数
  const scored = allChunks.map((chunk) => ({
    chunk,
    score: computeRelevance(query, chunk.content),
  }));

  // 按分数降序排序
  scored.sort((a, b) => b.score - a.score);

  // 返回 topK
  const results = scored.slice(0, topK).map((s) => s.chunk);
  logger.info(`[RAG] 返回 ${results.length} 个相关片段`);
  return results;
}

/**
 * 计算查询与文本的相关性分数
 *
 * 简单实现：基于关键词重叠和中文字符匹配
 */
function computeRelevance(query: string, text: string): number {
  // 提取关键词（简单分词：按空格和标点分割）
  const queryWords = extractKeywords(query);
  const textWords = extractKeywords(text);

  if (queryWords.length === 0) return 0;

  // 计算关键词重叠率
  const textSet = new Set(textWords);
  const matched = queryWords.filter((w) => textSet.has(w));
  const overlapScore = matched.length / queryWords.length;

  // 计算中文字符匹配（针对中文查询）
  const queryChars = new Set(query.replace(/[^一-龥]/g, ""));
  const textChars = text.replace(/[^一-龥]/g, "");
  let charMatch = 0;
  for (const ch of queryChars) {
    if (textChars.includes(ch)) charMatch++;
  }
  const charScore = queryChars.size > 0 ? charMatch / queryChars.size : 0;

  // 综合分数
  return overlapScore * 0.6 + charScore * 0.4;
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  // 中文：按字符提取
  const chinese = text.match(/[一-龥]{2,}/g) || [];
  // 英文：按单词提取
  const english = text
    .toLowerCase()
    .match(/[a-z]{2,}/g) || [];
  return [...chinese, ...english];
}
