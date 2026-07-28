"use client";

import { useEffect, useMemo, useState } from "react";
import { recruitmentSources } from "@/data/sources";
import { seedJobs } from "@/data/seed-jobs";
import type { AgentStatus, Job, JobsResponse } from "@/lib/types";

const categories = ["全部", "软件开发", "数据与人工智能", "网络安全", "云计算", "通信与网络", "硬件与嵌入式", "信息技术"];

const emptyStatus: AgentStatus = {
  lastRunAt: null,
  lastRunStatus: "等待首次采集",
  aiEnabled: false,
  sourceCount: recruitmentSources.length + 2,
  successfulSources: 0,
  failedSources: 0,
  latestRuns: [],
};

function formatDate(value: string | null, fallback = "未注明") {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [, month, day] = value.split("-");
    return `${month}/${day}`;
  }
  const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatFullTime(value: string | null) {
  if (!value) return "等待首次采集";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function companyMark(company: string) {
  return company.replace(/中国|国家|国务院/g, "").slice(0, 2) || "国企";
}

function statusLabel(status: string) {
  if (status === "success") return "巡查完成";
  if (status === "partial") return "部分站点受限";
  if (status === "failed") return "巡查需检查";
  return "等待首次巡查";
}

function verificationLabel(level: Job["verificationLevel"]) {
  if (level === "official") return "官网核验";
  if (level === "trusted") return "可信转载";
  return "待核验线索";
}

function channelLabel(channel: Job["discoveryChannel"]) {
  if (channel === "official_site") return "企业官网";
  if (channel === "government") return "政府平台";
  if (channel === "university") return "高校就业网";
  if (channel === "github") return "GitHub";
  if (channel === "xiaohongshu") return "小红书公开索引";
  return "公开网页搜索";
}

export default function RecruitmentDashboard() {
  const [jobs, setJobs] = useState<Job[]>(seedJobs);
  const [status, setStatus] = useState<AgentStatus>(emptyStatus);
  const [dataOrigin, setDataOrigin] = useState<"database" | "seed">("seed");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [jobType, setJobType] = useState("全部类型");
  const [location, setLocation] = useState("全部地区");
  const [verification, setVerification] = useState("全部来源");
  const [sort, setSort] = useState("最新发布");
  const [showExpired, setShowExpired] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("guoqi-radar-saved");
      if (saved) {
        try {
          setSavedIds(new Set(JSON.parse(saved)));
        } catch {
          setSavedIds(new Set());
        }
      }
    });

    async function loadJobs() {
      const response = await fetch("/api/jobs");
      const payload = await response.json() as JobsResponse;
      if (cancelled) return;
      setJobs(payload.jobs);
      setStatus(payload.status);
      setDataOrigin(payload.dataOrigin);

      if (payload.dataOrigin === "seed") {
        const runResponse = await fetch("/api/agent/run", { method: "POST" });
        if (!runResponse.ok || cancelled) return;
        const refreshedResponse = await fetch("/api/jobs");
        const refreshed = await refreshedResponse.json() as JobsResponse;
        if (cancelled) return;
        setJobs(refreshed.jobs);
        setStatus(refreshed.status);
        setDataOrigin(refreshed.dataOrigin);
      }
    }

    loadJobs()
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const locations = useMemo(() => {
    const values = new Set<string>();
    jobs.forEach((job) =>
      job.location
        .split(/\s*\/\s*/)
        .filter(Boolean)
        .forEach((item) => values.add(item)),
    );
    return ["全部地区", ...Array.from(values).slice(0, 16)];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return jobs
      .filter((job) => {
        if (!showExpired && job.status === "expired") return false;
        if (category !== "全部" && job.category !== category) return false;
        if (jobType !== "全部类型" && job.jobType !== jobType) return false;
        if (
          location !== "全部地区" &&
          !job.location.includes("全国") &&
          !job.location.includes(location)
        ) return false;
        if (
          verification !== "全部来源" &&
          verificationLabel(job.verificationLevel) !== verification
        ) return false;
        if (!normalizedQuery) return true;
        return [
          job.company,
          job.title,
          job.location,
          job.category,
          job.summary,
          ...job.skills,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sort === "相关度") return b.relevanceScore - a.relevanceScore;
        if (sort === "截止时间") {
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return a.deadline.localeCompare(b.deadline);
        }
        return (b.publishedAt ?? b.collectedAt).localeCompare(a.publishedAt ?? a.collectedAt);
      });
  }, [jobs, query, category, jobType, location, verification, sort, showExpired]);

  const newCount = jobs.filter((job) => job.isNew).length;
  const companyCount = new Set(jobs.map((job) => job.company)).size;
  const githubDiscoveryRun = status.latestRuns.find(
    (run) => run.sourceId === "discovery-github",
  );
  const searchDiscoveryRun = status.latestRuns.find(
    (run) => run.sourceId === "discovery-search",
  );

  function toggleSaved(id: string) {
    const next = new Set(savedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSavedIds(next);
    window.localStorage.setItem("guoqi-radar-saved", JSON.stringify(Array.from(next)));
  }

  function resetFilters() {
    setQuery("");
    setCategory("全部");
    setJobType("全部类型");
    setLocation("全部地区");
    setVerification("全部来源");
    setShowExpired(false);
  }

  const filterPanel = (
    <div className="filter-panel">
      <div className="filter-heading">
        <div>
          <p className="eyebrow">精确筛选</p>
          <h2>找到适合你的岗位</h2>
        </div>
        <button className="text-button" onClick={resetFilters} type="button">重置</button>
      </div>
      <label className="field-label" htmlFor="job-type">招聘类型</label>
      <select id="job-type" value={jobType} onChange={(event) => setJobType(event.target.value)}>
        <option>全部类型</option>
        <option>校园招聘</option>
        <option>社会招聘</option>
        <option>公开招聘</option>
        <option>实习</option>
      </select>
      <label className="field-label" htmlFor="location">工作地区</label>
      <select id="location" value={location} onChange={(event) => setLocation(event.target.value)}>
        {locations.map((item) => <option key={item}>{item}</option>)}
      </select>
      <small className="field-help">选择具体城市时，也会包含工作地为“全国”的岗位。</small>
      <label className="field-label" htmlFor="verification">核验等级</label>
      <select
        id="verification"
        value={verification}
        onChange={(event) => setVerification(event.target.value)}
      >
        <option>全部来源</option>
        <option>官网核验</option>
        <option>可信转载</option>
        <option>待核验线索</option>
      </select>
      <label className="toggle-row">
        <span>
          <strong>显示已截止岗位</strong>
          <small>默认只看仍可申请的信息</small>
        </span>
        <input
          type="checkbox"
          checked={showExpired}
          onChange={(event) => setShowExpired(event.target.checked)}
        />
        <span className="toggle" aria-hidden="true" />
      </label>
      <div className="filter-note">
        <span className="filter-note-icon">准</span>
        <p><strong>AI 相关度</strong><br />仅保留计算机及相近专业岗位，规则筛选始终可用。</p>
      </div>
    </div>
  );

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="国企雷达首页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>国企雷达</span>
        </a>
        <nav aria-label="主导航">
          <a className="active" href="#jobs">岗位</a>
          <a href="#sources">数据源</a>
          <a href="#about">关于</a>
        </nav>
        <div className="update-badge"><span /> 每日更新</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="hero-kicker"><span>AI</span> 国企技术岗聚合 Agent</p>
            <h1>不错过每一个<br /><em>适合你的技术岗位</em></h1>
            <p className="hero-description">每天巡查国企官网与军工科研院所，并从 GitHub、高校就业网、公开网页与搜索引擎已收录的小红书内容补充线索，再自动识别计算机相关岗位。</p>
          </div>
          <div className="agent-visual" aria-label="Agent 工作状态">
            <div className="radar">
              <span className="radar-ring ring-one" />
              <span className="radar-ring ring-two" />
              <span className="radar-line" />
              <span className="radar-dot dot-one" />
              <span className="radar-dot dot-two" />
              <span className="radar-dot dot-three" />
              <div className="radar-core">R</div>
            </div>
            <div className="agent-visual-copy">
              <small>AGENT STATUS</small>
              <strong>{statusLabel(status.lastRunStatus)}</strong>
              <span>{recruitmentSources.length} 个官网 + 多渠道发现</span>
            </div>
          </div>
        </div>

        <div className="search-shell">
          <span className="search-icon" aria-hidden="true" />
          <label className="sr-only" htmlFor="job-search">搜索企业、岗位、技能或城市</label>
          <input
            id="job-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索企业、岗位、技能或城市…"
          />
          <button type="button" onClick={() => document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" })}>搜索岗位</button>
        </div>

        <div className="stats-strip">
          <div><strong>{jobs.length}</strong><span>条技术招聘</span></div>
          <div><strong>{companyCount}</strong><span>家发布单位</span></div>
          <div><strong>{newCount || "—"}</strong><span>今日新增</span></div>
          <div className="last-update"><span className="pulse" /><span>最近更新<br /><b>{formatFullTime(status.lastRunAt)}</b></span></div>
        </div>
      </section>

      {dataOrigin === "seed" && (
        <div className="notice-banner" role="status">
          <span>试</span>
          <p><strong>当前展示来源样例。</strong> 完成首次 Agent 采集后，这里会自动切换为数据库中的实时结果。</p>
        </div>
      )}
      {dataOrigin === "database" && jobs.some((job) => job.verificationLevel !== "official") && (
        <div className="notice-banner trust-banner" role="note">
          <span>验</span>
          <p><strong>多渠道线索已分级展示。</strong> 高校转载与社区搜索结果用于“发现”，报名条件和截止时间仍应回到企业官网核验。</p>
        </div>
      )}

      <section className="workspace" id="jobs">
        <aside className="desktop-filters">{filterPanel}</aside>
        <div className="job-content">
          <div className="job-toolbar">
            <div>
              <p className="eyebrow">RECRUITMENT FEED</p>
              <h2>最新技术岗位 <span>{filteredJobs.length}</span></h2>
            </div>
            <div className="toolbar-actions">
              <button className="filter-trigger" type="button" onClick={() => setMobileFiltersOpen(true)}>筛选</button>
              <label>
                <span className="sr-only">排序方式</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option>最新发布</option>
                  <option>相关度</option>
                  <option>截止时间</option>
                </select>
              </label>
            </div>
          </div>

          <div className="category-tabs" aria-label="岗位分类">
            {categories.map((item) => (
              <button
                type="button"
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="job-list">
            {filteredJobs.length ? filteredJobs.map((job) => (
              <article className="job-card" key={job.id}>
                <div className="company-avatar">{companyMark(job.company)}</div>
                <div className="job-main">
                  <div className="job-topline">
                    <div>
                      <div className="company-line">
                        <span>{job.company}</span>
                        <b className={`verification-pill ${job.verificationLevel}`}>
                          {verificationLabel(job.verificationLevel)}
                        </b>
                        {job.isNew && <b className="new-pill">今日新增</b>}
                        {job.isSeed && <b className="sample-pill">来源样例</b>}
                      </div>
                      <h3>{job.title}</h3>
                    </div>
                    <button
                      type="button"
                      className={`save-button ${savedIds.has(job.id) ? "saved" : ""}`}
                      onClick={() => toggleSaved(job.id)}
                      aria-label={savedIds.has(job.id) ? "取消收藏" : "收藏岗位"}
                    >
                      {savedIds.has(job.id) ? "★" : "☆"}
                    </button>
                  </div>
                  <div className="job-meta">
                    <span><i className="pin" />{job.location}</span>
                    <span><i className="cap" />{job.education}</span>
                    <span><i className="briefcase" />{job.jobType}</span>
                  </div>
                  <p className="job-summary">{job.summary}</p>
                  <div className="skills">
                    {job.skills.map((skill) => <span key={skill}>{skill}</span>)}
                  </div>
                  <div className="job-footer">
                    <div className="dates">
                      <span>发布 {formatDate(job.publishedAt)}</span>
                      <span className={job.deadline ? "deadline" : ""}>截止 {formatDate(job.deadline, "以官网为准")}</span>
                      <span className="score">匹配度 {job.relevanceScore}%</span>
                      <span>发现于 {channelLabel(job.discoveryChannel)}</span>
                    </div>
                    <a href={job.sourceUrl} target="_blank" rel="noreferrer">
                      {job.verificationLevel === "official"
                        ? "查看官方公告"
                        : job.verificationLevel === "trusted"
                          ? "查看可信转载"
                          : "查看待核验线索"} <span>↗</span>
                    </a>
                  </div>
                </div>
              </article>
            )) : (
              <div className="empty-state">
                <div>⌁</div>
                <h3>没有找到符合条件的岗位</h3>
                <p>换个关键词或放宽筛选条件试试。</p>
                <button type="button" onClick={resetFilters}>清除筛选</button>
              </div>
            )}
          </div>
        </div>

        <aside className="right-rail">
          <section className="rail-card agent-card">
            <div className="rail-title">
              <div><p className="eyebrow">AGENT MONITOR</p><h2>巡查状态</h2></div>
              <span className="live-dot">{status.lastRunStatus === "success" ? "正常" : "可用"}</span>
            </div>
            <div className="agent-metric">
              <div className="mini-radar"><span /><i /></div>
              <p><strong>{formatFullTime(status.lastRunAt)}</strong><span>最近一次巡查</span></p>
            </div>
            <div className="agent-grid">
              <div><strong>{status.sourceCount}</strong><span>数据源</span></div>
              <div><strong>{status.aiEnabled ? "AI" : "规则"}</strong><span>识别模式</span></div>
            </div>
            <p className="rail-footnote">下一次计划巡查：每天 09:00</p>
          </section>

          <section className="rail-card" id="sources">
            <div className="rail-title">
              <div><p className="eyebrow">OFFICIAL + DISCOVERY</p><h2>重点数据源</h2></div>
              <span>{recruitmentSources.length} 官网</span>
            </div>
            <div className="source-list">
              {recruitmentSources.map((source) => {
                const run = status.latestRuns.find((item) => item.sourceId === source.id);
                return (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                    <span className={`source-dot ${run?.status === "failed" ? "failed" : ""}`} />
                    <span><strong>{source.company}</strong><small>{run ? `${run.accepted} 条命中` : "等待巡查"}</small></span>
                    <b>↗</b>
                  </a>
                );
              })}
            </div>
            <div className="discovery-summary">
              <strong>补充发现渠道</strong>
              <span>
                GitHub 公开搜索 · {githubDiscoveryRun
                  ? `${githubDiscoveryRun.accepted} 条命中`
                  : "等待巡查"}
              </span>
              <span>
                网页 / 高校 / 小红书公开索引 · {searchDiscoveryRun
                  ? searchDiscoveryRun.status === "partial"
                    ? "等待搜索 API"
                    : `${searchDiscoveryRun.accepted} 条命中`
                  : "等待巡查"}
              </span>
            </div>
          </section>

          <section className="rail-card explainer" id="about">
            <span className="explainer-mark">01</span>
            <h3>为什么只看技术岗？</h3>
            <p>Agent 会结合岗位名称、专业要求与正文内容，只保留计算机及相近专业机会，减少无效信息。</p>
          </section>
        </aside>
      </section>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>国企雷达</span>
        </div>
        <p>官网、可信转载与社区线索均会标明核验等级；报名条件、时间和结果始终以企业官方公告为准。</p>
        <span>由 Agent 每日巡查更新</span>
      </footer>

      {mobileFiltersOpen && (
        <div className="filter-modal" role="dialog" aria-modal="true" aria-label="岗位筛选">
          <button className="modal-backdrop" type="button" aria-label="关闭筛选" onClick={() => setMobileFiltersOpen(false)} />
          <div className="filter-sheet">
            <button className="sheet-close" type="button" onClick={() => setMobileFiltersOpen(false)}>×</button>
            {filterPanel}
            <button className="apply-button" type="button" onClick={() => setMobileFiltersOpen(false)}>查看 {filteredJobs.length} 个结果</button>
          </div>
        </div>
      )}
    </main>
  );
}
