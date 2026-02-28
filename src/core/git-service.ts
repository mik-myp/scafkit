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
}
