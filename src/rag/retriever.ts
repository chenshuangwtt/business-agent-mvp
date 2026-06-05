import { retrieve as keywordRetrieve } from "./simpleRetriever.js";
import type { DocumentChunk } from "./documentLoader.js";
import { logger } from "../utils/logger.js";

export async function retrieve(
  query: string,
  topK: number = 3
): Promise<DocumentChunk[]> {
  logger.info("[RAG] 使用关键词检索");
  return keywordRetrieve(query, topK);
}
