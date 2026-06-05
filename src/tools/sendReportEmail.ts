import { z } from "zod";
import type { AgentTool, ToolContext } from "../agent/types.js";

const InputSchema = z.object({
  to: z.string().email().describe("收件人邮箱"),
  subject: z.string().min(1).describe("邮件主题"),
  content: z.string().min(1).describe("邮件内容（Markdown）"),
});

export const sendReportEmailTool: AgentTool = {
  name: "send_report_email",
  description:
    "模拟发送报告邮件。不会真实发送，只写入 Trace 记录，需要用户审批。",
  riskLevel: "high",
  requiresApproval: true,
  inputSchema: InputSchema,
  execute: async (args, context: ToolContext) => {
    const { to, subject, content } = InputSchema.parse(args);

    context.logger(`模拟发送邮件: to=${to}, subject=${subject}`);

    return {
      success: true,
      simulated: true,
      to,
      subject,
      contentLength: content.length,
      message: `[模拟] 邮件已发送至 ${to}，主题：${subject}`,
    };
  },
};
