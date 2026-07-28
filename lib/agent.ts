import { recruitmentSources, type RecruitmentSource } from "@/data/sources";
import { ensureSchema } from "@/lib/database";
import type {
  AgentEnv,
  DiscoveryChannel,
  SourceRun,
  VerificationLevel,
} from "@/lib/types";

const recruitmentWords = ["招聘", "校招", "社会招聘", "校园招聘", "春招", "秋招", "应届", "岗位", "公开选聘", "诚聘"];
const blockedAnnouncementWords =
  /拟录用|录用结果|录取结果|笔试通知|笔试结果|面试通知|面试结果|资格审查|入围名单|公示名单|系统升级|中介机构|财务顾问|招生简章/;
const clearlyNonTechDepartmentWords =
  /财务|资金部|战略研究|企业策划|人力资源|干部人事|海外部|党建|企业文化|融媒体|审计|纪检|工会|法务|法律事务|投资管理|市场营销/;
const clearlyEditorialTitleWords =
  /求职新赛道|把握哪些机遇|理想offer|求职攻略|就业指导|职业规划|求职指南|就业形势/;
const clearlyGenericListingTitleWords =
  /(?:（|\()联合招聘(?:）|\))|招聘单位(?:名单)?|岗位汇总/;

const techKeywords: Record<string, string[]> = {
  "软件开发": ["软件", "开发", "程序员", "java", "python", "c++", "golang", "前端", "后端", "全栈", "测试开发", "研发工程师", "软件中心", "金融科技", "金科"],
  "数据与人工智能": ["人工智能", "ai", "算法", "机器学习", "深度学习", "大模型", "数据", "数据分析", "大数据", "数据治理", "智能计算"],
  "网络安全": ["网络安全", "信息安全", "安全工程", "密码", "攻防", "渗透", "安全运营", "零信任", "等保"],
  "云计算": ["云计算", "云平台", "容器", "kubernetes", "运维", "devops", "数据库", "分布式", "linux", "算力"],
  "通信与网络": ["通信", "网络工程", "5g", "无线", "传输", "核心网", "物联网", "卫星通信", "雷达"],
  "硬件与嵌入式": ["芯片", "集成电路", "嵌入式", "fpga", "单片机", "硬件", "信号处理", "微电子"],
  "信息技术": ["计算机", "电子信息", "数字化", "信息化", "信息科技", "科技岗位", "信息系统", "智能制造", "自动化"],
};

interface Candidate {
  company: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  verificationLevel: VerificationLevel;
  discoveryChannel: DiscoveryChannel;
  discoveryUrl: string | null;
  locationHint?: string;
  rawText: string;
  publishedAt: string | null;
}

interface ClassifiedCandidate extends Candidate {
  location: string;
  education: string;
  jobType: string;
  category: string;
  deadline: string | null;
  summary: string;
  skills: string[];
  relevanceScore: number;
  relevant: boolean;
}

interface AiRequestConfig {
  endpoint: string;
  headers: Record<string, string>;
  model?: string;
}

const knownPageMetadata: Record<
  string,
  { title: string; publishedAt: string; context: string }
> = {
  "https://www.chinatelecom.com.cn/ct/zp/167596.html": {
    title: "中国电信天翼云 2027 届超级优才招聘正式启动",
    publishedAt: "2026-07-07",
    context: "天翼云 2027 届超级优才招聘，聚焦云计算、人工智能、全栈云服务与自主可控技术方向。",
  },
  "https://www.chinatelecom.com.cn/ct/zp/167200.html": {
    title: "中国电信云计算研究院专业岗位招聘公告",
    publishedAt: "2026-06-10",
    context: "云计算研究院面向云计算基础理论、关键核心技术和前沿技术方向开展招聘。",
  },
  "https://www.chinatelecom.com.cn/ct/zp/165769.html": {
    title: "中国电信天翼视联 2026 校园招聘公告",
    publishedAt: "2026-04-02",
    context: "招聘方向覆盖视联网、人工智能与大数据等前沿技术。",
  },
};

