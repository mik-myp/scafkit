import { Command } from "commander";
import ora from "ora";
import { AiService, formatConventionalCommit } from "../core/ai-service.js";
import { GitService } from "../core/git-service.js";
import { logInfo, logSuccess } from "../utils/logger.js";

interface GitReviewOptions {
  staged?: boolean;
}

export function registerGitCommands(program: Command): void {
  const aiService = new AiService();
  const gitService = new GitService();
  const git = program.command("git").description("Git AI 助手");

  git
    .command("review")
    .description("审查 staged diff")
    .option("--staged", "审查 staged 变更", true)
    .action(async (_options: GitReviewOptions) => {
      const spinner = ora("正在分析 staged diff...").start();
      let diff = "";
      let result: Awaited<ReturnType<AiService["reviewDiff"]>> | null = null;
      try {
        diff = await gitService.getStagedDiff();
        if (!diff.trim()) {
          return;
        }
        result = await aiService.reviewDiff(diff);
      } finally {
        spinner.stop();
      }
      if (!diff.trim() || !result) {
        logInfo("没有可审查的 staged 变更");
        return;
      }
      logSuccess("AI 审查完成");
      console.log(`\n总结:\n${result.summary}\n`);
      if (result.riskItems.length > 0) {
        console.log("风险项:");
        for (const item of result.riskItems) {
          console.log(`- ${item}`);
        }
        console.log("");
      }
      if (result.testSuggestions.length > 0) {
        console.log("测试建议:");
        for (const item of result.testSuggestions) {
          console.log(`- ${item}`);
        }
        console.log("");
      }
      console.log("建议提交信息:");
      console.log(formatConventionalCommit(result.commitSuggestion));
    });

  git
    .command("commit-message")
    .description("生成中文 Conventional Commit 提交信息")
    .option("--staged", "分析 staged 变更", true)
    .action(async (_options: GitReviewOptions) => {
      const spinner = ora("正在生成提交信息...").start();
      let diff = "";
      let message = "";
      try {
        diff = await gitService.getStagedDiff();
        if (!diff.trim()) {
          return;
        }
        message = await aiService.generateCommitMessage(diff);
      } finally {
        spinner.stop();
      }
      if (!diff.trim()) {
        logInfo("没有可分析的 staged 变更");
        return;
      }
      logSuccess("生成完成");
      console.log(message);
    });
}
