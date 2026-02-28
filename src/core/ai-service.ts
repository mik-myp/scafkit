import OpenAI from "openai";
import { readDb, writeDb } from "../db/store.js";
import type { AiConfig, CommitSuggestion, ReviewResult } from "../types.js";
import { CliError } from "../utils/errors.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT = 30_000;
const REVIEW_DIFF_MAX_CHARS = 20_000;
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

export interface SetAiConfigInput {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export function createFallbackReviewResult(diff: string): ReviewResult {
  const fileCount = diff
    .split("\n")
    .filter((line) => line.startsWith("diff --git"))
    .length;
  return {
    summary: `检测到 ${fileCount} 个文件的变更，建议在提交前手动复查核心逻辑与测试覆盖。`,
    riskItems: ["AI 返回不可解析，已降级为基础建议。"],
    testSuggestions: ["执行相关单元测试并手动验证关键路径。"],
    commitSuggestion: {
      type: "chore",
      subject: "更新代码变更并完成自检"
    }
  };
}

function normalizeCommitSuggestion(input: Partial<CommitSuggestion> | undefined): CommitSuggestion {
  const type = input?.type?.trim().toLowerCase() || "chore";
  return {
    type: ALLOWED_COMMIT_TYPES.has(type) ? type : "chore",
    scope: input?.scope?.trim() || undefined,
    subject: (input?.subject?.trim() || "更新代码变更").replace(/\s+/g, " "),
    body: input?.body?.trim() || undefined
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
      testSuggestions:
        testSuggestions.length > 0 ? testSuggestions : fallback.testSuggestions,
      commitSuggestion: normalizeCommitSuggestion(parsed.commitSuggestion)
    };
  } catch {
    return fallback;
  }
}

function buildSystemPrompt(): string {
  return [
    "你是资深代码审查助手，请基于 git staged diff 给出可执行的审查结论。",
    "只允许输出合法 JSON 对象，不要输出 markdown、解释文本或代码块。",
    "JSON 字段与约束：",
    "summary: 中文字符串，1-2 句，先讲核心变更，再讲主要风险。",
    "riskItems: 中文字符串数组，按风险优先级排序，最多 5 条；无明显风险时返回空数组。",
    "testSuggestions: 中文字符串数组，给出可落地验证建议，最多 5 条。",
    "commitSuggestion: 对象，包含 type/scope/subject/body。",
    "type 只能是 feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert。",
    "scope 可选，尽量使用受影响模块名（如 cli/template/git/hook）。",
    "subject 必须是中文，20 字以内，使用动宾结构，不要句号。",
    "body 可选；如需填写，用 1-3 行中文说明变更动机或影响。",
    "禁止编造不存在的改动，信息不足时明确标注“需人工复核”。"
  ].join("\n");
}

function buildUserPrompt(diff: string): string {
  const normalized = diff.trim();
  const truncated =
    normalized.length > REVIEW_DIFF_MAX_CHARS
      ? `${normalized.slice(0, REVIEW_DIFF_MAX_CHARS)}\n\n[... diff 已截断，请优先识别高风险问题 ...]`
      : normalized;
  return [
    "请审查以下 staged diff，并给出风险、测试建议与提交信息。",
    "重点关注：兼容性、边界条件、异常处理、回滚影响、测试覆盖。",
    "",
    truncated
  ].join("\n");
}

export class AiService {
  async getConfig(): Promise<AiConfig | null> {
    const db = await readDb();
    return db.ai;
  }

  async getMaskedConfig(): Promise<Record<string, string | number> | null> {
    const config = await this.getConfig();
    if (!config) {
      return null;
    }
    const key = config.apiKey;
    const prefix = key.slice(0, Math.min(4, key.length));
    const suffix = key.length > 6 ? key.slice(-2) : "";
    return {
      baseURL: config.baseURL,
      apiKey: `${prefix}****${suffix}`,
      model: config.model,
      timeoutMs: config.timeoutMs
    };
  }

  async setConfig(input: SetAiConfigInput): Promise<AiConfig> {
    const current = (await this.getConfig()) ?? {
      baseURL: DEFAULT_BASE_URL,
      apiKey: "",
      model: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT
    };

    const merged: AiConfig = {
      baseURL: input.baseURL?.trim() || current.baseURL || DEFAULT_BASE_URL,
      apiKey: input.apiKey?.trim() || current.apiKey,
      model: input.model?.trim() || current.model || DEFAULT_MODEL,
      timeoutMs: Math.trunc(input.timeoutMs ?? current.timeoutMs ?? DEFAULT_TIMEOUT)
    };

    if (!merged.apiKey) {
      throw new CliError("apiKey 不能为空");
    }
    if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0) {
      throw new CliError("timeoutMs 必须是正整数");
    }

    await writeDb((draft) => {
      draft.ai = merged;
    });
    return merged;
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
    const { client, config } = await this.createClient();
    const response = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(diff) }
      ]
    });
    const rawText = response.choices[0]?.message?.content || "";
    return parseReviewResponse(rawText, diff);
  }

  async generateCommitMessage(diff: string): Promise<string> {
    const review = await this.reviewDiff(diff);
    return formatConventionalCommit(review.commitSuggestion);
  }
}
