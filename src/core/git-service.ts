import { simpleGit, type SimpleGit } from "simple-git";
import { CliError } from "../utils/errors.js";

export class GitService {
  private readonly git: SimpleGit;

  constructor(private readonly cwd = process.cwd()) {
    this.git = simpleGit({ baseDir: this.cwd });
  }

  async ensureRepository(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw new CliError(`当前目录不是 Git 仓库: ${this.cwd}`);
    }
  }

  async hasStagedChanges(): Promise<boolean> {
    await this.ensureRepository();
    const diff = await this.git.diff(["--staged", "--name-only"]);
    return diff.trim().length > 0;
  }

  async getStagedDiff(): Promise<string> {
    await this.ensureRepository();
    return this.git.diff(["--staged"]);
  }

  async getRepoRoot(): Promise<string> {
    await this.ensureRepository();
    const output = await this.git.revparse(["--show-toplevel"]);
    return output.trim();
  }

  async raw(args: string[]): Promise<string> {
    await this.ensureRepository();
    return this.git.raw(args);
  }

  async commitStaged(message: string): Promise<void> {
    await this.ensureRepository();
    const normalized = message.trim();
    if (!normalized) {
      throw new CliError("提交信息不能为空");
    }

    const paragraphs = normalized
      .split(/\r?\n\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const args: string[] = ["commit"];
    for (const paragraph of paragraphs) {
      args.push("-m", paragraph);
    }

    try {
      await this.git.raw(args);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new CliError(`git commit 失败: ${details}`);
    }
  }

  private async getCurrentBranch(): Promise<string> {
    const branch = (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
    if (!branch || branch === "HEAD") {
      throw new CliError("当前分支不可推送（detached HEAD）");
    }
    return branch;
  }

  private async hasUpstream(): Promise<boolean> {
    try {
      await this.git.revparse(["--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      return true;
    } catch {
      return false;
    }
  }

  async pushCurrentBranch(): Promise<void> {
    await this.ensureRepository();
    const branch = await this.getCurrentBranch();

    try {
      await this.git.push();
      return;
    } catch (error) {
      const hasUpstream = await this.hasUpstream();
      if (hasUpstream) {
        const details = error instanceof Error ? error.message : String(error);
        throw new CliError(`git push 失败: ${details}`);
      }
    }

    const remotes = await this.git.getRemotes();
    if (remotes.length === 0) {
      throw new CliError("git push 失败: 未配置远程仓库");
    }
    const remoteName = remotes.some((item) => item.name === "origin")
      ? "origin"
      : remotes[0].name;

    try {
      await this.git.raw(["push", "-u", remoteName, branch]);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new CliError(`git push 失败: ${details}`);
    }
  }
}
