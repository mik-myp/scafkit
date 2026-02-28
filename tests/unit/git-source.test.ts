import { describe, expect, it } from "vitest";
import { normalizeTemplateGitSource } from "../../src/utils/git-source.js";

describe("normalizeTemplateGitSource", () => {
  it("normalizes github https source", () => {
    const normalized = normalizeTemplateGitSource("https://github.com/openai/scafkit");
    expect(normalized).toBe("https://github.com/openai/scafkit.git");
  });

  it("normalizes github ssh source", () => {
    const normalized = normalizeTemplateGitSource("git@github.com:openai/scafkit");
    expect(normalized).toBe("git@github.com:openai/scafkit.git");
  });

  it("normalizes gitlab https source with subgroup", () => {
    const normalized = normalizeTemplateGitSource("https://gitlab.com/group/subgroup/scafkit");
    expect(normalized).toBe("https://gitlab.com/group/subgroup/scafkit.git");
  });

  it("normalizes gitlab ssh source", () => {
    const normalized = normalizeTemplateGitSource("git@gitlab.com:group/scafkit");
    expect(normalized).toBe("git@gitlab.com:group/scafkit.git");
  });

  it("accepts host-only source and converts to https", () => {
    const normalized = normalizeTemplateGitSource("github.com/openai/scafkit");
    expect(normalized).toBe("https://github.com/openai/scafkit.git");
  });

  it("throws for unsupported protocol on known host", () => {
    expect(() => normalizeTemplateGitSource("http://github.com/openai/scafkit")).toThrow(
      "仅支持 GitHub/GitLab 的 HTTPS 或 SSH 地址"
    );
  });
});
