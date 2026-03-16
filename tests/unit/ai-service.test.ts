import { describe, expect, it } from "vitest";
import {
  formatConventionalCommit,
  parseCommitSuggestionResponse,
  parseReviewResponse
} from "../../src/core/ai-service.js";

describe("ai service helpers", () => {
  it("formats conventional commit as one line when no body", () => {
    const message = formatConventionalCommit({
      type: "feat",
      scope: "cli",
      subject: "新增交互式模板初始化命令"
    });

    expect(message).toBe("feat(cli): 新增交互式模板初始化命令");
  });

  it("parses review response and keeps one-line subject", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        summary: "本次更新优化模板同步流程并补充错误处理",
        riskItems: ["需关注网络失败重试"],
        testSuggestions: ["验证 git 模板同步异常场景"],
        commitSuggestion: {
          type: "fix",
          scope: "template",
          subject: "修复模板同步失败重试逻辑并增强错误提示与回滚处理能力",
          body: "这段 body 会被忽略"
        }
      }),
      "diff --git a/src/core/template-service.ts b/src/core/template-service.ts"
    );

    expect(result.commitSuggestion.type).toBe("fix");
    expect(result.summary).toContain("优化模板同步流程");
    expect(
      Array.from(result.commitSuggestion.subject).length
    ).toBeLessThanOrEqual(30);
    expect(result.commitSuggestion.body).toBeUndefined();
  });

  it("normalizes commit suggestion to one sentence and max 30 chars", () => {
    const result = parseCommitSuggestionResponse(
      JSON.stringify({
        type: "feat",
        scope: "init",
        subject: "新增交互式初始化命令并支持上下键选择模板以及回车确认操作"
      }),
      "diff --git a/src/commands/init.ts b/src/commands/init.ts"
    );

    expect(result.type).toBe("feat");
    expect(Array.from(result.subject).length).toBeLessThanOrEqual(30);
    expect(result.body).toBeUndefined();
  });

  it("unwraps conventional prefix in subject and fixes type", () => {
    const result = parseCommitSuggestionResponse(
      JSON.stringify({
        type: "chore",
        subject: "feat: 支持远程模板与 AI 多配置交互能力"
      }),
      "diff --git a/src/commands/template.ts b/src/commands/template.ts"
    );

    expect(result.type).toBe("feat");
    expect(result.subject).toBe("支持远程模板与 AI 多配置交互能力");
  });

  it("falls back when commit suggestion output is invalid json", () => {
    const result = parseCommitSuggestionResponse(
      "not-json",
      "diff --git a/src/commands/git.ts b/src/commands/git.ts"
    );

    expect(result.type.length).toBeGreaterThan(0);
    expect(result.subject.length).toBeGreaterThan(0);
    expect(Array.from(result.subject).length).toBeLessThanOrEqual(30);
    expect(result.body).toBeUndefined();
  });
});
