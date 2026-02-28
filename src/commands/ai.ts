import { Command } from "commander";
import { password } from "@inquirer/prompts";
import ora from "ora";
import { AiService } from "../core/ai-service.js";
import { asErrorMessage } from "../utils/errors.js";
import { logInfo, logSuccess, logWarn } from "../utils/logger.js";

interface AiSetOptions {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeout?: string;
}

export function registerAiCommands(program: Command): void {
  const aiService = new AiService();
  const ai = program.command("ai").description("AI 配置管理");

  ai.command("set")
    .description("新增或更新 AI 配置，并切换为当前配置")
    .option("--name <name>", "配置名称（默认 default）")
    .option("--base-url <url>", "API Base URL")
    .option("--api-key <key>", "API Key")
    .option("--model <model>", "模型名称")
    .option("--timeout <ms>", "超时时间（毫秒）")
    .action(async (options: AiSetOptions) => {
      const apiKey = options.apiKey || (await password({ message: "请输入 API Key" }));
      const config = await aiService.setConfig({
        profileName: options.name,
        baseURL: options.baseUrl || undefined,
        apiKey,
        model: options.model || undefined,
        timeoutMs: options.timeout ? Number(options.timeout) : undefined,
        activate: true
      });
      logSuccess(`AI 配置已更新并激活: ${config.name} (${config.baseURL} / ${config.model})`);
    });

  ai.command("list")
    .description("查看 AI 配置列表")
    .action(async () => {
      const profiles = await aiService.getProfiles();
      const active = await aiService.getActiveProfile();
      if (profiles.length === 0) {
        logInfo("AI 配置尚未设置");
        return;
      }
      console.table(
        profiles.map((item) => ({
          active: active?.id === item.id ? "*" : "",
          id: item.id,
          name: item.name,
          baseURL: item.baseURL,
          model: item.model,
          timeoutMs: item.timeoutMs,
          updatedAt: item.updatedAt
        }))
      );
    });

  ai.command("use <idOrName>")
    .description("切换当前使用的 AI 配置")
    .action(async (idOrName: string) => {
      const profile = await aiService.useConfig(idOrName);
      logSuccess(`已切换 AI 配置: ${profile.name} (${profile.id})`);
    });

  ai.command("show")
    .description("查看当前 AI 配置（脱敏）")
    .action(async () => {
      const config = await aiService.getMaskedConfig();
      if (!config) {
        logInfo("AI 配置尚未设置");
        return;
      }
      console.log(JSON.stringify(config, null, 2));
    });

  ai.command("test")
    .description("测试 AI 连通性")
    .action(async () => {
      const spinner = ora("正在测试 AI 连通性...").start();
      let output = "";
      try {
        output = await aiService.testConnection();
        logSuccess(`AI 连通性正常: ${output}`);
      } catch (error) {
        logWarn(`AI 连通性测试失败: ${asErrorMessage(error)}`);
        logInfo("不会影响脚手架基础能力，可继续使用模板管理/初始化等命令。");
      } finally {
        spinner.stop();
      }
    });
}
