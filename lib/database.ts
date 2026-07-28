import { recruitmentSources } from "@/data/sources";
import type { AgentEnv, AgentStatus, Job, SourceRun } from "@/lib/types";

let initialized: Promise<void> | null = null;

export async function ensureSchema(db: D1Database) {
  if (!initialized) {
    initialized = (async () => {
      await db.batch([
        db.prepare(`
          CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            company TEXT NOT NULL,
            title TEXT NOT NULL,
            location TEXT NOT NULL DEFAULT '全国',
            education TEXT NOT NULL DEFAULT '详见公告',
            job_type TEXT NOT NULL DEFAULT '招聘公告',
            category TEXT NOT NULL DEFAULT '信息技术',
            published_at TEXT,
            deadline TEXT,
            source_name TEXT NOT NULL,
            source_url TEXT NOT NULL,
            verification_level TEXT NOT NULL DEFAULT 'official',
            discovery_channel TEXT NOT NULL DEFAULT 'official_site',
            discovery_url TEXT,
            summary TEXT NOT NULL,
            skills TEXT NOT NULL DEFAULT '[]',
            relevance_score INTEGER NOT NULL DEFAULT 50,
            content_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            collected_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
        db.prepare(`
          CREATE TABLE IF NOT EXISTS source_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            status TEXT NOT NULL,
            discovered INTEGER NOT NULL DEFAULT 0,
            accepted INTEGER NOT NULL DEFAULT 0,
            message TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL
          )
        `),
        db.prepare(`
          CREATE TABLE IF NOT EXISTS agent_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
      ]);

      const tableInfo = await db
        .prepare("PRAGMA table_info(jobs)")
        .all<{ name: string }>();
      const columns = new Set(tableInfo.results.map((column) => column.name));
      const migrations: D1PreparedStatement[] = [];
      if (!columns.has("verification_level")) {
        migrations.push(
          db.prepare(
            "ALTER TABLE jobs ADD COLUMN verification_level TEXT NOT NULL DEFAULT 'official'",
          ),
        );
      }
      if (!columns.has("discovery_channel")) {
        migrations.push(
          db.prepare(
            "ALTER TABLE jobs ADD COLUMN discovery_channel TEXT NOT NULL DEFAULT 'official_site'",
          ),
        );
      }
      if (!columns.has("discovery_url")) {
        migrations.push(db.prepare("ALTER TABLE jobs ADD COLUMN discovery_url TEXT"));
      }
      if (migrations.length) await db.batch(migrations);

      await db.batch([
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_url_unique ON jobs (source_url)"),
        db.prepare("CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS jobs_collected_at_idx ON jobs (collected_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company)"),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS jobs_verification_level_idx ON jobs (verification_level)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS jobs_discovery_channel_idx ON jobs (discovery_channel)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS source_runs_finished_at_idx ON source_runs (finished_at)",
        ),
      ]);
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  return initialized;
}

type JobRow = {
  id: string;
  company: string;
  title: string;
  location: string;
  education: string;
  job_type: string;
  category: string;
  published_at: string | null;
  deadline: string | null;
  source_name: string;
  source_url: string;
  verification_level: Job["verificationLevel"];
  discovery_channel: Job["discoveryChannel"];
  discovery_url: string | null;
  summary: string;
  skills: string;
  relevance_score: number;
  status: "active" | "expired";
  collected_at: string;
  updated_at: string;
};

function parseSkills(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function listJobs(db: D1Database): Promise<Job[]> {
  await ensureSchema(db);
  const result = await db
    .prepare(`
      SELECT id, company, title, location, education, job_type, category,
             published_at, deadline, source_name, source_url,
             verification_level, discovery_channel, discovery_url, summary, skills,
             relevance_score, status, collected_at, updated_at
      FROM jobs
      WHERE status != 'excluded'
      ORDER BY
        CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
        published_at DESC,
        collected_at DESC
      LIMIT 500
    `)
    .all<JobRow>();

  const recentThreshold = Date.now() - 48 * 60 * 60 * 1000;
  return result.results.map((row) => ({
    id: row.id,
    company: row.company,
    title: row.title,
    location: row.location,
    education: row.education,
    jobType: row.job_type,
    category: row.category,
    publishedAt: row.published_at,
    deadline: row.deadline,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    verificationLevel: row.verification_level,
    discoveryChannel: row.discovery_channel,
    discoveryUrl: row.discovery_url,
    summary: row.summary,
    skills: parseSkills(row.skills),
    relevanceScore: row.relevance_score,
    status: row.status,
    collectedAt: row.collected_at,
    updatedAt: row.updated_at,
    isNew: new Date(row.collected_at).getTime() >= recentThreshold,
  }));
}

type MetaRow = { key: string; value: string };
type RunRow = {
  source_id: string;
  source_name: string;
  status: SourceRun["status"];
  discovered: number;
  accepted: number;
  message: string | null;
  started_at: string;
  finished_at: string;
};

export async function getAgentStatus(env: AgentEnv): Promise<AgentStatus> {
  await ensureSchema(env.DB);
  const [metaResult, runsResult] = await Promise.all([
    env.DB.prepare("SELECT key, value FROM agent_meta").all<MetaRow>(),
    env.DB.prepare(`
      SELECT source_id, source_name, status, discovered, accepted, message, started_at, finished_at
      FROM source_runs
      ORDER BY id DESC
      LIMIT 64
    `).all<RunRow>(),
  ]);
  const meta = new Map(metaResult.results.map((item) => [item.key, item.value]));
  const runs = runsResult.results.map((row) => ({
    sourceId: row.source_id,
    sourceName: row.source_name,
    status: row.status,
    discovered: row.discovered,
    accepted: row.accepted,
    message: row.message ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));

  return {
    lastRunAt: meta.get("last_run_at") ?? null,
    lastRunStatus: meta.get("last_run_status") ?? "尚未运行",
    aiEnabled: Boolean(
      (env.AI_API_KEY && env.AI_MODEL) ||
      (
        env.AZURE_OPENAI_API_KEY &&
        env.AZURE_OPENAI_ENDPOINT &&
        env.AZURE_OPENAI_API_VERSION &&
        env.AZURE_OPENAI_DEPLOYMENT
      ),
    ),
    sourceCount: recruitmentSources.filter((source) => source.enabled).length + 2,
    successfulSources: runs.filter((run) => run.status === "success").length,
    failedSources: runs.filter((run) => run.status === "failed").length,
    latestRuns: runs,
  };
}
