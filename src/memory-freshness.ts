import { execFileSync } from "node:child_process";

export interface WorkspaceCommitActivity {
  hash: string;
  subject: string;
  committedAt: Date;
}

export interface WorkspaceIssueActivity {
  number: number;
  title: string;
  updatedAt: Date;
  authorLogin?: string;
  externalAuthor?: boolean;
}

export interface WorkspacePullRequestActivity {
  number: number;
  title: string;
  mergedAt: Date;
  authorLogin?: string;
  externalAuthor?: boolean;
}

export interface WorkspaceActivity {
  commits?: WorkspaceCommitActivity[];
  issues?: WorkspaceIssueActivity[];
  pullRequests?: WorkspacePullRequestActivity[];
}

export interface MemoryFreshness {
  status: "fresh" | "stale" | "empty" | "unknown";
  latestMemoryUpdatedAt: string | null;
  latestWorkspaceActivityAt: string | null;
  daysSinceLatestMemoryUpdate: number | null;
  daysBehindWorkspaceActivity: number | null;
  candidateCount: number;
  message: string;
  recommendedAction: string;
}

export interface MemoryUpdateCandidate {
  kind: "commit" | "issue" | "pull_request" | "session";
  title: string;
  summary: string;
  sourceType: string;
  sourceRef: string;
  occurredAt: string;
  authorLogin?: string;
  externalAuthor?: boolean;
  reason: string;
  suggestedTool: "propose_memory_update";
}

export interface MemoryFreshnessReport {
  freshness: MemoryFreshness;
  candidates: MemoryUpdateCandidate[];
}

export interface BuildMemoryFreshnessInput {
  latestMemoryUpdatedAt: Date | null;
  memoryCount: number;
  activity?: WorkspaceActivity | null;
  now?: Date;
  staleAfterDays?: number;
  maxCandidates?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVITY_CACHE_TTL_MS = 30 * 1000;
const activityCache = new Map<string, { collectedAt: number; activity: WorkspaceActivity }>();

export function buildMemoryFreshness(input: BuildMemoryFreshnessInput): MemoryFreshnessReport {
  const now = input.now ?? new Date();
  const staleAfterDays = input.staleAfterDays ?? 7;
  const activity = normalizeActivity(input.activity);
  const latestActivity = latestActivityDate(activity);
  const daysSinceLatestMemoryUpdate = input.latestMemoryUpdatedAt
    ? daysBetween(input.latestMemoryUpdatedAt, now)
    : null;
  const daysBehindWorkspaceActivity =
    input.latestMemoryUpdatedAt && latestActivity && latestActivity > input.latestMemoryUpdatedAt
      ? daysBetween(input.latestMemoryUpdatedAt, latestActivity)
      : latestActivity && input.memoryCount === 0
        ? daysBetween(latestActivity, now)
        : 0;
  const staleByAge =
    daysSinceLatestMemoryUpdate !== null && daysSinceLatestMemoryUpdate >= staleAfterDays;
  const staleByActivity = daysBehindWorkspaceActivity !== null && daysBehindWorkspaceActivity > 0;
  const status =
    input.memoryCount === 0
      ? "empty"
      : input.latestMemoryUpdatedAt === null
        ? "unknown"
        : staleByAge || staleByActivity
          ? "stale"
          : "fresh";
  const candidates =
    status === "stale" || status === "empty"
      ? buildCandidates(activity, input.maxCandidates ?? 5)
      : [];

  return {
    freshness: {
      status,
      latestMemoryUpdatedAt: input.latestMemoryUpdatedAt?.toISOString() ?? null,
      latestWorkspaceActivityAt: latestActivity?.toISOString() ?? null,
      daysSinceLatestMemoryUpdate,
      daysBehindWorkspaceActivity,
      candidateCount: candidates.length,
      message: freshnessMessage(status, daysSinceLatestMemoryUpdate, daysBehindWorkspaceActivity),
      recommendedAction: freshnessAction(status),
    },
    candidates,
  };
}

export function collectGitWorkspaceActivity(cwd: string, limit = 5): WorkspaceActivity {
  return collectWorkspaceActivity(cwd, limit);
}

export function collectWorkspaceActivity(cwd: string, limit = 5): WorkspaceActivity {
  const cacheKey = `${cwd}\0${limit}`;
  const cached = activityCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.collectedAt < ACTIVITY_CACHE_TTL_MS) {
    return cached.activity;
  }