export interface AgentRunResult {
  startedAt: string;
  finishedAt: string;
  discovered: number;
  accepted: number;
  inserted: number;
  updated: number;
  failedSources: number;
  aiEnabled: boolean;
  runs: SourceRun[];
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string) {
  const firstOpeningTag = value.indexOf("<");
  const firstClosingBracket = value.indexOf(">");
  const normalized =
    firstClosingBracket >= 0 &&
    (firstOpeningTag === -1 || firstClosingBracket < firstOpeningTag)
      ? value.slice(firstClosingBracket + 1)
      : value;
  return decodeHtml(
    normalized
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function containsKeyword(text: string, keyword: string) {
  const normalizedText = text.toLowerCase();
  const normalizedKeyword = keyword.toLowerCase();
  if (/^[a-z0-9+#.-]+$/.test(normalizedKeyword)) {
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedKeyword);
}

function normalizeUrl(href: string, baseUrl: string) {
  try {
    const url = new URL(decodeHtml(href.trim()), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "spm"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function inferDate(text: string) {
  const match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function extractCandidates(html: string, source: RecruitmentSource): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null && candidates.length < source.maxItems) {
    const title = stripHtml(match[3]).replace(/\s+/g, " ").trim();
    if (title.length < 6 || title.length > 140) continue;
    if (blockedAnnouncementWords.test(title)) continue;
    const lower = title.toLowerCase();
    if (!recruitmentWords.some((word) => lower.includes(word))) continue;
    const sourceUrl = normalizeUrl(match[2], source.url);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const contextStart = Math.max(0, match.index - 220);
    const contextEnd = Math.min(html.length, anchorPattern.lastIndex + 320);
    const context = stripHtml(html.slice(contextStart, contextEnd)).slice(0, 1200);
    candidates.push({
      company: source.company,
      title,
      sourceName: source.name,
      sourceUrl,
      verificationLevel: source.verificationLevel ?? "official",
      discoveryChannel: source.discoveryChannel ?? "official_site",
      discoveryUrl: null,
      locationHint: source.defaultLocation,
      rawText: context,
      publishedAt: inferDate(context),
    });
  }

  if (candidates.length === 0) {
    const headings = Array.from(
      html.matchAll(/<(?:h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/gi),
      (item) => stripHtml(item[1]).trim(),
    ).filter((item) => item.length >= 6 && item.length <= 140);
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? stripHtml(titleMatch[1]).trim() : "";
    const heading =
      headings.find((item) => recruitmentWords.some((word) => item.includes(word))) ??
      headings[0] ??
      pageTitle;
    const body = stripHtml(html).slice(0, 8000);
    const combined = `${heading} ${body}`.toLowerCase();
    const hasRecruitmentSignal = recruitmentWords.some((word) => combined.includes(word));
    const hasTechSignal = Object.values(techKeywords)
      .flat()
      .some((word) => containsKeyword(combined, word));
    if (heading.length >= 6 && hasRecruitmentSignal && hasTechSignal) {
      const headingIndex = body.indexOf(heading);
      const focusedBody =
        headingIndex >= 0 ? body.slice(headingIndex, headingIndex + 2400) : body.slice(0, 2400);
      candidates.push({
        company: source.company,
        title: heading.slice(0, 140),
        sourceName: source.name,
        sourceUrl: source.url,
        verificationLevel: source.verificationLevel ?? "official",
        discoveryChannel: source.discoveryChannel ?? "official_site",
        discoveryUrl: null,
        locationHint: source.defaultLocation,
        rawText: focusedBody,
        publishedAt: inferDate(body),
      });
    }
  }

  return candidates;
}

function uniqueKeywords(text: string) {
  const result: string[] = [];
  for (const words of Object.values(techKeywords)) {
    for (const keyword of words) {
      if (containsKeyword(text, keyword) && !result.includes(keyword)) result.push(keyword);
    }
  }
  return result.slice(0, 5);
}

function inferLocation(text: string) {
  const cities = [
    "北京", "上海", "深圳", "广州", "杭州", "南京", "成都", "武汉", "西安", "天津",
    "重庆", "长沙", "苏州", "合肥", "青岛", "厦门", "济南", "郑州", "沈阳", "大连",
    "绵阳", "无锡", "洛阳", "株洲", "贵阳", "哈尔滨", "长春", "兰州", "太原",
    "石家庄", "乌鲁木齐", "南昌", "宁波", "烟台", "珠海", "佛山", "东莞",
    "昆明", "桂林", "秦皇岛", "宜昌", "连云港", "嘉兴", "湘潭", "襄阳",
  ];
  const hits = cities.filter((city) => text.includes(city));
  return hits.length ? hits.slice(0, 3).join(" / ") : "全国";
}

function inferEducation(text: string) {
  if (/博士/.test(text)) return "博士";
  if (/硕士|研究生/.test(text) && /本科/.test(text)) return "本科及以上";
  if (/硕士|研究生/.test(text)) return "硕士及以上";
  if (/本科/.test(text)) return "本科及以上";
  if (/大专|专科/.test(text)) return "大专及以上";
  return "详见公告";
}

function classifyWithRules(candidate: Candidate): ClassifiedCandidate {
  const text = `${candidate.title} ${candidate.rawText}`.toLowerCase();
  let category = "信息技术";
  let bestHits: string[] = [];
  for (const [name, words] of Object.entries(techKeywords)) {
    const hits = words.filter((word) => containsKeyword(text, word));
    if (hits.length > bestHits.length) {
      category = name;
      bestHits = hits;
    }
  }
  const skills = uniqueKeywords(text);
  const titleTechHits = uniqueKeywords(candidate.title).length;
  const clearlyNonTechTitle =
    clearlyNonTechDepartmentWords.test(candidate.title) && titleTechHits === 0;
  const clearlyEditorialTitle = clearlyEditorialTitleWords.test(candidate.title);
  const clearlyGenericListingTitle =
    clearlyGenericListingTitleWords.test(candidate.title) && titleTechHits === 0;
  const hasStrongTechSignal = [
    "计算机", "软件", "人工智能", "网络安全", "信息安全", "云计算",
    "大数据", "信息科技", "电子信息", "通信工程", "集成电路", "算法",
  ].some((keyword) => text.includes(keyword));
  const score = Math.min(99, 28 + bestHits.length * 13 + titleTechHits * 14);
  const jobType = /校招|校园|毕业生|应届/.test(text)
    ? "校园招聘"
    : /社招|社会招聘/.test(text)
      ? "社会招聘"
      : /实习/.test(text)
        ? "实习"
        : "公开招聘";
  const deadlineMatch = text.match(/(?:截止|报名至)[^\d]{0,8}(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?)/);
  const deadline = deadlineMatch ? inferDate(deadlineMatch[1]) : null;
  const summaryBase = stripHtml(candidate.rawText).slice(0, 180);
  const inferredLocation = inferLocation(text);

  return {
    ...candidate,
    location:
      inferredLocation === "全国" && candidate.locationHint
        ? candidate.locationHint
        : inferredLocation,
    education: inferEducation(text),
    jobType,
    category,
    deadline,
    summary: summaryBase || `${candidate.company}发布招聘信息，岗位要求和报名时间请以官方公告为准。`,
    skills,
    relevanceScore: score,
    relevant:
      !clearlyNonTechTitle &&
      !clearlyEditorialTitle &&
      !clearlyGenericListingTitle &&
      (titleTechHits > 0 || hasStrongTechSignal || bestHits.length >= 2),
  };
}

function safeJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const value = fenced ? fenced[1] : raw;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response did not contain JSON");
  return JSON.parse(value.slice(start, end + 1));
}

function getAiRequestConfig(env: AgentEnv): AiRequestConfig | null {
  if (
    env.AZURE_OPENAI_API_KEY &&
    env.AZURE_OPENAI_ENDPOINT &&
    env.AZURE_OPENAI_API_VERSION &&
    env.AZURE_OPENAI_DEPLOYMENT
  ) {
    const endpoint = env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
    return {
      endpoint:
        `${endpoint}/openai/deployments/${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}` +
        `/chat/completions?api-version=${encodeURIComponent(env.AZURE_OPENAI_API_VERSION)}`,
      headers: {
        "content-type": "application/json",
        "api-key": env.AZURE_OPENAI_API_KEY,
      },
    };
  }
  if (!env.AI_API_KEY || !env.AI_MODEL) return null;
  return {
    endpoint: `${(env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.AI_API_KEY}`,
    },
    model: env.AI_MODEL,
  };
}

function isAiEnabled(env: AgentEnv) {
  return getAiRequestConfig(env) !== null;
}

async function classifyWithAi(env: AgentEnv, candidates: Candidate[]) {
  const config = getAiRequestConfig(env);
  if (!config || candidates.length === 0) return null;
  const compact = candidates.map((candidate, index) => ({
    index,
    company: candidate.company,
    title: candidate.title,
    text: candidate.rawText.slice(0, 900),
    publishedAt: candidate.publishedAt,
  }));
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      ...(config.model ? { model: config.model } : {}),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是国企招聘信息结构化助手。只保留与计算机、软件、算法、数据、AI、网络安全、云计算、通信、自动化或电子信息明确相关的岗位/招聘公告。不要猜测缺失信息。",
        },
        {
          role: "user",
          content: `返回 JSON：{"items":[{"index":0,"relevant":true,"category":"软件开发","location":"北京","education":"本科及以上","jobType":"校园招聘","deadline":null,"summary":"不超过70字","skills":["Java"],"relevanceScore":90}]}。输入：${JSON.stringify(compact)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`AI API ${response.status}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI API returned an empty response");
  return safeJsonObject(content) as {
    items?: Array<Partial<ClassifiedCandidate> & { index: number }>;
  };
}

async function enrichCandidates(env: AgentEnv, candidates: Candidate[]) {
  const fallback = candidates.map(classifyWithRules);
  try {
    const ai = await classifyWithAi(env, candidates);
    if (!ai?.items) return fallback;
    const byIndex = new Map(ai.items.map((item) => [item.index, item]));
    return fallback.map((item, index) => {
      const aiItem = byIndex.get(index);
      if (!aiItem) return item;
      return {
        ...item,
        location: aiItem.location || item.location,
        education: aiItem.education || item.education,
        jobType: aiItem.jobType || item.jobType,
        category: aiItem.category || item.category,
        deadline: aiItem.deadline ?? item.deadline,
        summary: aiItem.summary || item.summary,
        skills: Array.isArray(aiItem.skills) ? aiItem.skills.slice(0, 5) : item.skills,
        relevanceScore: typeof aiItem.relevanceScore === "number" ? aiItem.relevanceScore : item.relevanceScore,
        relevant: typeof aiItem.relevant === "boolean" ? aiItem.relevant : item.relevant,
      };
    });
  } catch {
    return fallback;
  }
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "GuoqiRadar/1.0 (+public recruitment monitoring; respectful daily fetch)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) throw new Error("非 HTML 页面");
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error("页面体积超过安全限制");
  return html;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function enrichCandidateDetails(
  candidates: Candidate[],
  source: RecruitmentSource,
) {
  const detailLimit = Math.min(source.detailLimit ?? 6, candidates.length);
  const enriched = await mapWithConcurrency(
    candidates.slice(0, detailLimit),
    4,
    async (candidate) => {
      try {
        const html = await fetchHtml(candidate.sourceUrl);
        const body = stripHtml(html).slice(0, 9000);
        if (body.length < 80) return candidate;
        const titleIndex = body.indexOf(candidate.title);
        const focusedBody =
          titleIndex >= 0 ? body.slice(titleIndex, titleIndex + 7000) : body.slice(0, 7000);
        return {
          ...candidate,
          rawText: focusedBody,
          publishedAt: inferDate(focusedBody) ?? candidate.publishedAt ?? inferDate(body),
        };
      } catch {
        return candidate;
      }
    },
  );
  return [...enriched, ...candidates.slice(detailLimit)];
}

type CmccNotice = {
  text3?: string;
  text4?: string;
  text5?: string;
  detail_href?: string;
  jump_link?: string;
};

async function fetchCmccNotices(source: RecruitmentSource): Promise<Candidate[]> {
  const feedUrl = "https://job.10086.cn/personal/notice/5044401_11161_21137.json";
  const response = await fetch(feedUrl, {
    headers: {
      "user-agent": "GuoqiRadar/1.0 (+public recruitment monitoring; respectful daily fetch)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { cData?: { list?: CmccNotice[] } };
  const notices = payload.cData?.list ?? [];
  const blocked = /拟录用|录用结果|系统升级|公示|笔试结果|面试结果/;
  return notices
    .filter((notice) => {
      const title = stripHtml(notice.text3 ?? "");
      return recruitmentWords.some((word) => title.includes(word)) && !blocked.test(title);
    })
    .slice(0, source.maxItems)
    .map((notice) => {
      const title = stripHtml(notice.text3 ?? "");
      const sourceUrl = normalizeUrl(
        notice.detail_href || notice.jump_link || source.url,
        source.url,
      ) ?? source.url;
      return {
        company: source.company,
        title,
        sourceName: source.name,
        sourceUrl,
        verificationLevel: source.verificationLevel ?? "official",
        discoveryChannel: source.discoveryChannel ?? "official_site",
        discoveryUrl: null,
        locationHint: source.defaultLocation,
        rawText: `${title} ${notice.text4 ?? ""} ${notice.text5 ?? ""}`,
        publishedAt: inferDate(notice.text4 ?? ""),
      };
    });
}

type CaepPost = {
  careerRequire?: string;
  eduRequire?: string;
  endDate?: string | null;
  id?: string;
  isOnline?: number;
  name?: string;
  publishDate?: string;
  publishDept?: string;
  publishDeptCode?: string;
  remark?: string;
  researchOrientations?: string;
  science?: string;
  workAddress?: string;
};

function caepLocation(value: string | undefined) {
  const text = value ?? "";
  const locations = [
    ["mianyang", "绵阳"],
    ["chengdu", "成都"],
    ["beijing", "北京"],
    ["shanghai", "上海"],
  ] as const;
  const matches = locations
    .filter(([code]) => text.toLowerCase().includes(code))
    .map(([, label]) => label);
  return matches.length ? matches.join(" / ") : "绵阳";
}

function caepEducation(value: string | undefined) {
  if (value === "doctor") return "博士";
  if (value === "master") return "硕士及以上";
  if (value === "scholar") return "本科及以上";
  return "详见公告";
}

const caepTechSignals =
  /计算机|软件工程|软件开发|人工智能|智能识别|机器学习|深度学习|算法|大数据|数据分析|数据治理|数据驱动|网络安全|信息安全|通信|电子信息|信息化|数字化|网络维护|云计算|数据库|嵌入式|芯片|集成电路|fpga|信号处理|微电子|计算物理|数值模拟|仿真|自动化|控制科学|控制工程|智能制造|图像处理|智能控制|雷达/i;

async function fetchCaepPosts(source: RecruitmentSource): Promise<Candidate[]> {
  const response = await fetch(
    "https://zpxx.caep.cn/main/searchPostInfoByDeptForMain",
    {
      method: "POST",
      headers: {
        "user-agent":
          "GuoqiRadar/1.0 (+public recruitment monitoring; respectful daily fetch)",
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "",
      signal: AbortSignal.timeout(18000),
    },
  );
  if (!response.ok) throw new Error(`中物院职位接口 HTTP ${response.status}`);
  const payload = (await response.json()) as {
    success?: boolean;
    data?: { postInfo?: Array<{ postInfos?: CaepPost[] }> };
  };
  if (!payload.success) throw new Error("中物院职位接口返回失败");

  const now = Date.now();
  return (payload.data?.postInfo ?? [])
    .flatMap((group) => group.postInfos ?? [])
    .filter((post) => post.isOnline !== 0 && post.id && post.name)
    .map((post) => {
      const location = caepLocation(post.workAddress);
      const education = caepEducation(post.eduRequire);
      const deadline = post.endDate?.slice(0, 10) ?? null;
      const title = post.publishDept
        ? `${post.publishDept}｜${post.name}`
        : post.name!;
      const signalText = [
        title,
        post.careerRequire,
        post.researchOrientations,
      ]
        .filter(Boolean)
        .join(" ");
      const rawText = [
        title,
        post.careerRequire ? `专业要求：${post.careerRequire}` : "",
        post.researchOrientations
          ? `研究方向：${post.researchOrientations}`
          : "",
        `工作地点：${location}`,
        `学历要求：${education}`,
        deadline ? `截止日期：${deadline}` : "",
        post.remark,
        post.science,
      ]
        .filter(Boolean)
        .join(" ");
      const sourceUrl =
        `https://zpxx.caep.cn/#/recruitInfo/index?deptCode=${encodeURIComponent(post.publishDeptCode ?? "")}` +
        `&job=${encodeURIComponent(post.id!)}`;
      return {
        candidate: {
          company: source.company,
          title,
          sourceName: source.name,
          sourceUrl,
          verificationLevel: source.verificationLevel ?? "official",
          discoveryChannel: source.discoveryChannel ?? "official_site",
          discoveryUrl: null,
          locationHint: location,
          rawText,
          publishedAt: post.publishDate?.slice(0, 10) ?? null,
        } satisfies Candidate,
        rawText,
        signalText,
        active:
          !deadline ||
          new Date(`${deadline}T23:59:59+08:00`).getTime() >= now,
        publishedAt: post.publishDate ?? "",
      };
    })
    .filter((item) => caepTechSignals.test(item.signalText))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.publishedAt.localeCompare(left.publishedAt),
    )
    .slice(0, source.maxItems)
    .map((item) => item.candidate);
}

async function fetchCetc29Landing(
  source: RecruitmentSource,
): Promise<Candidate[]> {
  const html = await fetchHtml(source.url);
  const body = stripHtml(html);
  if (!body.includes("中国电科29所") && !body.includes("第二十九研究所")) {
    throw new Error("29所招聘专区内容校验失败");
  }
  return [
    {
      company: source.company,
      title: "中国电科29所校园与社会招聘入口",
      sourceName: source.name,
      sourceUrl: source.url,
      verificationLevel: source.verificationLevel ?? "trusted",
      discoveryChannel: source.discoveryChannel ?? "official_site",
      discoveryUrl: null,
      locationHint: source.defaultLocation,
      rawText:
        "中国电科29所 西南电子设备研究所 招聘职位 校园招聘 电子信息控制 人才招聘 成都",
      publishedAt: null,
    },
  ];
}

async function fetchSource(source: RecruitmentSource) {
  if (source.id === "cmcc") return fetchCmccNotices(source);
  if (source.id === "caep") return fetchCaepPosts(source);
  if (source.id === "cetc29") return fetchCetc29Landing(source);

  const urls = [source.url, ...(source.fallbackUrls ?? [])];
  let latestError: Error | null = null;
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const candidates = extractCandidates(html, { ...source, url });
      if (candidates.length > 0) {
        const known = knownPageMetadata[url];
        const normalized = known
          ? candidates.map((candidate) => ({
              ...candidate,
              title: known.title,
              publishedAt: known.publishedAt,
              rawText: `${known.title} ${known.context} ${candidate.rawText}`,
            }))
          : candidates;
        return enrichCandidateDetails(normalized, source);
      }
    } catch (error) {
      latestError = error instanceof Error ? error : new Error("未知采集错误");
    }
  }
  if (latestError) throw latestError;
  return [];
}

const officialHosts = new Set(
  recruitmentSources.flatMap((source) => {
    if ((source.verificationLevel ?? "official") !== "official") return [];
    return [source.url, ...(source.fallbackUrls ?? [])].flatMap((value) => {
        try {
          return [new URL(value).hostname.replace(/^www\./, "")];
        } catch {
          return [];
        }
      });
  }),
);

function getUrlVerification(value: string): VerificationLevel {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (
      Array.from(officialHosts).some(
        (officialHost) =>
          hostname === officialHost || hostname.endsWith(`.${officialHost}`),
      ) ||
      hostname.endsWith(".gov.cn")
    ) {
      return "official";
    }
    if (hostname.endsWith(".edu.cn")) return "trusted";
  } catch {
    return "lead";
  }
  return "lead";
}

function inferCompanyName(text: string, url: string) {
  const normalized = text.toLowerCase();
  const source = recruitmentSources.find((item) => {
    if (normalized.includes(item.company.toLowerCase())) return true;
    try {
      const sourceHost = new URL(item.url).hostname.replace(/^www\./, "");
      const resultHost = new URL(url).hostname.replace(/^www\./, "");
      return resultHost === sourceHost || resultHost.endsWith(`.${sourceHost}`);
    } catch {
      return false;
    }
  });
  if (source) return source.company;
  const companyMatch = text.match(
    /(?:中国|国家)[\u4e00-\u9fa5]{2,12}(?:集团|公司|银行|研究院|研究所|中心)/,
  );
  return companyMatch?.[0] ?? "国企招聘线索";
}

function hasRecruitmentAndTechSignal(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  const hasRecruitment = recruitmentWords.some((word) => text.includes(word));
  const hasTech = Object.values(techKeywords)
    .flat()
    .some((word) => containsKeyword(text, word));
  return hasRecruitment && hasTech && !blockedAnnouncementWords.test(title);
}

function extractPublicUrls(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s)\]>"']+/gi), (match) =>
    match[0].replace(/[.,;，。；）】]+$/, ""),
  );
}

function pickVerifiedUrl(text: string) {
  const candidates = extractPublicUrls(text)
    .map((value) => normalizeUrl(value, value))
    .filter((value): value is string => Boolean(value));
  return (
    candidates.find((value) => getUrlVerification(value) === "official") ??
    candidates.find((value) => getUrlVerification(value) === "trusted") ??
    null
  );
}

type GithubIssue = {
  title?: string;
  body?: string | null;
  html_url?: string;
  created_at?: string;
};

async function discoverFromGithub(env: AgentEnv) {
  const year = new Date().getUTCFullYear() - 1;
  const queries = [
    `招聘 计算机 国企 in:title,body is:issue created:>=${year}-01-01`,
    `校园招聘 软件 央企 in:title,body is:issue created:>=${year}-01-01`,
    `军工 研究所 招聘 计算机 in:title,body is:issue created:>=${year}-01-01`,
  ];
  const responses = await Promise.all(
    queries.map(async (query) => {
      const url = new URL("https://api.github.com/search/issues");
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "created");
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", "20");
      const response = await fetch(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "GuoqiRadar/1.0",
          "x-github-api-version": "2022-11-28",
          ...(env.GITHUB_TOKEN
            ? { authorization: `Bearer ${env.GITHUB_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error(`GitHub Search API ${response.status}`);
      return response.json() as Promise<{ items?: GithubIssue[] }>;
    }),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const issue of responses.flatMap((response) => response.items ?? [])) {
    const title = stripHtml(issue.title ?? "").slice(0, 140);
    const body = stripHtml(issue.body ?? "").slice(0, 9000);
    const issueUrl = normalizeUrl(issue.html_url ?? "", "https://github.com");
    if (!issueUrl || seen.has(issueUrl)) continue;
    if (!hasRecruitmentAndTechSignal(title, body)) continue;
    const hasRecruitmentTitle = recruitmentWords.some((word) => title.includes(word));
    const verifiedUrl = pickVerifiedUrl(issue.body ?? "");
    if (!hasRecruitmentTitle && !verifiedUrl) continue;

    const sourceUrl = verifiedUrl ?? issueUrl;
    const verificationLevel = getUrlVerification(sourceUrl);
    seen.add(issueUrl);
    candidates.push({
      company: inferCompanyName(`${title} ${body}`, sourceUrl),
      title,
      sourceName:
        verificationLevel === "official"
          ? "GitHub 发现 · 官网回溯"
          : verificationLevel === "trusted"
            ? "GitHub 发现 · 可信转载"
            : "GitHub 社区线索",
      sourceUrl,
      verificationLevel,
      discoveryChannel: "github",
      discoveryUrl: issueUrl,
      rawText: `${title} ${body}`,
      publishedAt: issue.created_at?.slice(0, 10) ?? inferDate(body),
    });
  }
  return candidates.slice(0, 20);
}

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
  extra_snippets?: string[];
};

type BraveQuery = {
  query: string;
  channel: DiscoveryChannel;
  sourceName: string;
};

async function discoverFromBrave(env: AgentEnv) {
  if (!env.BRAVE_SEARCH_API_KEY) {
    return {
      candidates: [] as Candidate[],
      partial: true,
      message: "未配置 BRAVE_SEARCH_API_KEY，官网搜索、高校就业网和小红书公开线索尚未启用",
    };
  }

  const queries: BraveQuery[] = [
    {
      query: "国企 央企 招聘 计算机 软件 算法 数据 网络安全",
      channel: "web_search",
      sourceName: "公开网页搜索",
    },
    {
      query: "site:edu.cn 国企 校园招聘 计算机 软件",
      channel: "university",
      sourceName: "高校就业网",
    },
    {
      query: "site:xiaohongshu.com 国企 招聘 计算机 软件",
      channel: "xiaohongshu",
      sourceName: "小红书公开搜索线索",
    },
    {
      query: "军工 研究所 校园招聘 计算机 软件 算法 电子信息",
      channel: "web_search",
      sourceName: "军工院所公开搜索",
    },
  ];

  const settled = await Promise.allSettled(
    queries.map(async (item) => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", item.query);
      url.searchParams.set("count", "20");
      url.searchParams.set("freshness", "py");
      url.searchParams.set("country", "CN");
      url.searchParams.set("search_lang", "zh-hans");
      url.searchParams.set("safesearch", "strict");
      url.searchParams.set("extra_snippets", "true");
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": env.BRAVE_SEARCH_API_KEY!,
        },
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error(`Brave Search API ${response.status}`);
      const payload = (await response.json()) as {
        web?: { results?: BraveSearchResult[] };
      };
      return { ...item, results: payload.web?.results ?? [] };
    }),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const query = result.value;
    for (const item of query.results) {
      const title = stripHtml(item.title ?? "").slice(0, 140);
      const description = stripHtml(
        [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(" "),
      ).slice(0, 7000);
      const sourceUrl = normalizeUrl(item.url ?? "", "https://search.brave.com");
      if (!sourceUrl || seen.has(sourceUrl)) continue;
      if (!hasRecruitmentAndTechSignal(title, description)) continue;
      seen.add(sourceUrl);

      const verificationLevel =
        query.channel === "xiaohongshu"
          ? "lead"
          : getUrlVerification(sourceUrl);
      candidates.push({
        company: inferCompanyName(`${title} ${description}`, sourceUrl),
        title,
        sourceName:
          verificationLevel === "official"
            ? `${query.sourceName} · 官网核验`
            : verificationLevel === "trusted"
              ? `${query.sourceName} · 可信转载`
              : query.sourceName,
        sourceUrl,
        verificationLevel,
        discoveryChannel: query.channel,
        discoveryUrl: sourceUrl,
        rawText: `${title} ${description}`,
        publishedAt: item.page_age?.slice(0, 10) ?? inferDate(description),
      });
    }
  }

  const failureMessages = settled.flatMap((result) =>
    result.status === "rejected"
      ? [
          result.reason instanceof Error
            ? result.reason.message.slice(0, 100)
            : "公开搜索请求失败",
        ]
      : [],
  );
  return {
    candidates: candidates.slice(0, 45),
    partial: failureMessages.length > 0,
    message: failureMessages.length ? failureMessages.join("；") : undefined,
  };
}

async function runDiscoverySources(env: AgentEnv) {
  const githubStartedAt = new Date().toISOString();
  const braveStartedAt = new Date().toISOString();
  const [githubResult, braveResult] = await Promise.allSettled([
    discoverFromGithub(env),
    discoverFromBrave(env),
  ]);

  const results: Array<{
    candidates: ClassifiedCandidate[];
    run: SourceRun;
  }> = [];

  if (githubResult.status === "fulfilled") {
    const classified = await enrichCandidates(env, githubResult.value);
    const relevant = classified.filter((item) => item.relevant);
    results.push({
      candidates: relevant,
      run: {
        sourceId: "discovery-github",
        sourceName: "GitHub 公开搜索",
        status: "success",
        discovered: githubResult.value.length,
        accepted: relevant.length,
        startedAt: githubStartedAt,
        finishedAt: new Date().toISOString(),
      },
    });
  } else {
    results.push({
      candidates: [],
      run: {
        sourceId: "discovery-github",
        sourceName: "GitHub 公开搜索",
        status: "failed",
        discovered: 0,
        accepted: 0,
        message:
          githubResult.reason instanceof Error
            ? githubResult.reason.message.slice(0, 160)
            : "GitHub 搜索失败",
        startedAt: githubStartedAt,
        finishedAt: new Date().toISOString(),
      },
    });
  }

  if (braveResult.status === "fulfilled") {
    const classified = await enrichCandidates(env, braveResult.value.candidates);
    const relevant = classified.filter((item) => item.relevant);
    results.push({
      candidates: relevant,
      run: {
        sourceId: "discovery-search",
        sourceName: "网页 / 高校 / 小红书公开搜索",
        status: braveResult.value.partial ? "partial" : "success",
        discovered: braveResult.value.candidates.length,
        accepted: relevant.length,
        message: braveResult.value.message,
        startedAt: braveStartedAt,
        finishedAt: new Date().toISOString(),
      },
    });
  } else {
    results.push({
      candidates: [],
      run: {
        sourceId: "discovery-search",
        sourceName: "网页 / 高校 / 小红书公开搜索",
        status: "failed",
        discovered: 0,
        accepted: 0,
        message:
          braveResult.reason instanceof Error
            ? braveResult.reason.message.slice(0, 160)
            : "公开搜索失败",
        startedAt: braveStartedAt,
        finishedAt: new Date().toISOString(),
      },
    });
  }

  return results;
}

async function upsertJobs(db: D1Database, candidates: ClassifiedCandidate[]) {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const item of candidates) {
    const existing = await db
      .prepare("SELECT id, content_hash FROM jobs WHERE source_url = ?")
      .bind(item.sourceUrl)
      .first<{ id: string; content_hash: string }>();
    const contentHash = await hash(`${item.title}|${item.summary}|${item.deadline ?? ""}`);
    const id = existing?.id ?? (await hash(item.sourceUrl)).slice(0, 24);
    const publishedAge = item.publishedAt
      ? Date.now() - new Date(`${item.publishedAt}T00:00:00+08:00`).getTime()
      : 0;
    const expiredByDeadline =
      item.deadline &&
      new Date(`${item.deadline}T23:59:59+08:00`).getTime() < Date.now();
    const expiredByAge =
      !item.deadline &&
      publishedAge > 120 * 24 * 60 * 60 * 1000;
    const status = expiredByDeadline || expiredByAge ? "expired" : "active";

    await db
      .prepare(`
        INSERT INTO jobs (
          id, company, title, location, education, job_type, category,
          published_at, deadline, source_name, source_url, verification_level,
          discovery_channel, discovery_url, summary, skills, relevance_score,
          content_hash, status, collected_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_url) DO UPDATE SET
          company = excluded.company,
          title = excluded.title,
          location = excluded.location,
          education = excluded.education,
          job_type = excluded.job_type,
          category = excluded.category,
          published_at = COALESCE(excluded.published_at, jobs.published_at),
          deadline = COALESCE(excluded.deadline, jobs.deadline),
          source_name = excluded.source_name,
          verification_level = excluded.verification_level,
          discovery_channel = excluded.discovery_channel,
          discovery_url = COALESCE(excluded.discovery_url, jobs.discovery_url),
          summary = excluded.summary,
          skills = excluded.skills,
          relevance_score = excluded.relevance_score,
          content_hash = excluded.content_hash,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .bind(
        id, item.company, item.title, item.location, item.education, item.jobType,
        item.category, item.publishedAt, item.deadline, item.sourceName, item.sourceUrl,
        item.verificationLevel, item.discoveryChannel, item.discoveryUrl, item.summary,
        JSON.stringify(item.skills), item.relevanceScore, contentHash, status, now, now,
      )
      .run();

    if (existing) {
      if (existing.content_hash !== contentHash) updated += 1;
    } else {
      inserted += 1;
    }
  }
  return { inserted, updated };
}

async function suppressClearlyIrrelevantJobs(db: D1Database) {
  const result = await db
    .prepare("SELECT id, title FROM jobs WHERE status != 'excluded'")
    .all<{ id: string; title: string }>();
  const statements = result.results
    .filter(
      (item) =>
        clearlyEditorialTitleWords.test(item.title) ||
        (
          clearlyGenericListingTitleWords.test(item.title) &&
          uniqueKeywords(item.title).length === 0
        ) ||
        (
          clearlyNonTechDepartmentWords.test(item.title) &&
          uniqueKeywords(item.title).length === 0
        ),
    )
    .map((item) =>
      db
        .prepare("UPDATE jobs SET status = 'excluded', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), item.id),
    );
  if (statements.length) await db.batch(statements);
}

async function suppressUnmatchedCaepJobs(
  db: D1Database,
  candidates: ClassifiedCandidate[],
) {
  const sourceName = "中物院（绵阳九院）人才招聘";
  const currentUrls = new Set(
    candidates
      .filter((item) => item.sourceName === sourceName)
      .map((item) => item.sourceUrl),
  );
  if (!currentUrls.size) return;
  const result = await db
    .prepare(
      "SELECT id, source_url FROM jobs WHERE source_name = ? AND status != 'excluded'",
    )
    .bind(sourceName)
    .all<{ id: string; source_url: string }>();
  const now = new Date().toISOString();
  const statements = result.results
    .filter((item) => !currentUrls.has(item.source_url))
    .map((item) =>
      db
        .prepare("UPDATE jobs SET status = 'excluded', updated_at = ? WHERE id = ?")
        .bind(now, item.id),
    );
  if (statements.length) await db.batch(statements);
}

export async function runRecruitmentAgent(env: AgentEnv): Promise<AgentRunResult> {
  await ensureSchema(env.DB);
  const startedAt = new Date().toISOString();
  const sources = recruitmentSources.filter((item) => item.enabled);
  const [officialResults, discoveryResults] = await Promise.all([
    mapWithConcurrency(sources, 5, async (source) => {
      const sourceStartedAt = new Date().toISOString();
      try {
        const candidates = await fetchSource(source);
        const classified = await enrichCandidates(env, candidates);
        const relevant = classified.filter((item) => item.relevant);
        return {
          candidates: relevant,
          run: {
            sourceId: source.id,
            sourceName: source.name,
            status: "success" as const,
            discovered: candidates.length,
            accepted: relevant.length,
            startedAt: sourceStartedAt,
            finishedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          candidates: [] as ClassifiedCandidate[],
          run: {
            sourceId: source.id,
            sourceName: source.name,
            status: "failed" as const,
            discovered: 0,
            accepted: 0,
            message: error instanceof Error ? error.message.slice(0, 160) : "未知错误",
            startedAt: sourceStartedAt,
            finishedAt: new Date().toISOString(),
          },
        };
      }
    }),
    runDiscoverySources(env),
  ]);

  const results = [...officialResults, ...discoveryResults];
  const runs: SourceRun[] = results.map((result) => result.run);
  const accepted = results.flatMap((result) => result.candidates);
  const discovered = runs.reduce((total, run) => total + run.discovered, 0);

  const trustRank: Record<VerificationLevel, number> = {
    official: 3,
    trusted: 2,
    lead: 1,
  };
  const byUrl = new Map<string, ClassifiedCandidate>();
  for (const item of accepted) {
    const current = byUrl.get(item.sourceUrl);
    if (!current || trustRank[item.verificationLevel] > trustRank[current.verificationLevel]) {
      byUrl.set(item.sourceUrl, item);
    }
  }
  const deduped = Array.from(byUrl.values());
  const writeResult = await upsertJobs(env.DB, deduped);
  await suppressUnmatchedCaepJobs(env.DB, deduped);
  await suppressClearlyIrrelevantJobs(env.DB);
  const finishedAt = new Date().toISOString();
  const failedSources = runs.filter((run) => run.status === "failed").length;
  const partialSources = runs.filter((run) => run.status === "partial").length;
  const finalStatus =
    failedSources === runs.length
      ? "failed"
      : failedSources > 0 || partialSources > 0
        ? "partial"
        : "success";

  const statements = runs.map((run) =>
    env.DB.prepare(`
      INSERT INTO source_runs (
        source_id, source_name, status, discovered, accepted, message, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      run.sourceId, run.sourceName, run.status, run.discovered, run.accepted,
      run.message ?? null, run.startedAt, run.finishedAt,
    ),
  );
  statements.push(
    env.DB.prepare(`
      INSERT INTO agent_meta (key, value, updated_at) VALUES ('last_run_at', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(finishedAt, finishedAt),
    env.DB.prepare(`
      INSERT INTO agent_meta (key, value, updated_at) VALUES ('last_run_status', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(finalStatus, finishedAt),
  );
  await env.DB.batch(statements);

  return {
    startedAt,
    finishedAt,
    discovered,
    accepted: deduped.length,
    inserted: writeResult.inserted,
    updated: writeResult.updated,
    failedSources,
    aiEnabled: isAiEnabled(env),
    runs,
  };
}
