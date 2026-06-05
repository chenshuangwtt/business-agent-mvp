import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "./logger.js";

const DATA_DIR = join(process.cwd(), "data");

/**
 * 读取 CSV 文件并返回解析后的对象数组
 */
export function readCSV<T>(filename: string): T[] {
  const filePath = join(DATA_DIR, filename);
  logger.debug(`Reading CSV: ${filePath}`);
  const content = readFileSync(filePath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  logger.debug(`Parsed ${records.length} records from ${filename}`);
  return records as T[];
}

/**
 * 读取 Markdown 文件
 */
export function readMarkdown(filename: string): string {
  const filePath = join(DATA_DIR, filename);
  logger.debug(`Reading Markdown: ${filePath}`);
  return readFileSync(filePath, "utf-8");
}
