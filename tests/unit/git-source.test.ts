import { describe, expect, it } from "vitest";
import {
  buildTemplateGitSourceCandidates,
  normalizeTemplateGitSource
} from "../../src/utils/git-source.js";

describe("normalizeTemplateGitSource", () => {
  it("normalizes github https source", () => {
    const normalized = normalizeTemplateGitSource("https://github.com/openai/scafkit");
    expect(normalized).toBe("https://github.com/openai/scafkit.git");
  });

  it("normalizes gitlab ssh source", () => {
    const normalized = normalizeTemplateGitSource("git@gitlab.com:group/scafkit");
    expect(normalized).toBe("git@gitlab.com:group/scafkit.git");
  });

  it("normalizes gitee host-only source", () => {
    const normalized = normalizeTemplateGitSource("gitee.com/acme/template-repo");
    expect(normalized).toBe("https://gitee.com/acme/template-repo.git");
  });

  it("supports repo-only source without provider/protocol", () => {
    const normalized = normalizeTemplateGitSource("acme/template-repo");
    expect(normalized).toBe("acme/template-repo.git");
  });

  it("throws for unsupported protocol", () => {
    expect(() => normalizeTemplateGitSource("http://github.com/openai/scafkit")).toThrow(
      "仅支持 HTTPS 或 SSH 仓库地址"
    );
  });
});

describe("buildTemplateGitSourceCandidates", () => {
  it("builds provider candidates for repo-only source", () => {
    const candidates = buildTemplateGitSourceCandidates("acme/template-repo");
    expect(candidates).toEqual([
      "https://github.com/acme/template-repo.git",
      "git@github.com:acme/template-repo.git",
      "https://gitlab.com/acme/template-repo.git",
      "git@gitlab.com:acme/template-repo.git",
      "https://gitee.com/acme/template-repo.git",
      "git@gitee.com:acme/template-repo.git"
    ]);
  });
});
