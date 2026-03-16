import { Command } from "commander";
import ora from "ora";
import { confirm, input } from "@inquirer/prompts";
import {
  AiService,
  createFallbackReviewResult,
  formatConventionalCommit
} from "../core/ai-service.js";
import { GitService } from "../core/git-service.js";
import { asErrorMessage } from "../utils/errors.js";
import { logInfo, logSuccess, logWarn } from "../utils/logger.js";

interface GitReviewOptions {
  staged?: boolean;
}

async function promptManualCommitMessage(): Promise<string> {
  return input({
    message: "请输入提交信息",
    validate: (value) => (value.trim() ? true : "提交信息不能为空")
  });
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
      let degradedReason = "";
      try {
        diff = await gitService.getStagedDiff();
        if (!diff.trim()) {
          return;
        }
        try {
          result = await aiService.reviewDiff(diff);
        } catch (error) {
          degradedReason = asErrorMessage(error);
          result = createFallbackReviewResult(diff);
        }
      } finally {
        spinner.stop();
      }
      if (!diff.trim() || !result) {
        logInfo("没有可审查的 staged 变更");
        return;
      }
      if (degradedReason) {
        logWarn(`AI 审查失败，已降级为本地建议：${degradedReason}`);
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
    .description("生成中文 Conventional Commit 提交信息，并自动 commit/push")
    .option("--staged", "分析 staged 变更", true)
    .action(async (_options: GitReviewOptions) => {
      const spinner = ora("正在生成提交信息...").start();
      let diff = "";
      let message = "";
      let degradedReason = "";
      try {
        diff = await gitService.getStagedDiff();
        if (!diff.trim()) {
          return;
        }
        try {
          message = await aiService.generateCommitMessage(diff);
        } catch (error) {
          degradedReason = asErrorMessage(error);
        }
      } finally {
        spinner.stop();
      }
      if (!diff.trim()) {
        logInfo("没有已暂存的文件，请先执行 git add 后重试");
        return;
      }
      let finalMessage = "";
      if (degradedReason || !message.trim()) {
        logWarn(
          `AI 生成提交信息失败，已切换为手动输入模式：${degradedReason || "未生成有效提交信息"}`
        );
        finalMessage = await promptManualCommitMessage();
      } else {
        logSuccess("提交信息生成完成");
        console.log(`\n生成的提交信息:\n${message}\n`);

        const useGenerated = await confirm({
          message: "是否使用该提交信息执行 git commit 并推送？",
          default: true
        });

        finalMessage = useGenerated
          ? message
          : await promptManualCommitMessage();
      }

      const commitSpinner = ora("正在执行 git commit...").start();
      try {
        await gitService.commitStaged(finalMessage);
        commitSpinner.succeed("git commit 完成");
      } catch (error) {
        commitSpinner.fail("git commit 失败");
        throw error;
      }

      const pushSpinner = ora("正在执行 git push...").start();
      try {
        await gitService.pushCurrentBranch();
        pushSpinner.succeed("git push 完成");
      } catch (error) {
        pushSpinner.fail("git push 失败");
        throw error;
      }

      logSuccess("代码已完成提交并推送");
    });
}
