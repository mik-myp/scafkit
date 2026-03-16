import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookService } from "../../src/core/hook-service.js";
import { GitService } from "../../src/core/git-service.js";
import type { AiService } from "../../src/core/ai-service.js";

describe("hook service", () => {
  let tempRoot = "";
  let repoDir = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scafkit-hook-test-"));
    repoDir = path.join(tempRoot, "repo");
    await fs.ensureDir(repoDir);

    const git = simpleGit(repoDir);
    await git.init();
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.remove(tempRoot);
    }
  });

  it("installs and uninstalls commit-msg hook", async () => {
    const fakeAi = {
      generateCommitMessage: async () => "feat(cli): 测试 hook"
    };
    const service = new HookService(
      new GitService(repoDir),
      fakeAi as unknown as AiService
    );

    const installed = await service.install();
    expect(installed.installed).toBe(true);
    expect(installed.managedByScafkit).toBe(true);
    expect(await fs.pathExists(installed.path)).toBe(true);

    await service.uninstall();
    const status = await service.status();
    expect(status.installed).toBe(false);
  });

  it("writes commit message when ai returns suggestion", async () => {
    const git = simpleGit(repoDir);
    await fs.writeFile(path.join(repoDir, "a.txt"), "hello", "utf-8");
    await git.add(["a.txt"]);

    const fakeAi = {
      generateCommitMessage: async () => "feat(core): 新增自动提交信息"
    };
    const service = new HookService(
      new GitService(repoDir),
      fakeAi as unknown as AiService
    );
    const messageFile = path.join(repoDir, ".git", "COMMIT_EDITMSG");

    const result = await service.runCommitMsgHook(messageFile);
    expect(result.updated).toBe(true);
    const content = await fs.readFile(messageFile, "utf-8");
    expect(content.trim()).toBe("feat(core): 新增自动提交信息");
  });

  it("does not block commit when ai fails", async () => {
    const git = simpleGit(repoDir);
    await fs.writeFile(path.join(repoDir, "b.txt"), "world", "utf-8");
    await git.add(["b.txt"]);

    const fakeAi = {
      generateCommitMessage: async () => {
        throw new Error("network error");
      }
    };
    const service = new HookService(
      new GitService(repoDir),
      fakeAi as unknown as AiService
    );
    const messageFile = path.join(repoDir, ".git", "COMMIT_EDITMSG");
    await fs.writeFile(messageFile, "initial", "utf-8");

    const result = await service.runCommitMsgHook(messageFile);
    expect(result.updated).toBe(false);
    expect(result.warning).toContain("不阻塞提交");
    expect(await fs.readFile(messageFile, "utf-8")).toBe("initial");
  });
});
