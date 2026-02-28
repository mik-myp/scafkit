import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { readDb, writeDb } from "../db/store.js";
import type { AiConfig, AiProfile, CommitSuggestion, ReviewResult } from "../types.js";
import { CliError } from "../utils/errors.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_PROFILE_NAME = "default";
const REVIEW_DIFF_MAX_CHARS = 20_000;
const COMMIT_DIFF_MAX_CHARS = 24_000;
const MAX_CHANGED_FILES_IN_PROMPT = 60;
const ALLOWED_COMMIT_TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert"
]);

interface NormalizeCommitSuggestionOptions {
  requireAudienceBreakdown?: boolean;
}

export interface SetAiConfigInput {
  profileName?: string;
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  activate?: boolean;
}

function extractChangedFiles(diff: string): string[] {
  const fileSet = new Set<string>();
  for (const line of diff.split("\n")) {
    const matched = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!matched) {
      continue;
    }

    const beforePath = matched[1];
    const afterPath = matched[2];
    const resolved = afterPath !== "/dev/null" ? afterPath : beforePath;
    if (!resolved || resolved === "/dev/null") {
      continue;
    }

    fileSet.add(resolved);
  }
  return [...fileSet];
}

function formatChangedFilesForPrompt(files: string[]): string {
  if (files.length === 0) {
    return "- (未解析到文件列表，请从 diff 自行识别)";
  }

  const preview = files.slice(0, MAX_CHANGED_FILES_IN_PROMPT);
  const lines = preview.map((item, index) => `${index + 1}. ${item}`);
  if (files.length > preview.length) {
    lines.push(`... 另有 ${files.length - preview.length} 个文件`);
  }
  return lines.join("\n");
}

