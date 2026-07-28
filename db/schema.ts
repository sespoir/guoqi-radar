import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default("全国"),
    education: text("education").notNull().default("详见公告"),
    jobType: text("job_type").notNull().default("招聘公告"),
    category: text("category").notNull().default("信息技术"),
    publishedAt: text("published_at"),
    deadline: text("deadline"),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    verificationLevel: text("verification_level").notNull().default("official"),
    discoveryChannel: text("discovery_channel").notNull().default("official_site"),
    discoveryUrl: text("discovery_url"),
    summary: text("summary").notNull(),
    skills: text("skills").notNull().default("[]"),
    relevanceScore: integer("relevance_score").notNull().default(50),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("active"),
    collectedAt: text("collected_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("jobs_source_url_unique").on(table.sourceUrl),
    index("jobs_status_idx").on(table.status),
    index("jobs_collected_at_idx").on(table.collectedAt),
    index("jobs_company_idx").on(table.company),
    index("jobs_verification_level_idx").on(table.verificationLevel),
    index("jobs_discovery_channel_idx").on(table.discoveryChannel),
  ],
);

export const sourceRuns = sqliteTable(
  "source_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    status: text("status").notNull(),
    discovered: integer("discovered").notNull().default(0),
    accepted: integer("accepted").notNull().default(0),
    message: text("message"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
  },
  (table) => [index("source_runs_finished_at_idx").on(table.finishedAt)],
);

export const agentMeta = sqliteTable("agent_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
