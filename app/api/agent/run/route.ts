import { env } from "cloudflare:workers";
import { runRecruitmentAgent } from "@/lib/agent";
import type { AgentEnv } from "@/lib/types";

export const dynamic = "force-dynamic";

function isLocalRequest(request: Request) {
  const url = new URL(request.url);
  return (
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    request.headers.get("x-agent-local") === "true"
  );
}

function isAuthenticatedSitesRequest(request: Request) {
  const url = new URL(request.url);
  return (
    url.hostname.endsWith(".chatgpt.site") &&
    Boolean(request.headers.get("oai-authenticated-user-email"))
  );
}

export async function POST(request: Request) {
  const runtimeEnv = env as unknown as AgentEnv;
  const authorization = request.headers.get("authorization");
  const authenticated =
    (runtimeEnv.AGENT_SECRET &&
      authorization === `Bearer ${runtimeEnv.AGENT_SECRET}`) ||
    isAuthenticatedSitesRequest(request) ||
    isLocalRequest(request);

  if (!authenticated) {
    return Response.json(
      {
        error: runtimeEnv.AGENT_SECRET
          ? "未授权"
          : "尚未配置 AGENT_SECRET，采集接口已安全关闭",
      },
      { status: runtimeEnv.AGENT_SECRET ? 401 : 503 },
    );
  }

  try {
    const result = await runRecruitmentAgent(runtimeEnv);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent 运行失败" },
      { status: 500 },
    );
  }
}
