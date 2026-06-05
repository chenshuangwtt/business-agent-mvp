import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger.js";

const DATA_DIR = join(process.cwd(), "data");

/**
 * 文档片段
 */
export interface DocumentChunk {
  content: string;
  source: string;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;

/**
 * 读取 CSV 文件并返回解析后的对象数组（复用）
 */
export function readDataFile(filename: string): string {
  return readFileSync(join(DATA_DIR, filename), "utf-8");
}

/**
 * 将 Markdown 文档切分为片段
 *
 * 策略：先按标题切分，超长片段再按段落二次切分
 */
export function loadAndSplit(
  filename: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  chunkOverlap: number = DEFAULT_CHUNK_OVERLAP
): DocumentChunk[] {
  const content = readFileSync(join(DATA_DIR, filename), "utf-8");
  logger.debug(`[RAG] 加载文档: ${filename} (${content.length} 字)`);

  // 第一轮：按标题切分
  const headingChunks = splitByHeading(content, filename);

  // 第二轮：超长片段按段落二次切分
  const result: DocumentChunk[] = [];
  let globalIndex = 0;

  for (const chunk of headingChunks) {
    if (chunk.content.length <= chunkSize) {
      result.push({ ...chunk, chunkIndex: globalIndex++ });
    } else {
      const subChunks = splitBySize(chunk.content, chunkSize, chunkOverlap);
      for (const sub of subChunks) {
        result.push({
          content: sub,
          source: filename,
          chunkIndex: globalIndex++,
        });
      }
    }
  }

  logger.debug(`[RAG] ${filename} 切分为 ${result.length} 个片段`);
  return result;
}

/**
 * 按 Markdown 标题切分
 */
function splitByHeading(content: string, source: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const lines = content.split("\n");
  let currentChunk = "";
  let chunkIndex = 0;

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) && currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        source,
        chunkIndex: chunkIndex++,
      });
      currentChunk = "";
    }
    currentChunk += line + "\n";
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      source,
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

/**
 * 按大小切分文本，支持重叠
 */
function splitBySize(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  const result: string[] = [];

  // 先尝试按段落分割
  const paragraphs = text.split(/\n{2,}/);
  let buffer = "";

  for (const para of paragraphs) {
    if (buffer.length + para.length + 1 > chunkSize && buffer.length > 0) {
      result.push(buffer.trim());
      // 保留尾部 overlap
      buffer = buffer.slice(-overlap) + "\n\n" + para;
    } else {
      buffer = buffer ? buffer + "\n\n" + para : para;
    }
  }

  if (buffer.trim()) {
    result.push(buffer.trim());
  }

  // 如果某段仍然超长，强制按字符切分
  const finalResult: string[] = [];
  for (const chunk of result) {
    if (chunk.length <= chunkSize * 1.5) {
      finalResult.push(chunk);
    } else {
      let pos = 0;
      while (pos < chunk.length) {
        finalResult.push(chunk.slice(pos, pos + chunkSize));
        pos += chunkSize - overlap;
      }
    }
  }

  return finalResult;
}
