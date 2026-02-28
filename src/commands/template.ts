import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { TemplateService } from "../core/template-service.js";
import { logInfo, logSuccess } from "../utils/logger.js";
import { parseJsonArrayOption } from "../utils/cli.js";
import type { TemplateVariable } from "../types.js";

interface TemplateOptions {
  id?: string;
  name?: string;
  description?: string;
  source?: string;
  branch?: string;
  subPath?: string;
  variables?: string;
}

export function registerTemplateCommands(program: Command): void {
  const service = new TemplateService();
  const template = program.command("template").description("模板管理");

  template
    .command("add")
    .description("新增远程模板")
    .option("--id <id>", "模板 ID")
    .option("--name <name>", "模板名称")
    .option("--description <description>", "模板描述")
    .option("--source <source>", "远程仓库地址（支持 GitHub/GitLab/Gitee）")
    .option("--branch <branch>", "git 分支")
    .option("--sub-path <subPath>", "模板子目录")
    .option("--variables <json>", "变量定义 JSON 数组")
    .action(async (options: TemplateOptions) => {
      const name = options.name || (await input({ message: "模板名称" }));
      const source =
        options.source ||
        (await input({ message: "远程仓库地址（示例: github.com/org/repo 或 git@gitlab.com:group/repo）" }));
      const variables = parseJsonArrayOption<TemplateVariable>(options.variables, "variables");
      const result = await service.addTemplate({
        id: options.id,
        name,
        description: options.description,
        source,
        branch: options.branch,
        subPath: options.subPath,
        variables
      });
      logSuccess(`模板已创建: ${result.id} (${result.name})`);
    });

  template
    .command("list")
    .description("查看模板列表")
    .action(async () => {
      const list = await service.listTemplates();
      if (list.length === 0) {
        logInfo("暂无模板");
        return;
      }
      console.table(
        list.map((item) => ({
          id: item.id,
          name: item.name,
          source: item.source,
          updatedAt: item.updatedAt
        }))
      );
    });

  template
    .command("show <id>")
    .description("查看模板详情")
    .action(async (id: string) => {
      const result = await service.getTemplateById(id);
      console.log(JSON.stringify(result, null, 2));
    });

  template
    .command("update <id>")
    .description("更新模板")
    .option("--name <name>", "模板名称")
    .option("--description <description>", "模板描述")
    .option("--source <source>", "远程仓库地址")
    .option("--branch <branch>", "git 分支")
    .option("--sub-path <subPath>", "模板子目录")
    .option("--variables <json>", "变量定义 JSON 数组")
    .action(async (id: string, options: TemplateOptions) => {
      const variables = parseJsonArrayOption<TemplateVariable>(options.variables, "variables");
      const result = await service.updateTemplate(id, {
        name: options.name,
        description: options.description,
        source: options.source,
        branch: options.branch,
        subPath: options.subPath,
        variables
      });
      logSuccess(`模板已更新: ${result.id} (${result.name})`);
    });

  template
    .command("remove <id>")
    .description("删除模板")
    .option("-y, --yes", "跳过确认")
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm({ message: `确认删除模板 ${id} 吗？`, default: false });
        if (!ok) {
          logInfo("已取消删除");
          return;
        }
      }
      await service.removeTemplate(id);
      logSuccess(`模板已删除: ${id}`);
    });

  template
    .command("sync <id>")
    .description("同步模板到本地缓存")
    .action(async (id: string) => {
      await service.syncTemplate(id);
      logSuccess(`模板同步完成: ${id}`);
    });
}
