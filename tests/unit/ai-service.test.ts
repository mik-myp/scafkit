import { describe, expect, it } from "vitest";
import {
  formatConventionalCommit,
  parseCommitSuggestionResponse,
  parseReviewResponse
} from "../../src/core/ai-service.js";

describe("ai service helpers", () => {
  it("formats chinese conventional commit", () => {
    const message = formatConventionalCommit({
      type: "feat",
      scope: "cli",
      subject: "支持模板批量导入",
      body: "用户可见：新增模板导入入口\n内部优化：重构导入参数解析"
    });

    expect(message).toBe(
      "feat(cli): 支持模板批量导入\n\n用户可见：新增模板导入入口\n内部优化：重构导入参数解析"
    );
  });

  it("parses review response json", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        summary: "本次更新优化模板同步流程并补充错误处理",
        riskItems: ["需关注网络失败重试"],
        testSuggestions: ["验证 git 模板同步异常场景"],
        commitSuggestion: {
          type: "fix",
          scope: "template",
          subject: "修复模板同步失败重试逻辑",
          body: "用户可见：同步失败时提示更明确\n内部优化：补充错误回滚处理"
        }
      }),
      "diff --git a/a b/a"
    );

    expect(result.commitSuggestion.type).toBe("fix");
    expect(result.summary).toContain("优化模板同步流程");
    expect(result.commitSuggestion.body).toContain("用户可见：");
    expect(result.commitSuggestion.body).toContain("内部优化：");
  });

  it("normalizes commit suggestion response body sections", () => {
    const result = parseCommitSuggestionResponse(
      JSON.stringify({
        type: "feat",
        scope: "init",
        subject: "新增交互式初始化命令",
        body: "支持上下键选择模板并回车确认"
      }),
      "diff --git a/a b/a"
    );

    expect(result.type).toBe("feat");
    expect(result.body).toBe(
      "用户可见：支持上下键选择模板并回车确认\n内部优化：无明显内部优化"
    );
  });

  it("falls back when commit suggestion output is invalid json", () => {
    const result = parseCommitSuggestionResponse(
      "not-json",
      "diff --git a/a b/a"
    );
    expect(result.type).toBe("chore");
    expect(result.body).toContain("用户可见：");
    expect(result.body).toContain("内部优化：");
  });
});
