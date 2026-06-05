import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import type { AgentTool, ToolContext } from "../agent/types.js";

const REPORTS_DIR = resolve(process.cwd(), "reports");

const InputSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\w\u4e00-\u9fa5.-]+$/u, "文件名只允许字母、数字、中文、下划线、短横线和点")
    .describe("导出文件名，例如 weekly-report.md"),
  content: z.string().min(1).describe("报告内容（Markdown）"),
});

export const exportReportTool: AgentTool = {
  name: "export_report",
  description:
    "将报告导出为本地 Markdown 文件。只能写入 reports/ 目录，需要用户审批。",
  riskLevel: "medium",
  requiresApproval: true,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { filename, content } = InputSchema.parse(args);

    context.logger(`导出报告: ${filename}`);

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw {
        code: "INVALID_ARGS",
        message: "文件名包含非法字符，不允许路径穿越",
      };
    }

    if (!existsSync(REPORTS_DIR)) {
      mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const filePath = resolve(join(REPORTS_DIR, filename));
    if (!filePath.startsWith(REPORTS_DIR)) {
      throw {
        code: "INVALID_ARGS",
        message: "文件路径必须在 reports/ 目录内",
      };
    }

    writeFileSync(filePath, content, "utf-8");

    return {
      success: true,
      filename,
      path: `reports/${filename}`,
      size: content.length,
      message: `报告已导出到 reports/${filename}`,
    };
  },
};
