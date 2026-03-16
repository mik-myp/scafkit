import { CliError } from "./errors.js";

const SUPPORTED_GIT_HOSTS = ["github.com", "gitlab.com", "gitee.com"] as const;
const SUPPORTED_GIT_HOSTS_SET: ReadonlySet<string> = new Set(
  SUPPORTED_GIT_HOSTS
);
const SCP_LIKE_PATTERN = /^(?<user>[^@\s]+)@(?<host>[^:\s]+):(?<repoPath>.+)$/;
const HOST_ONLY_PATTERN = /^(?<host>[^/\s]+\.[^/\s]+)\/(?<repoPath>.+)$/;
const LOCAL_PATH_HINT_PATTERN = /^(\.|\/|~|[A-Za-z]:[\\/])/;

interface ParsedSource {
  kind: "url" | "scp" | "host" | "repo" | "raw";
  host?: string;
  user?: string;
  protocol?: "https" | "ssh";
  repoPath?: string;
  raw: string;
}

function normalizeRepoPath(repoPathRaw: string): string {
  const repoPath = repoPathRaw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  const segments = repoPath.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new CliError(`无效仓库地址: ${repoPathRaw}，至少需要 group/repo`);
  }

  return `${segments.join("/")}.git`;
}

function parseSource(input: string): ParsedSource {
  const raw = input.trim();
  if (!raw) {
    throw new CliError("git 模板地址不能为空");
  }

  if (LOCAL_PATH_HINT_PATTERN.test(raw)) {
    return { kind: "raw", raw };
  }

  const scpMatched = raw.match(SCP_LIKE_PATTERN);
  if (scpMatched?.groups) {
    const host = scpMatched.groups.host.toLowerCase();
    if (SUPPORTED_GIT_HOSTS_SET.has(host)) {
      return {
        kind: "scp",
        host,
        user: scpMatched.groups.user || "git",
        repoPath: normalizeRepoPath(scpMatched.groups.repoPath),
        raw
      };
    }
    return { kind: "raw", raw };
  }

  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    if (protocol !== "https:" && protocol !== "ssh:") {
      throw new CliError(`仅支持 HTTPS 或 SSH 仓库地址: ${raw}`);
    }
    const host = url.hostname.toLowerCase();
    if (url.search || url.hash) {
      throw new CliError(`仓库地址不能包含 query/hash: ${raw}`);
    }
    if (SUPPORTED_GIT_HOSTS_SET.has(host)) {
      return {
        kind: "url",
        host,
        user: url.username || "git",
        protocol: protocol === "https:" ? "https" : "ssh",
        repoPath: normalizeRepoPath(url.pathname),
        raw
      };
    }
    return { kind: "raw", raw };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
  }

  const hostOnlyMatched = raw.match(HOST_ONLY_PATTERN);
  if (hostOnlyMatched?.groups) {
    const host = hostOnlyMatched.groups.host.toLowerCase();
    if (SUPPORTED_GIT_HOSTS_SET.has(host)) {
      return {
        kind: "host",
        host,
        repoPath: normalizeRepoPath(hostOnlyMatched.groups.repoPath),
        raw
      };
    }
    return { kind: "raw", raw };
  }

  if (!LOCAL_PATH_HINT_PATTERN.test(raw) && raw.includes("/")) {
    return {
      kind: "repo",
      repoPath: normalizeRepoPath(raw),
      raw
    };
  }

  return {
    kind: "raw",
    raw
  };
}

function toHttpsSource(host: string, repoPath: string): string {
  return `https://${host}/${repoPath}`;
}

function toScpSource(host: string, repoPath: string, user = "git"): string {
  return `${user}@${host}:${repoPath}`;
}

export function normalizeTemplateGitSource(source: string): string {
  const parsed = parseSource(source);

  switch (parsed.kind) {
    case "url":
      if (parsed.protocol === "https") {
        return toHttpsSource(parsed.host!, parsed.repoPath!);
      }
      return `ssh://${parsed.user}@${parsed.host}/${parsed.repoPath}`;
    case "scp":
      return toScpSource(parsed.host!, parsed.repoPath!, parsed.user);
    case "host":
      return toHttpsSource(parsed.host!, parsed.repoPath!);
    case "repo":
      return parsed.repoPath!;
    case "raw":
    default:
      return parsed.raw;
  }
}

export function buildTemplateGitSourceCandidates(source: string): string[] {
  const parsed = parseSource(source);

  switch (parsed.kind) {
    case "url":
      if (parsed.protocol === "https") {
        return [
          toHttpsSource(parsed.host!, parsed.repoPath!),
          toScpSource(parsed.host!, parsed.repoPath!, parsed.user)
        ];
      }
      return [
        `ssh://${parsed.user}@${parsed.host}/${parsed.repoPath}`,
        toHttpsSource(parsed.host!, parsed.repoPath!)
      ];
    case "scp":
      return [
        toScpSource(parsed.host!, parsed.repoPath!, parsed.user),
        toHttpsSource(parsed.host!, parsed.repoPath!)
      ];
    case "host":
      return [
        toHttpsSource(parsed.host!, parsed.repoPath!),
        toScpSource(parsed.host!, parsed.repoPath!)
      ];
    case "repo": {
      const candidates: string[] = [];
      for (const host of SUPPORTED_GIT_HOSTS) {
        candidates.push(toHttpsSource(host, parsed.repoPath!));
        candidates.push(toScpSource(host, parsed.repoPath!));
      }
      return candidates;
    }
    case "raw":
    default:
      return [parsed.raw];
  }
}
