import { Command } from "commander";
import { HookService } from "../core/hook-service.js";
import { logInfo, logSuccess, logWarn } from "../utils/logger.js";
import { asErrorMessage } from "../utils/errors.js";

export function registerHookCommands(program: Command): void {
  const hookService = new HookService();
  const hook = program.command("hook").description("Git Hook 管理");

  hook
    .command("install")
    .description("安装 commit-msg hook")
    .action(async () => {
      const status = await hookService.install();
      logSuccess(`Hook 安装完成: ${status.path}`);
    });

  hook
    .command("uninstall")
    .description("卸载 commit-msg hook")
    .action(async () => {
      await hookService.uninstall();
      logSuccess("Hook 已卸载");
    });

  hook
    .command("status")
    .description("查看 hook 状态")
    .action(async () => {
      const status = await hookService.status();
      if (!status.installed) {
        logInfo("Hook 未安装");
        logInfo(`目标路径: ${status.path}`);
        return;
      }
      logSuccess(`Hook 已安装: ${status.path}`);
      logInfo(`是否由 scafkit 管理: ${status.managedByScafkit ? "是" : "否"}`);
    });

  hook
    .command("run-commit-msg <messageFile>")
    .description("内部命令：由 commit-msg hook 调用")
    .action(async (messageFile: string) => {
      try {
        const result = await hookService.runCommitMsgHook(messageFile);
        if (result.warning) {
          logWarn(result.warning);
          return;
        }
        if (result.updated && result.message) {
          logInfo(`已更新提交信息: ${result.message}`);
        }
      } catch (error) {
        logWarn(`执行失败（已降级放行）: ${asErrorMessage(error)}`);
      }
    });
}