  const activity = {
    ...collectGitActivity(cwd, limit),
    ...collectGitHubActivity(cwd, limit),
  };
  activityCache.set(cacheKey, { collectedAt: now, activity });
  return activity;
}

function collectGitActivity(cwd: string, limit: number): WorkspaceActivity {
  try {
    const output = execFileSync(
      "git",
      ["log", `--max-count=${limit}`, "--format=%H%x1f%cI%x1f%s"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const commits = output
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line): WorkspaceCommitActivity[] => {
        const [hash, committedAt, subject] = line.split("\x1f");
        if (!hash || !committedAt || !subject) {
          return [];
        }
        return [{ hash, committedAt: new Date(committedAt), subject }];
      });
    return { commits };
  } catch {
    return { commits: [] };
  }
}

function collectGitHubActivity(cwd: string, limit: number): WorkspaceActivity {
  const ownerLogin = collectGitHubOwnerLogin(cwd);
  return {
    issues: collectGitHubIssues(cwd, limit, ownerLogin),
    pullRequests: collectGitHubPullRequests(cwd, limit, ownerLogin),
  };
}

function collectGitHubIssues(
  cwd: string,
  limit: number,
  ownerLogin: string | null,
): WorkspaceIssueActivity[] {
  try {
    const output = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        String(limit),
        "--json",
        "number,title,updatedAt,author",
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const issues = JSON.parse(output) as Array<{
      number?: number;
      title?: string;
      updatedAt?: string;
      author?: { login?: string };
    }>;
    return issues.flatMap((issue) => {
      if (typeof issue.number !== "number" || !issue.title || !issue.updatedAt) {
        return [];
      }
      const authorLogin = normalizeLogin(issue.author?.login);
      return [
        {
          number: issue.number,
          title: issue.title,
          updatedAt: new Date(issue.updatedAt),
          authorLogin,
          externalAuthor: inferExternalAuthor(authorLogin, ownerLogin),
        },
      ];
    });
  } catch {
    return [];
  }
}

function collectGitHubPullRequests(
  cwd: string,
  limit: number,
  ownerLogin: string | null,
): WorkspacePullRequestActivity[] {
  try {
    const output = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        String(limit),
        "--json",
        "number,title,mergedAt,author",
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const pullRequests = JSON.parse(output) as Array<{
      number?: number;
      title?: string;
      mergedAt?: string | null;
      author?: { login?: string };
    }>;
    return pullRequests.flatMap((pullRequest) => {
      if (typeof pullRequest.number !== "number" || !pullRequest.title || !pullRequest.mergedAt) {
        return [];
      }
      const authorLogin = normalizeLogin(pullRequest.author?.login);
      return [
        {
          number: pullRequest.number,
          title: pullRequest.title,
          mergedAt: new Date(pullRequest.mergedAt),
          authorLogin,
          externalAuthor: inferExternalAuthor(authorLogin, ownerLogin),
        },
      ];
    });
  } catch {
    return [];
  }
}

