# 运行项目

## 前置条件

- Node.js 20 或更高版本。
- pnpm 可用：`pnpm --version`。

## 本地开发

在项目根目录执行：

```powershell
pnpm install
Copy-Item .env.example .env
```

`.env` 中的 LLM Key 可以留空。留空时系统使用本地的确定性诊断流程，仍可完成退款、渠道下降和高频购买的 demo 分析。

分别打开两个终端。

```powershell
# 终端 1：后端 API
pnpm run dev
```

```powershell
# 终端 2：Vue 前端
pnpm --dir frontend run dev -- --host 0.0.0.0
```

访问：

| 地址 | 用途 |
|---|---|
| `http://localhost:5173` | Web 界面 |
| `http://localhost:3001/api/health` | 后端健康检查 |
| `http://localhost:3001/api/tools` | 工具列表 |
| `http://localhost:3001/api/skills` | Skill 列表 |
| `http://localhost:3001/api/traces` | Trace 列表 |

## 一体化运行

构建前端后，Express 会托管 `frontend/dist`：

```powershell
pnpm run build:all
pnpm start
```

然后访问 `http://localhost:3001`。

## 重新生成演示数据

```powershell
pnpm run generate:data
```

该命令使用固定随机种子生成 `2026-04-01` 至 `2026-09-30` 的多表 CSV 数据。默认 demo 参考日期为 `2026-09-30`；“最近一周”对应 `2026-09-24 至 2026-09-30`。

## 验证

```powershell
pnpm run check
pnpm run build:all
```

可在页面直接点击诊断示例，或使用根目录的 [test.http](../test.http) 调用 API。
