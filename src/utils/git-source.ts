import { CliError } from "./errors.js";

const KNOWN_GIT_HOSTS = new Set(["github.com", "gitlab.com"]);
const SCP_LIKE_PATTERN = /^(?<user>[^@\s]+)@(?<host>[^:\s]+):(?<repoPath>.+)$/;

function normalizeRepoPath(host: string, repoPathRaw: string): string {
  const repoPath = repoPathRaw.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const segments = repoPath.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new CliError(`无效仓库地址: ${repoPathRaw}，至少需要 group/repo`);
  }

  if (host === "github.com" && segments.length !== 2) {
    throw new CliError(`GitHub 仓库地址应为 owner/repo: ${repoPathRaw}`);
  }

  return `${segments.join("/")}.git`;
}

function normalizeKnownHostUrl(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!KNOWN_GIT_HOSTS.has(host)) {
    return null;
  }

  if (url.search || url.hash) {
    throw new CliError(`仓库地址不能包含 query/hash: ${source}`);
  }

  if (url.protocol === "https:") {
    const repoPath = normalizeRepoPath(host, url.pathname);
    return `https://${host}/${repoPath}`;
  }

  if (url.protocol === "ssh:") {
    const repoPath = normalizeRepoPath(host, url.pathname);
    const user = url.username || "git";
    return `ssh://${user}@${host}/${repoPath}`;
  }

  throw new CliError(`仅支持 GitHub/GitLab 的 HTTPS 或 SSH 地址: ${source}`);
}

function normalizeKnownHostScpLike(source: string): string | null {
  const matched = source.match(SCP_LIKE_PATTERN);
  if (!matched?.groups) {
    return null;
  }

  const host = matched.groups.host.toLowerCase();
  if (!KNOWN_GIT_HOSTS.has(host)) {
    return null;
  }

  const repoPath = normalizeRepoPath(host, matched.groups.repoPath);
  const user = matched.groups.user || "git";
  return `${user}@${host}:${repoPath}`;
}

function normalizeKnownHostWithoutScheme(source: string): string | null {
  const matched = source.match(/^(?<host>github\.com|gitlab\.com)\/(?<repoPath>.+)$/i);
  if (!matched?.groups) {
    return null;
  }

  const host = matched.groups.host.toLowerCase();
  const repoPath = normalizeRepoPath(host, matched.groups.repoPath);
  return `https://${host}/${repoPath}`;
}

export function normalizeTemplateGitSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new CliError("git 模板地址不能为空");
  }

  const byScp = normalizeKnownHostScpLike(trimmed);
  if (byScp) {
    return byScp;
  }

  const byUrl = normalizeKnownHostUrl(trimmed);
  if (byUrl) {
    return byUrl;
  }

  const byHostOnly = normalizeKnownHostWithoutScheme(trimmed);
  if (byHostOnly) {
    return byHostOnly;
  }

  return trimmed;
}
