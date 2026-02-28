import { Command } from "commander";
import ora from "ora";
import { ProjectGenerator } from "../core/project-generator.js";
import { parseKeyValuePairs } from "../utils/cli.js";
import { logSuccess } from "../utils/logger.js";

interface InitOptions {
  template: string;
  dest?: string;
  force?: boolean;
  var?: string[];
}

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerInitCommand(program: Command): void {
  const generator = new ProjectGenerator();

  program
    .command("init <projectName>")
    .description("根据模板初始化项目")
    .requiredOption("-t, --template <id>", "模板 ID")
    .option("--dest <path>", "目标目录，默认当前目录")
    .option("-f, --force", "目标目录非空时强制继续")
    .option("--var <key=value>", "模板变量，可重复传入", collectString, [])
    .action(async (projectName: string, options: InitOptions) => {
      const spinner = ora("正在生成项目...").start();
      let output = "";
      try {
        const variables = parseKeyValuePairs(options.var ?? []);
        output = await generator.generate({
          projectName,
          templateId: options.template,
          dest: options.dest,
          force: options.force,
          variables
        });
      } finally {
        spinner.stop();
      }
      logSuccess(`项目生成完成: ${output}`);
    });
}
