#!/usr/bin/env node
import { Command } from "commander";
import { registerTemplateCommands } from "./commands/template.js";
import { registerInitCommand } from "./commands/init.js";
import { registerAiCommands } from "./commands/ai.js";
import { registerGitCommands } from "./commands/git.js";
import { registerHookCommands } from "./commands/hook.js";
import { asErrorMessage, CliError } from "./utils/errors.js";
import { logError } from "./utils/logger.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("scafkit")
    .description("远程模板脚手架与 AI Git 助手")
    .version("0.1.0");

  registerTemplateCommands(program);
  registerInitCommand(program);
  registerAiCommands(program);
  registerGitCommands(program);
  registerHookCommands(program);

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    logError(error.message);
    process.exit(error.exitCode);
  }
  logError(asErrorMessage(error));
  process.exit(1);
});
