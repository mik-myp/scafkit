import { Command } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import ora from "ora";
import { ProjectGenerator } from "../core/project-generator.js";
import { TemplateService } from "../core/template-service.js";
import type { TemplateRecord } from "../types.js";
import { parseKeyValuePairs } from "../utils/cli.js";
import { CliError } from "../utils/errors.js";
import { logInfo, logSuccess } from "../utils/logger.js";

interface InitOptions {
  template: string;
  dest?: string;
  force?: boolean;
  var?: string[];
}

interface InitInteractiveOptions {
  dest?: string;
  force?: boolean;
  var?: string[];
}

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function formatTemplateChoiceName(template: TemplateRecord): string {
  const suffix = template.description?.trim()
    ? ` - ${template.description.trim()}`
    : "";
  return `${template.name}${suffix}`;
}

async function promptTemplateId(
  templateService: TemplateService
): Promise<string> {
  const templates = await templateService.listTemplates();
  if (templates.length === 0) {
    throw new CliError("暂无可用模板，请先执行 scafkit template add 添加模板");
  }

  return select({
    message: "请选择模板（上下方向键选择，回车确认）",
    choices: templates.map((item) => ({
      name: formatTemplateChoiceName(item),
      value: item.id,
      description: `${item.id} | ${item.source}`
    }))
  });
}

export function registerInitCommand(program: Command): void {
  const generator = new ProjectGenerator();
  const templateService = new TemplateService();

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

  program
    .command("init-interactive")
    .alias("initx")
    .description("交互式初始化项目：先选模板，再填写项目配置")
    .option("--dest <path>", "目标目录，默认当前目录")
    .option("-f, --force", "目标目录非空时强制继续")
    .option("--var <key=value>", "模板变量，可重复传入", collectString, [])
    .action(async (options: InitInteractiveOptions) => {
      const templateId = await promptTemplateId(templateService);
      const template = await templateService.getTemplateById(templateId);
      logInfo(`已选择模板: ${template.name} (${template.id})`);

      const projectName = await input({
        message: "请输入项目名称",
        validate: (value) => (value.trim() ? true : "项目名称不能为空")
      });

      const destRaw =
        options.dest ??
        (await input({
          message: "请输入目标目录（默认当前目录）",
          default: process.cwd()
        }));

      const shouldForce =
        options.force ??
        (await confirm({
          message: "目标目录非空时是否强制继续？",
          default: false
        }));

      const spinner = ora("正在生成项目...").start();
      let output = "";
      try {
        const variables = parseKeyValuePairs(options.var ?? []);
        output = await generator.generate({
          projectName: projectName.trim(),
          templateId,
          dest: destRaw.trim() || undefined,
          force: shouldForce,
          variables
        });
      } finally {
        spinner.stop();
      }

      logSuccess(`项目生成完成: ${output}`);
    });
}
