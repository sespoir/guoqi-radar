# 国企雷达

面向计算机及相近专业的国企招聘聚合 Agent。系统每天巡查官方招聘网站，并通过 GitHub 与公开网页搜索发现补充线索；搜索结果会回溯官网并按“官网核验 / 可信转载 / 社区线索”分级，使用规则与可选 AI API 做相关度判断、结构化和去重。

## 公开网站

- GitHub Pages：`https://sespoir.github.io/guoqi-radar/`
- 源代码：`https://github.com/sespoir/guoqi-radar`

公开页面由 GitHub Actions 在每天北京时间 09:17 自动重新采集并发布，也可以在仓库的 Actions 页面手动运行。网页只包含公开招聘信息，不包含任何 API 密钥。

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写：

- `AGENT_SECRET`：保护手动采集接口，生产环境必须设置。
- `AI_API_KEY`：OpenAI 兼容 API 密钥；不填写时自动使用本地规则。
- `AI_BASE_URL`：兼容接口地址，默认 `https://api.openai.com/v1`。
- `AI_MODEL`：你有权使用的模型名称。
- `AZURE_OPENAI_API_KEY`：Azure OpenAI 密钥；作为生产环境 Secret 保存。
- `AZURE_OPENAI_ENDPOINT`：Azure OpenAI 资源地址，例如 `https://your-resource.openai.azure.com`。
- `AZURE_OPENAI_API_VERSION`：Azure OpenAI API 版本。
- `AZURE_OPENAI_DEPLOYMENT`：Azure 中的模型部署名称。
- `GITHUB_TOKEN`：可选。提高 GitHub 公开搜索接口限额；不配置时仍可匿名搜索。
- `BRAVE_SEARCH_API_KEY`：可选。用于发现政府/高校就业网、公开网页及搜索引擎已收录的小红书招聘线索。

通用 OpenAI 兼容配置与 Azure OpenAI 配置二选一即可；两者同时存在时优先使用 Azure OpenAI。

部署到 GitHub Pages 时，请在仓库的 `Settings → Secrets and variables → Actions`
中保存 `AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_ENDPOINT`、
`AZURE_OPENAI_API_VERSION` 和 `AZURE_OPENAI_DEPLOYMENT`。工作流会把这些
Secrets 注入采集进程；它们不会出现在网页、采集结果或仓库文件中。

## 本地运行

```bash
npm install
npm run dev
```

手动触发本地采集：

```bash
curl -X POST http://localhost:3000/api/agent/run -H "X-Agent-Local: true"
```

生产环境调用：

```bash
curl -X POST https://你的域名/api/agent/run -H "Authorization: Bearer $AGENT_SECRET"
```

项目内置 Cloudflare Worker `scheduled` 处理器。部署环境如未自动绑定 Cron Trigger，可使用仓库中的 GitHub Actions 工作流每天调用上述安全接口。

## 增加数据源

在 `data/sources.ts` 中增加一项官方招聘网站配置即可。Agent 会自动发现包含“招聘、校招、毕业生、岗位”等关键词的链接，继续读取公告详情，再筛选计算机相关内容。

小红书不提供面向公开内容的通用搜索接口，本项目不会绕过登录或风控直接抓取；配置 `BRAVE_SEARCH_API_KEY` 后，仅使用公开搜索结果中的标题、摘要和链接作为待核验线索。所有社区线索都应以企业官网最终公告为准。

## 安全提交搜索 API

不要把真实密钥提交到 Git，也不要粘贴到网页表单。请在项目根目录已忽略的 `.env.local` 中加入：

```bash
BRAVE_SEARCH_API_KEY=你的搜索API密钥
GITHUB_TOKEN=你的可选GitHub令牌
```

保存后只需告诉 Codex“密钥已放好”。Codex 会在不回显密钥的前提下，把它同步为 Sites 生产 Secret 并重新部署。Azure OpenAI 用于岗位识别和结构化，不能替代互联网搜索 API。

## 军工科研院所

直连来源包括中国工程物理研究院（绵阳九院）、中国电科 29 所与 38 所、航空工业成都所（611 所）和沈阳所（601 所），并通过航天科技、航天科工、中国航发、兵器工业及中核集团招聘平台覆盖其所属研究院所。仅聚合各单位公开发布的招聘信息。
