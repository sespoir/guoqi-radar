import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the finished recruitment product", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /RecruitmentDashboard/);
  assert.match(layout, /国企雷达/);
  assert.match(css, /\.job-card/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout, /codex-preview|SkeletonPreview/);
});

test("contains the crawler, API route, persistence and scheduler", async () => {
  const [agent, route, schema, worker, config, sources, envExample, dashboard] = await Promise.all([
    readFile(new URL("lib/agent.ts", root), "utf8"),
    readFile(new URL("app/api/agent/run/route.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("data/sources.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL("components/RecruitmentDashboard.tsx", root), "utf8"),
  ]);

  assert.match(agent, /runRecruitmentAgent/);
  assert.match(route, /AGENT_SECRET/);
  assert.match(schema, /sourceRuns/);
  assert.match(worker, /scheduled/);
  assert.match(config, /"d1": "DB"/);
  assert.ok((sources.match(/id: "/g) ?? []).length >= 20);
  assert.match(agent, /AZURE_OPENAI_API_KEY/);
  assert.match(envExample, /AZURE_OPENAI_DEPLOYMENT/);
  assert.match(agent, /api\.github\.com\/search\/issues/);
  assert.match(agent, /api\.search\.brave\.com/);
  assert.match(envExample, /BRAVE_SEARCH_API_KEY/);
  assert.match(schema, /verificationLevel/);
  assert.match(dashboard, /官网核验/);
  assert.match(dashboard, /小红书公开索引/);
  assert.match(dashboard, /包含工作地为“全国”的岗位/);
  assert.match(sources, /中物院（绵阳九院）人才招聘/);
  assert.match(sources, /中国电科29所招聘专区/);
  assert.match(agent, /searchPostInfoByDeptForMain/);
  assert.match(agent, /军工 研究所 校园招聘/);
});
