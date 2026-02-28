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
    const matched = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
    if (!matched) {
      continue;
    }

    const beforePath = matched[1]?.replace(/^"|"$/g, "");
    const afterPath = matched[2]?.replace(/^"|"$/g, "");
    const resolved = afterPath !== "/dev/null" ? afterPath : beforePath;
    if (!resolved || resolved === "/dev/null") {
      continue;
    }

    fileSet.add(resolved);
  }

  if (fileSet.size === 0) {
    for (const line of diff.split("\n")) {
      const matched = line.match(/^\+\+\+ "?b\/(.+?)"?$/);
      if (!matched) {
        continue;
      }
      const file = matched[1]?.replace(/^"|"$/g, "");
      if (!file || file === "/dev/null") {
        continue;
      }
      fileSet.add(file);
    }
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

function normalizeSingleLineText(input: string, maxChars = 30): string {
  const normalized = input
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[。；;]+$/g, "")
    .trim();
  if (!normalized) {
    return "";
  }
  const chars = Array.from(normalized);
  return chars.slice(0, maxChars).join("");
}

interface ParsedCommitHeader {
  type?: string;
  scope?: string;
  subject: string;
}

function unwrapCommitHeaderPrefix(rawSubject: string): ParsedCommitHeader {
  let current = rawSubject.trim();
  let extractedType: string | undefined;
  let extractedScope: string | undefined;

  const headerPattern =
    /^(?<type>feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\((?<scope>[^)]+)\))?:\s*(?<subject>.+)$/i;

  for (let i = 0; i < 2; i += 1) {
    const matched = current.match(headerPattern);
    if (!matched?.groups) {
      break;
    }

    const matchedType = matched.groups.type.toLowerCase();
    const matchedScope = matched.groups.scope?.trim();
    const matchedSubject = matched.groups.subject.trim();
    if (!ALLOWED_COMMIT_TYPES.has(matchedType) || !matchedSubject) {
      break;
    }

    extractedType = matchedType;
    if (matchedScope && !extractedScope) {
      extractedScope = matchedScope;
    }
    current = matchedSubject;
  }

  return {
    type: extractedType,
    scope: extractedScope,
    subject: current
  };
}

function inferScopeFromFiles(files: string[]): string | undefined {
  const scores = new Map<string, number>();
  const bump = (scope: string) => scores.set(scope, (scores.get(scope) ?? 0) + 1);

  for (const file of files) {
    if (file.startsWith("src/commands/git") || file.startsWith("src/core/git")) {
      bump("git");
      continue;
    }
    if (file.startsWith("src/commands/ai") || file.startsWith("src/core/ai")) {
      bump("ai");
      continue;
    }
    if (file.startsWith("src/commands/init") || file.startsWith("src/core/project-generator")) {
      bump("init");
      continue;
    }
    if (file.startsWith("src/commands/template") || file.startsWith("src/core/template")) {
      bump("template");
      continue;
    }
    if (file.startsWith("src/core/hook") || file.startsWith("src/commands/hook")) {
      bump("hook");
      continue;
    }
    if (file.startsWith("src/db/")) {
      bump("db");
      continue;
    }
    if (file.startsWith("src/utils/")) {
      bump("utils");
      continue;
    }
    if (file.startsWith("tests/")) {
      bump("test");
      continue;
    }
    if (file.toLowerCase().includes("readme")) {
      bump("docs");
      continue;
    }
  }

  if (scores.size === 0) {
    return undefined;
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0];
}

function inferCommitType(files: string[]): string {
  if (files.length === 0) {
    return "chore";
  }

  const allDocs = files.every(
    (file) =>
      file.toLowerCase().includes("readme") || file.startsWith("docs/") || file.endsWith(".md")
  );
  if (allDocs) {
    return "docs";
  }

  const allTests = files.every(
    (file) =>
      file.startsWith("tests/") ||
      file.includes(".test.") ||
      file.includes(".spec.")
  );
  if (allTests) {
    return "test";
  }

  if (files.some((file) => file.startsWith("src/commands/") || file === "src/cli.ts")) {
    return "feat";
  }

  if (files.some((file) => file.startsWith("src/core/") || file.startsWith("src/utils/"))) {
    return "refactor";
  }

  return "chore";
}

function buildHeuristicCommitSuggestion(files: string[]): CommitSuggestion {
  const userVisibleFiles = files.filter(
    (file) =>
      file.startsWith("src/commands/") ||
      file === "src/cli.ts" ||
      file.toLowerCase().includes("readme") ||
      file.startsWith("docs/")
  );

  const internalFiles = files.filter((file) => !userVisibleFiles.includes(file));
  const scope = inferScopeFromFiles(files);
  const type = inferCommitType(files);
  const scopeLabel = scope ?? "项目";

  let subject = "";
  if (files.length === 0) {
    subject = "待人工复核本次代码改动";
  } else if (type === "docs") {
    subject = "更新文档说明与使用示例";
  } else if (type === "test") {
    subject = "补充测试覆盖关键变更";
  } else if (userVisibleFiles.length > 0) {
    subject = `完善${scopeLabel}相关命令与功能`;
  } else if (internalFiles.length > 0) {
    subject = `优化${scopeLabel}内部实现逻辑`;
  } else {
    subject = `更新${scopeLabel}相关实现`;
  }

  return {
    type,
    scope,
    subject: normalizeSingleLineText(subject, 30)
  };
}

