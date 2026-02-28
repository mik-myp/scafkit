import { describe, expect, it } from "vitest";
import { formatConventionalCommit, parseReviewResponse } from "../../src/core/ai-service.js";

describe("ai service helpers", () => {
  it("formats chinese conventional commit", () => {
    const message = formatConventionalCommit({
      type: "feat",
      scope: "cli",
      subject: "支持模板批量导入",
      body: "新增 git 与本地模板混合导入逻辑。"
    });

    expect(message).toBe(
      "feat(cli): 支持模板批量导入\n\n新增 git 与本地模板混合导入逻辑。"
    );
  });

  it("parses review response json", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        summary: "本次更新优化模板同步流程",
        riskItems: ["需关注网络失败重试"],
        testSuggestions: ["验证 git 模板同步异常场景"],
        commitSuggestion: {
          type: "fix",
          scope: "template",
          subject: "修复模板同步失败重试逻辑"
        }
      }),
      "diff --git a/a b/a"
    );

    expect(result.commitSuggestion.type).toBe("fix");
    expect(result.summary).toContain("优化模板同步流程");
  });

  it("falls back when ai output is invalid json", () => {
    const result = parseReviewResponse("not-json", "diff --git a/a b/a");
    expect(result.commitSuggestion.type).toBe("chore");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
