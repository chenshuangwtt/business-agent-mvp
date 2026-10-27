# 报告交付

先用 `query_orders`、`calculate_metrics`、`compare_period_metrics`、`detect_anomalies` 和 `generate_diagnosis_report` 生成报告内容。`query_orders` 的结果只能通过 `dataset_id` 传递。

用户要求导出时，将已经生成的 Markdown 作为 `content` 传给 `export_report`；用户要求邮件发送时同样先准备报告，再调用 `send_report_email`。这两个工具本身会触发审批。不要在 Skill 命中时提前创建审批，也不要在审批通过前声称交付完成。

报告正文和交付确认应只包含经营信息及文件名或收件人，不得展示工具名称、内部标识、文件路径或运行过程。
