const categories = [
  "全部",
  "软件开发",
  "数据与人工智能",
  "网络安全",
  "云计算",
  "通信与网络",
  "硬件与嵌入式",
  "信息技术",
];

const state = {
  jobs: [],
  status: null,
  query: "",
  category: "全部",
  jobType: "全部类型",
  location: "全部地区",
  verification: "全部来源",
  sort: "最新发布",
  showExpired: false,
  saved: new Set(JSON.parse(localStorage.getItem("guoqi-radar-saved") || "[]")),
};

const elements = Object.fromEntries(
  [
    "search",
    "search-button",
    "job-type",
    "location",
    "verification",
    "show-expired",
    "sort",
    "reset-filters",
    "category-tabs",
    "job-list",
    "visible-count",
    "job-count",
    "company-count",
    "new-count",
    "last-updated",
    "agent-status",
    "agent-source-count",
    "health",
    "run-time",
    "source-count",
    "ai-mode",
    "source-list",
  ].map((id) => [id, document.getElementById(id)]),
);

function text(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function dateLabel(value, fallback = "未注明") {
  if (!value) return fallback;
  const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function timeLabel(value) {
  if (!value) return "等待首次采集";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function verificationLabel(level) {
  if (level === "official") return "官网核验";
  if (level === "trusted") return "可信转载";
  return "待核验线索";
}

function channelLabel(channel) {
  const labels = {
    official_site: "企业官网",
    government: "政府平台",
    university: "高校就业网",
    github: "GitHub",
    xiaohongshu: "小红书公开索引",
    web_search: "公开网页搜索",
  };
  return labels[channel] || "公开来源";
}

function companyMark(company) {
  return String(company || "国企").replace(/中国|国家|国务院/g, "").slice(0, 2) || "国企";
}

function statusLabel(value) {
  if (value === "success") return "巡查完成";
  if (value === "partial") return "部分站点受限";
  if (value === "failed") return "巡查需检查";
  return value || "等待首次巡查";
}

function filteredJobs() {
  const query = state.query.trim().toLowerCase();
  return state.jobs
    .filter((job) => {
      if (!state.showExpired && job.status === "expired") return false;
      if (state.category !== "全部" && job.category !== state.category) return false;
      if (state.jobType !== "全部类型" && job.jobType !== state.jobType) return false;
      if (
        state.location !== "全部地区" &&
        !String(job.location).includes("全国") &&
        !String(job.location).includes(state.location)
      ) return false;
      if (
        state.verification !== "全部来源" &&
        verificationLabel(job.verificationLevel) !== state.verification
      ) return false;
      if (!query) return true;
      return [
        job.company,
        job.title,
        job.location,
        job.category,
        job.summary,
        ...(Array.isArray(job.skills) ? job.skills : []),
      ].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (state.sort === "相关度") return Number(b.relevanceScore) - Number(a.relevanceScore);
      if (state.sort === "截止时间") {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return String(a.deadline).localeCompare(String(b.deadline));
      }
      return String(b.publishedAt || b.collectedAt).localeCompare(
        String(a.publishedAt || a.collectedAt),
      );
    });
}

function renderTabs() {
  elements["category-tabs"].innerHTML = categories.map((category) => `
    <button
      type="button"
      class="${state.category === category ? "active" : ""}"
      data-category="${text(category)}"
    >${text(category)}</button>
  `).join("");
}

function renderJobs() {
  const jobs = filteredJobs();
  elements["visible-count"].textContent = jobs.length;
  renderTabs();

  if (!jobs.length) {
    elements["job-list"].innerHTML = `
      <div class="empty-state">
        <strong>没有找到符合条件的岗位</strong>
        <p>换个关键词或放宽筛选条件试试。</p>
      </div>
    `;
    return;
  }

  elements["job-list"].innerHTML = jobs.map((job) => {
    const saved = state.saved.has(job.id);
    const skills = Array.isArray(job.skills) ? job.skills.slice(0, 5) : [];
    const linkText =
      job.verificationLevel === "official"
        ? "查看官方公告"
        : job.verificationLevel === "trusted"
          ? "查看可信转载"
          : "查看待核验线索";
    return `
      <article class="job-card">
        <div class="company-avatar">${text(companyMark(job.company))}</div>
        <div>
          <div class="job-topline">
            <div>
              <div class="company-line">
                <span>${text(job.company)}</span>
                <b class="verification-pill ${text(job.verificationLevel)}">
                  ${verificationLabel(job.verificationLevel)}
                </b>
                ${job.isNew ? '<b class="new-pill">今日新增</b>' : ""}
              </div>
              <h3>${text(job.title)}</h3>
            </div>
            <button
              class="save-button ${saved ? "saved" : ""}"
              type="button"
              data-save="${text(job.id)}"
              aria-label="${saved ? "取消收藏" : "收藏岗位"}"
            >${saved ? "★" : "☆"}</button>
          </div>
          <div class="job-meta">
            <span>地点 · ${text(job.location)}</span>
            <span>学历 · ${text(job.education)}</span>
            <span>${text(job.jobType)}</span>
          </div>
          <p class="job-summary">${text(job.summary)}</p>
          <div class="skills">${skills.map((skill) => `<span>${text(skill)}</span>`).join("")}</div>
          <div class="job-footer">
            <div class="dates">
              <span>发布 ${dateLabel(job.publishedAt)}</span>
              <span class="${job.deadline ? "deadline" : ""}">
                截止 ${dateLabel(job.deadline, "以官网为准")}
              </span>
              <span class="score">匹配度 ${Number(job.relevanceScore) || 0}%</span>
              <span>发现于 ${channelLabel(job.discoveryChannel)}</span>
            </div>
            <a href="${text(safeUrl(job.sourceUrl))}" target="_blank" rel="noreferrer">
              ${linkText} ↗
            </a>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderStatus() {
  const status = state.status || {};
  const jobs = state.jobs;
  elements["job-count"].textContent = jobs.length;
  elements["company-count"].textContent = new Set(jobs.map((job) => job.company)).size;
  elements["new-count"].textContent = jobs.filter((job) => job.isNew).length || "—";
  elements["last-updated"].textContent = timeLabel(status.lastRunAt);
  elements["run-time"].textContent = timeLabel(status.lastRunAt);
  elements["agent-status"].textContent = statusLabel(status.lastRunStatus);
  elements["agent-source-count"].textContent = `${Number(status.sourceCount) || 0} 个官网与发现渠道`;
  elements["source-count"].textContent = Number(status.sourceCount) || "—";
  elements["ai-mode"].textContent = status.aiEnabled ? "AI" : "规则";
  elements["health"].textContent =
    status.lastRunStatus === "success" ? "正常" : status.lastRunStatus === "failed" ? "需检查" : "可用";

  const runs = Array.isArray(status.latestRuns) ? status.latestRuns : [];
  elements["source-list"].innerHTML = runs.length
    ? runs.map((run) => `
        <div class="source-row">
          <span class="source-dot ${text(run.status)}"></span>
          <p>
            <strong>${text(run.sourceName)}</strong>
            <small>${Number(run.accepted) || 0} 条命中 · ${text(run.status)}</small>
          </p>
        </div>
      `).join("")
    : '<div class="loading-card">等待首次巡查记录</div>';
}

function populateLocations() {
  const values = new Set();
  state.jobs.forEach((job) => {
    String(job.location || "")
      .split(/\s*\/\s*/)
      .filter(Boolean)
      .forEach((location) => values.add(location));
  });
  elements.location.innerHTML = ["全部地区", ...Array.from(values).slice(0, 40)]
    .map((location) => `<option>${text(location)}</option>`)
    .join("");
}

function resetFilters() {
  state.query = "";
  state.category = "全部";
  state.jobType = "全部类型";
  state.location = "全部地区";
  state.verification = "全部来源";
  state.showExpired = false;
  elements.search.value = "";
  elements["job-type"].value = "全部类型";
  elements.location.value = "全部地区";
  elements.verification.value = "全部来源";
  elements["show-expired"].checked = false;
  renderJobs();
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderJobs();
});
elements["search-button"].addEventListener("click", () => {
  document.getElementById("jobs").scrollIntoView({ behavior: "smooth" });
});
elements["job-type"].addEventListener("change", (event) => {
  state.jobType = event.target.value;
  renderJobs();
});
elements.location.addEventListener("change", (event) => {
  state.location = event.target.value;
  renderJobs();
});
elements.verification.addEventListener("change", (event) => {
  state.verification = event.target.value;
  renderJobs();
});
elements["show-expired"].addEventListener("change", (event) => {
  state.showExpired = event.target.checked;
  renderJobs();
});
elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderJobs();
});
elements["reset-filters"].addEventListener("click", resetFilters);
elements["category-tabs"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderJobs();
});
elements["job-list"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-save]");
  if (!button) return;
  const id = button.dataset.save;
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  localStorage.setItem("guoqi-radar-saved", JSON.stringify(Array.from(state.saved)));
  renderJobs();
});

fetch("./data/jobs.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((payload) => {
    state.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    state.status = payload.status || {};
    populateLocations();
    renderStatus();
    renderJobs();
  })
  .catch(() => {
    elements["job-list"].innerHTML = `
      <div class="empty-state">
        <strong>最新数据暂时无法读取</strong>
        <p>自动采集任务可能正在运行，请稍后刷新页面。</p>
      </div>
    `;
    elements["agent-status"].textContent = "数据读取失败";
    elements.health.textContent = "需检查";
  });