function isCommitSuggestionTooGeneric(suggestion: CommitSuggestion, files: string[]): boolean {
  const subject = suggestion.subject.trim();

  const genericSubjectPatterns = [
    /^同步代码改动$/,
    /^更新代码变更$/,
    /^同步\d+个文件改动$/,
    /^同步文件改动$/,
    /^更新项目文件$/,
    /^(同步|更新|调整|优化)(代码|实现|逻辑|改动)$/
  ];

  if (genericSubjectPatterns.some((pattern) => pattern.test(subject))) {
    return true;
  }

  if (Array.from(subject).length < 6) {
    return true;
  }

  if (files.length > 0 && subject.includes("待人工复核")) {
    return true;
  }

  return false;
}

function normalizeCommitSuggestion(input: Partial<CommitSuggestion> | undefined): CommitSuggestion {
  const inputType = input?.type?.trim().toLowerCase();
  const inputScope = input?.scope?.trim();
  const rawSubject = input?.subject?.trim() || "待人工复核本次代码改动";
  const unwrapped = unwrapCommitHeaderPrefix(rawSubject);

  const typeCandidate = unwrapped.type || inputType || "chore";
  const type = ALLOWED_COMMIT_TYPES.has(typeCandidate) ? typeCandidate : "chore";
  const scope = inputScope || unwrapped.scope || undefined;
  const subject = normalizeSingleLineText(unwrapped.subject, 30);

  return {
    type,
    scope,
    subject: subject || "待人工复核本次代码改动"
  };
}

function createFallbackCommitSuggestion(diff: string): CommitSuggestion {
  const files = extractChangedFiles(diff);
  return buildHeuristicCommitSuggestion(files);
}

export function createFallbackReviewResult(diff: string): ReviewResult {
  const fileCount = extractChangedFiles(diff).length;
  return {
    summary: `检测到 ${fileCount} 个文件的变更，建议在提交前手动复查核心逻辑与测试覆盖。`,
    riskItems: ["AI 返回不可解析，已降级为基础建议。"],
    testSuggestions: ["执行相关单元测试并手动验证关键路径。"],
    commitSuggestion: normalizeCommitSuggestion(createFallbackCommitSuggestion(diff))
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
      commitSuggestion: normalizeCommitSuggestion(parsed.commitSuggestion)
    };
  } catch {
    return fallback;
  }
}

export function parseCommitSuggestionResponse(rawText: string, diff: string): CommitSuggestion {
  const fallback = normalizeCommitSuggestion(createFallbackCommitSuggestion(diff));

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

    return normalizeCommitSuggestion(candidate);
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
    "commitSuggestion: 对象，包含 type/scope/subject。",
    "type 只能是 feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert。",
    "scope 可选，尽量使用受影响模块名（如 cli/template/git/hook）。",
    "subject 必须是中文一句话，最多 30 字，使用动宾结构，不要句号。",
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
    "提交信息必须具体，不允许使用“同步代码改动/更新代码变更/优化代码逻辑”等空泛描述。",
    "JSON 字段与约束：",
    "type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert 之一。",
    "scope: 可选，建议填写最主要模块名（如 init/template/ai/git）。",
    "subject: 中文一句话，最多 30 字，动宾结构；必须体现具体模块或能力点。",
    "禁止编造不存在的改动，信息不足时写“待人工复核”。"
  ].join("\n");
}

function buildCommitUserPrompt(diff: string, changedFiles: string[]): string {
  const truncated = truncateDiffForPrompt(
    diff,
    COMMIT_DIFF_MAX_CHARS,
    "[... diff 已截断，请优先确保提交信息覆盖全部变更文件并保持一句话总结 ...]"
  );

  return [
    "请基于以下 staged diff 生成一条可直接用于发布的提交信息。",
    "要求：完整总结全部变更文件，简洁具体，一句话概括。",
    "要求：subject 不得使用“同步代码改动/更新代码变更”等泛化表述。",
    "要求：subject 最多 30 字。",
    `变更文件（共 ${changedFiles.length} 个）：`,
    formatChangedFilesForPrompt(changedFiles),
    "",
    truncated
  ].join("\n");
}

function buildCommitRetryUserPrompt(
  diff: string,
  changedFiles: string[],
  previous: CommitSuggestion
): string {
  const previousMessage = formatConventionalCommit(previous);
  const truncated = truncateDiffForPrompt(
    diff,
    COMMIT_DIFF_MAX_CHARS,
    "[... diff 已截断，请优先给出具体模块/能力点并覆盖全部文件 ...]"
  );

  return [
    "上一版提交信息过于泛化，请重写并严格满足以下要求。",
    "1) subject 必须具体到模块或能力点，禁止“同步代码改动/更新代码变更/优化代码逻辑”类描述。",
    "2) subject 必须为一句话，最多 30 字。",
    "3) 仍需覆盖全部改动文件，不遗漏关键变更。",
    "",
    "上一版结果：",
    previousMessage,
    "",
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
    const runCommitSuggestion = async (userPrompt: string): Promise<CommitSuggestion> => {
      const response = await client.chat.completions.create({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildCommitSystemPrompt() },
          { role: "user", content: userPrompt }
        ]
      });
      const rawText = response.choices[0]?.message?.content || "";
      return parseCommitSuggestionResponse(rawText, diff);
    };

    let suggestion = await runCommitSuggestion(buildCommitUserPrompt(diff, changedFiles));

    if (isCommitSuggestionTooGeneric(suggestion, changedFiles)) {
      suggestion = await runCommitSuggestion(
        buildCommitRetryUserPrompt(diff, changedFiles, suggestion)
      );
    }

    if (isCommitSuggestionTooGeneric(suggestion, changedFiles)) {
      suggestion = normalizeCommitSuggestion(buildHeuristicCommitSuggestion(changedFiles));
    }

    return formatConventionalCommit(suggestion);
  }
}