function truncateDiffForPrompt(diff: string, maxChars: number, cutHint: string): string {
  const normalized = diff.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}\n\n${cutHint}`;
}

function normalizeCommitBody(bodyRaw: string | undefined): string {
  const lines = (bodyRaw || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  let visible = "";
  let internal = "";

  for (const line of lines) {
    if (line.startsWith("用户可见：")) {
      visible = line.replace(/^用户可见：\s*/, "").trim();
      continue;
    }
    if (line.startsWith("内部优化：")) {
      internal = line.replace(/^内部优化：\s*/, "").trim();
      continue;
    }

    const normalized = line.replace(/^[-*]\s*/, "").trim();
    if (!visible) {
      visible = normalized;
      continue;
    }
    if (!internal) {
      internal = normalized;
    }
  }

  const finalVisible = visible || "无明显用户可见变更";
  const finalInternal = internal || "无明显内部优化";
  return `用户可见：${finalVisible}\n内部优化：${finalInternal}`;
}

function normalizeCommitSuggestion(
  input: Partial<CommitSuggestion> | undefined,
  options: NormalizeCommitSuggestionOptions = {}
): CommitSuggestion {
  const type = input?.type?.trim().toLowerCase() || "chore";
  const subject = (input?.subject?.trim() || "同步代码改动")
    .replace(/[。；;]+$/g, "")
    .replace(/\s+/g, " ");
  const bodyRaw = input?.body?.trim() || undefined;

  return {
    type: ALLOWED_COMMIT_TYPES.has(type) ? type : "chore",
    scope: input?.scope?.trim() || undefined,
    subject,
    body: options.requireAudienceBreakdown
      ? normalizeCommitBody(bodyRaw)
      : (bodyRaw ?? undefined)
  };
}

function createFallbackCommitSuggestion(diff: string): CommitSuggestion {
  const fileCount = extractChangedFiles(diff).length;
  return {
    type: "chore",
    subject: fileCount > 0 ? `同步 ${fileCount} 个文件改动` : "同步代码改动",
    body: "用户可见：待人工复核\n内部优化：待人工复核"
  };
}

export function createFallbackReviewResult(diff: string): ReviewResult {
  const fileCount = extractChangedFiles(diff).length;
  return {
    summary: `检测到 ${fileCount} 个文件的变更，建议在提交前手动复查核心逻辑与测试覆盖。`,
    riskItems: ["AI 返回不可解析，已降级为基础建议。"],
    testSuggestions: ["执行相关单元测试并手动验证关键路径。"],
    commitSuggestion: normalizeCommitSuggestion(createFallbackCommitSuggestion(diff), {
      requireAudienceBreakdown: true
    })
  };
}

export function formatConventionalCommit(suggestion: CommitSuggestion): string {
  const scopePart = suggestion.scope ? `(${suggestion.scope})` : "";
  const header = `${suggestion.type}${scopePart}: ${suggestion.subject}`;
  if (!suggestion.body) {
    return header;
  }
  return `${header}\n\n${suggestion.body}`;
}

export function parseReviewResponse(rawText: string, diff: string): ReviewResult {
  const fallback = createFallbackReviewResult(diff);
  try {
    const parsed = JSON.parse(rawText) as Partial<ReviewResult>;
    const summary = parsed.summary?.trim();
    const riskItems = Array.isArray(parsed.riskItems)
      ? parsed.riskItems.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const testSuggestions = Array.isArray(parsed.testSuggestions)
      ? parsed.testSuggestions.map((item) => String(item).trim()).filter(Boolean)
      : [];
    return {
      summary: summary || fallback.summary,
      riskItems: riskItems.length > 0 ? riskItems : fallback.riskItems,
      testSuggestions: testSuggestions.length > 0 ? testSuggestions : fallback.testSuggestions,
      commitSuggestion: normalizeCommitSuggestion(parsed.commitSuggestion, {
        requireAudienceBreakdown: true
      })
    };
  } catch {
    return fallback;
  }
}

export function parseCommitSuggestionResponse(rawText: string, diff: string): CommitSuggestion {
  const fallback = normalizeCommitSuggestion(createFallbackCommitSuggestion(diff), {
    requireAudienceBreakdown: true
  });

  try {
    const parsed = JSON.parse(rawText) as
      | Partial<CommitSuggestion>
      | {
          commitSuggestion?: Partial<CommitSuggestion>;
        };

    const candidate =
      parsed && typeof parsed === "object" && "commitSuggestion" in parsed
        ? parsed.commitSuggestion
        : (parsed as Partial<CommitSuggestion>);

    return normalizeCommitSuggestion(candidate, {
      requireAudienceBreakdown: true
    });
  } catch {
    return fallback;
  }
}

function buildReviewSystemPrompt(): string {
  return [
    "你是资深代码审查助手，请基于 git staged diff 给出可执行的审查结论。",
    "只允许输出合法 JSON 对象，不要输出 markdown、解释文本或代码块。",
    "你必须覆盖所有变更文件：summary 要描述整体变更主题，不能遗漏重要文件影响。",
    "JSON 字段与约束：",
    "summary: 中文字符串，1-2 句，先讲核心变更，再讲主要风险。",
    "riskItems: 中文字符串数组，按风险优先级排序，最多 5 条；无明显风险时返回空数组。",
    "testSuggestions: 中文字符串数组，给出可落地验证建议，最多 5 条。",
    "commitSuggestion: 对象，包含 type/scope/subject/body。",
    "type 只能是 feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert。",
    "scope 可选，尽量使用受影响模块名（如 cli/template/git/hook）。",
    "subject 必须是中文，20 字以内，使用动宾结构，不要句号。",
    "body 必须是两行：第一行“用户可见：...”，第二行“内部优化：...”。",
    "禁止编造不存在的改动，信息不足时明确标注“需人工复核”。"
  ].join("\n");
}

function buildReviewUserPrompt(diff: string, changedFiles: string[]): string {
  const truncated = truncateDiffForPrompt(
    diff,
    REVIEW_DIFF_MAX_CHARS,
    "[... diff 已截断，请优先识别高风险问题并保证结论覆盖所有列出的文件 ...]"
  );

  return [
    "请审查以下 staged diff，并输出 summary / riskItems / testSuggestions / commitSuggestion。",
    "重点关注：兼容性、边界条件、异常处理、回滚影响、测试覆盖。",
    `变更文件（共 ${changedFiles.length} 个）：`,
    formatChangedFilesForPrompt(changedFiles),
    "",
    truncated
  ].join("\n");
}

function buildCommitSystemPrompt(): string {
  return [
    "你是发布工程中的提交信息生成助手。目标：生成可直接发布的中文 Conventional Commit。",
    "只允许输出合法 JSON 对象，不要输出 markdown、解释文本或代码块。",
    "你必须完整覆盖所有改动文件，不能遗漏关键模块；若改动很多，按功能域聚合描述。",
    "JSON 字段与约束：",
    "type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert 之一。",
    "scope: 可选，建议填写最主要模块名（如 init/template/ai/git）。",
    "subject: 中文，20 字以内，动宾结构，禁止空泛词（如“优化代码”“调整逻辑”）。",
    "body: 必须严格为两行：",
    "第一行格式：用户可见：<面向用户或调用方可感知的变化；若无则写“无明显用户可见变更”>",
    "第二行格式：内部优化：<重构、性能、结构、测试、稳定性等内部变化；若无则写“无明显内部优化”>",
    "body 要简洁具体，可直接进入发布历史。",
    "禁止编造不存在的改动，信息不足时写“待人工复核”。"
  ].join("\n");
}

function buildCommitUserPrompt(diff: string, changedFiles: string[]): string {
  const truncated = truncateDiffForPrompt(
    diff,
    COMMIT_DIFF_MAX_CHARS,
    "[... diff 已截断，请优先确保提交信息覆盖全部变更文件并区分用户可见/内部优化 ...]"
  );

  return [
    "请基于以下 staged diff 生成一条可直接用于发布的提交信息。",
    "要求：完整总结全部变更文件，区分用户可见变更与内部优化，简洁具体。",
    `变更文件（共 ${changedFiles.length} 个）：`,
    formatChangedFilesForPrompt(changedFiles),
    "",
    truncated
  ].join("\n");
}

function createProfileId(): string {
  return `ai_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function toConfig(profile: AiProfile): AiConfig {
  return {
    baseURL: profile.baseURL,
    apiKey: profile.apiKey,
    model: profile.model,
    timeoutMs: profile.timeoutMs
  };
}