function collectGitHubOwnerLogin(cwd: string): string | null {
  try {
    const output = execFileSync("gh", ["repo", "view", "--json", "owner"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    const repo = JSON.parse(output) as { owner?: { login?: string } };
    return normalizeLogin(repo.owner?.login) ?? null;
  } catch {
    return null;
  }
}

function normalizeLogin(login: string | null | undefined): string | undefined {
  const normalized = login?.trim();
  return normalized ? normalized : undefined;
}

function inferExternalAuthor(
  authorLogin: string | undefined,
  ownerLogin: string | null,
): boolean | undefined {
  if (!authorLogin) {
    return true;
  }
  if (!ownerLogin) {
    return true;
  }
  return authorLogin.toLowerCase() !== ownerLogin.toLowerCase();
}

function normalizeActivity(
  activity: WorkspaceActivity | null | undefined,
): Required<WorkspaceActivity> {
  return {
    commits: activity?.commits ?? [],
    issues: activity?.issues ?? [],
    pullRequests: activity?.pullRequests ?? [],
  };
}

function latestActivityDate(activity: Required<WorkspaceActivity>): Date | null {
  const dates = [
    ...activity.commits.map((commit) => commit.committedAt),
    ...activity.issues.map((issue) => issue.updatedAt),
    ...activity.pullRequests.map((pullRequest) => pullRequest.mergedAt),
  ].filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) {
    return null;
  }
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function buildCandidates(
  activity: Required<WorkspaceActivity>,
  maxCandidates: number,
): MemoryUpdateCandidate[] {
  const candidates: MemoryUpdateCandidate[] = [
    ...activity.issues.map((issue) => ({
      kind: "issue" as const,
      title: issue.title,
      summary: `Issue #${issue.number}: ${issue.title}`,
      sourceType: "github-issue",
      sourceRef: `issue:#${issue.number}`,
      occurredAt: issue.updatedAt.toISOString(),
      authorLogin: issue.authorLogin,
      externalAuthor: issue.externalAuthor ?? true,
      reason: "Issueに残した作業背景や判断が通常メモリに未反映の可能性があります。",
      suggestedTool: "propose_memory_update" as const,
    })),
    ...activity.pullRequests.map((pullRequest) => ({
      kind: "pull_request" as const,
      title: pullRequest.title,
      summary: `PR #${pullRequest.number}: ${pullRequest.title}`,
      sourceType: "github-pr",
      sourceRef: `pr:#${pullRequest.number}`,
      occurredAt: pullRequest.mergedAt.toISOString(),
      authorLogin: pullRequest.authorLogin,
      externalAuthor: pullRequest.externalAuthor ?? true,
      reason: "マージ済みPRの実装結果や運用上の学びが通常メモリに未反映の可能性があります。",
      suggestedTool: "propose_memory_update" as const,
    })),
    ...activity.commits.map((commit) => ({
      kind: "commit" as const,
      title: commit.subject,
      summary: `Commit ${commit.hash.slice(0, 7)}: ${commit.subject}`,
      sourceType: "git-commit",
      sourceRef: `git:${commit.hash.slice(0, 7)}`,
      occurredAt: commit.committedAt.toISOString(),
      reason:
        "最近のcommitが最新メモリ更新より新しく、作業結果が通常メモリに未反映の可能性があります。",
      suggestedTool: "propose_memory_update" as const,
    })),
  ];

  return candidates
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, Math.max(0, maxCandidates));
}

function daysBetween(older: Date, newer: Date): number {
  return Math.max(0, Math.floor((newer.getTime() - older.getTime()) / MS_PER_DAY));
}

function freshnessMessage(
  status: MemoryFreshness["status"],
  daysSinceLatestMemoryUpdate: number | null,
  daysBehindWorkspaceActivity: number | null,
): string {
  if (status === "empty") {
    return "通常メモリがまだありません。重要な作業結果は保存候補を確認してください。";
  }
  if (status === "stale") {
    return `最新メモリ更新が古い可能性があります。更新から${daysSinceLatestMemoryUpdate ?? "-"}日、最近の作業から${daysBehindWorkspaceActivity ?? "-"}日遅れています。`;
  }
  if (status === "unknown") {
    return "最新メモリ更新日を判定できません。最近の作業結果が必要なら保存候補を確認してください。";
  }
  return "通常メモリは最近の作業に追従しています。";
}

function freshnessAction(status: MemoryFreshness["status"]): string {
  if (status === "fresh") {
    return "追加対応は不要です。新しい設計判断や運用上の学びが出た時だけ propose_memory_update を使ってください。";
  }
  return "保存候補を確認し、残す価値があるものだけ propose_memory_update にかけてから write_memory / update_memory を検討してください。";
}
