import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../../src/core/git-service.js";

describe("git service commit/push", () => {
  let tempRoot = "";
  let repoDir = "";
  let remoteDir = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scafkit-git-service-"));
    repoDir = path.join(tempRoot, "repo");
    remoteDir = path.join(tempRoot, "remote.git");

    await fs.ensureDir(repoDir);
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "scafkit-test");
    await git.addConfig("user.email", "scafkit-test@example.com");
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.remove(tempRoot);
    }
  });

  it("commits and pushes current branch with upstream on first push", async () => {
    const git = simpleGit(repoDir);
    await simpleGit().raw(["init", "--bare", remoteDir]);
    await git.addRemote("origin", remoteDir);
    await fs.writeFile(path.join(repoDir, "a.txt"), "hello", "utf-8");
    await git.add(["a.txt"]);

    const service = new GitService(repoDir);
    await service.commitStaged(
      "feat(cli): 支持自动提交并推送\n\n补充首次推送上游设置"
    );
    await service.pushCurrentBranch();

    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    const remoteHeads = await git.listRemote(["--heads", "origin", branch]);
    expect(remoteHeads).toContain(`refs/heads/${branch}`);
  });

  it("fails push when remote is missing", async () => {
    const git = simpleGit(repoDir);
    await fs.writeFile(path.join(repoDir, "b.txt"), "world", "utf-8");
    await git.add(["b.txt"]);

    const service = new GitService(repoDir);
    await service.commitStaged("chore: test push without remote");

    await expect(service.pushCurrentBranch()).rejects.toThrow("未配置远程仓库");
  });
});
