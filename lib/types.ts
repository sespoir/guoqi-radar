export type JobStatus = "active" | "expired";
export type VerificationLevel = "official" | "trusted" | "lead";
export type DiscoveryChannel =
  | "official_site"
  | "government"
  | "university"
  | "github"
  | "xiaohongshu"
  | "web_search";

export interface Job {
  id: string;
  company: string;
  title: string;
  location: string;
  education: string;
  jobType: string;
  category: string;
  publishedAt: string | null;
  deadline: string | null;
  sourceName: string;
  sourceUrl: string;
  verificationLevel: VerificationLevel;
  discoveryChannel: DiscoveryChannel;
  discoveryUrl: string | null;
  summary: string;
  skills: string[];
  relevanceScore: number;
  status: JobStatus;
  collectedAt: string;
  updatedAt: string;
  isNew?: boolean;
  isSeed?: boolean;
}

export interface SourceRun {
  sourceId: string;
  sourceName: string;
  status: "success" | "partial" | "failed";
  discovered: number;
  accepted: number;
  message?: string;
  startedAt: string;
  finishedAt: string;
}

export interface AgentStatus {
  lastRunAt: string | null;
  lastRunStatus: string;
  aiEnabled: boolean;
  sourceCount: number;
  successfulSources: number;
  failedSources: number;
  latestRuns: SourceRun[];
}

export interface JobsResponse {
  jobs: Job[];
  status: AgentStatus;
  dataOrigin: "database" | "seed";
}

export interface AgentEnv {
  DB: D1Database;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_API_VERSION?: string;
  AZURE_OPENAI_DEPLOYMENT?: string;
  GITHUB_TOKEN?: string;
  BRAVE_SEARCH_API_KEY?: string;
  AGENT_SECRET?: string;
}