export class AiService {
  async getProfiles(): Promise<AiProfile[]> {
    const db = await readDb();
    return db.ai.profiles;
  }

  async getActiveProfile(): Promise<AiProfile | null> {
    const db = await readDb();
    const activeId = db.ai.activeProfileId;
    if (activeId) {
      const active = db.ai.profiles.find((item) => item.id === activeId);
      if (active) {
        return active;
      }
    }
    return db.ai.profiles[0] ?? null;
  }

  async getConfig(): Promise<AiConfig | null> {
    const profile = await this.getActiveProfile();
    return profile ? toConfig(profile) : null;
  }

  async getMaskedConfig(): Promise<Record<string, string | number> | null> {
    const profile = await this.getActiveProfile();
    if (!profile) {
      return null;
    }
    const key = profile.apiKey;
    const prefix = key.slice(0, Math.min(4, key.length));
    const suffix = key.length > 6 ? key.slice(-2) : "";
    return {
      id: profile.id,
      name: profile.name,
      baseURL: profile.baseURL,
      apiKey: `${prefix}****${suffix}`,
      model: profile.model,
      timeoutMs: profile.timeoutMs
    };
  }

  async setConfig(input: SetAiConfigInput): Promise<AiProfile> {
    const profileName = input.profileName?.trim() || DEFAULT_PROFILE_NAME;
    let saved: AiProfile | null = null;

    await writeDb((draft) => {
      const now = new Date().toISOString();
      const index = draft.ai.profiles.findIndex((item) => item.name === profileName);
      const existing = index >= 0 ? draft.ai.profiles[index] : null;

      const merged: AiProfile = {
        id: existing?.id ?? createProfileId(),
        name: profileName,
        baseURL: input.baseURL?.trim() || existing?.baseURL || DEFAULT_BASE_URL,
        apiKey: input.apiKey?.trim() || existing?.apiKey || "",
        model: input.model?.trim() || existing?.model || DEFAULT_MODEL,
        timeoutMs: Math.trunc(input.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };

      if (!merged.apiKey) {
        throw new CliError("apiKey 不能为空");
      }
      if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0) {
        throw new CliError("timeoutMs 必须是正整数");
      }

      if (index >= 0) {
        draft.ai.profiles[index] = merged;
      } else {
        draft.ai.profiles.push(merged);
      }

      if (input.activate ?? true) {
        draft.ai.activeProfileId = merged.id;
      } else if (!draft.ai.activeProfileId) {
        draft.ai.activeProfileId = merged.id;
      }

      saved = merged;
    });

    if (!saved) {
      throw new CliError("AI 配置保存失败");
    }
    return saved;
  }

  async useConfig(identifier: string): Promise<AiProfile> {
    const target = identifier.trim();
    if (!target) {
      throw new CliError("配置标识不能为空");
    }

    let active: AiProfile | null = null;
    await writeDb((draft) => {
      const found = draft.ai.profiles.find((item) => item.id === target || item.name === target);
      if (!found) {
        throw new CliError(`未找到 AI 配置: ${target}`);
      }
      draft.ai.activeProfileId = found.id;
      active = found;
    });

    if (!active) {
      throw new CliError(`未找到 AI 配置: ${target}`);
    }
    return active;
  }

  private async createClient(): Promise<{ client: OpenAI; config: AiConfig }> {
    const config = await this.getConfig();
    if (!config) {
      throw new CliError("AI 配置不存在，请先执行 scafkit ai set");
    }
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs
    });
    return { client, config };
  }

  async testConnection(): Promise<string> {
    const { client, config } = await this.createClient();
    const response = await client.chat.completions.create({
      model: config.model,
      temperature: 0,
      messages: [{ role: "user", content: "返回 ok" }]
    });
    return response.choices[0]?.message?.content?.trim() || "ok";
  }

  async reviewDiff(diff: string): Promise<ReviewResult> {
    if (!diff.trim()) {
      throw new CliError("没有可审查的 staged diff");
    }

    const changedFiles = extractChangedFiles(diff);
    const { client, config } = await this.createClient();
    const response = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildReviewSystemPrompt() },
        { role: "user", content: buildReviewUserPrompt(diff, changedFiles) }
      ]
    });

    const rawText = response.choices[0]?.message?.content || "";
    return parseReviewResponse(rawText, diff);
  }

  async generateCommitMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      throw new CliError("没有可生成提交信息的 staged diff");
    }

    const changedFiles = extractChangedFiles(diff);
    const { client, config } = await this.createClient();
    const response = await client.chat.completions.create({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildCommitSystemPrompt() },
        { role: "user", content: buildCommitUserPrompt(diff, changedFiles) }
      ]
    });

    const rawText = response.choices[0]?.message?.content || "";
    const suggestion = parseCommitSuggestionResponse(rawText, diff);
    return formatConventionalCommit(suggestion);
  }
}
