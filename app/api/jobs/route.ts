import { env } from "cloudflare:workers";
import { recruitmentSources } from "@/data/sources";
import { seedJobs } from "@/data/seed-jobs";
import { getAgentStatus, listJobs } from "@/lib/database";
import type { AgentEnv, JobsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeEnv = env as unknown as AgentEnv;
  try {
    const [jobs, status] = await Promise.all([
      listJobs(runtimeEnv.DB),
      getAgentStatus(runtimeEnv),
    ]);
    const response: JobsResponse = {
      jobs: jobs.length ? jobs : seedJobs,
      status: {
        ...status,
        sourceCount:
          recruitmentSources.filter((source) => source.enabled).length + 2,
      },
      dataOrigin: jobs.length ? "database" : "seed",
    };
    return Response.json(response, {
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch {
    const response: JobsResponse = {
      jobs: seedJobs,
      status: {
        lastRunAt: null,
        lastRunStatus: "等待首次采集",
        aiEnabled: false,
        sourceCount:
          recruitmentSources.filter((source) => source.enabled).length + 2,
        successfulSources: 0,
        failedSources: 0,
        latestRuns: [],
      },
      dataOrigin: "seed",
    };
    return Response.json(response);
  }
}
