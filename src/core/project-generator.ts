import path from "node:path";
import fs from "fs-extra";
import { input } from "@inquirer/prompts";
import { TemplateService } from "./template-service.js";
import type { TemplateRecord } from "../types.js";
import { CliError } from "../utils/errors.js";
import { renderTemplateString } from "../render/ejs-renderer.js";

export interface GenerateProjectInput {
  projectName: string;
  templateId: string;
  dest?: string;
  variables?: Record<string, string>;
  force?: boolean;
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf"
]);

function isBinaryByBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

async function collectVariables(
  template: TemplateRecord,
  projectName: string,
  cliVariables: Record<string, string>
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {
    projectName,
    ...cliVariables
  };

  for (const variable of template.variables ?? []) {
    if (merged[variable.key] !== undefined) {
      continue;
    }
    if (variable.defaultValue !== undefined) {
      merged[variable.key] = variable.defaultValue;
      continue;
    }
    const value = await input({
      message: `${variable.key}${variable.desc ? ` (${variable.desc})` : ""}`,
      validate: (text) => {
        if (variable.required && !text.trim()) {
          return `${variable.key} 为必填项`;
        }
        return true;
      }
    });
    if (!value.trim() && variable.required) {
      throw new CliError(`变量 ${variable.key} 不能为空`);
    }
    merged[variable.key] = value;
  }

  return merged;
}

async function renderDirectory(
  sourceDir: string,
  targetDir: string,
  variables: Record<string, string>
) {
  await fs.ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetName = entry.name.endsWith(".ejs")
      ? entry.name.slice(0, -4)
      : entry.name;
    const targetPath = path.join(targetDir, targetName);

    if (entry.isDirectory()) {
      await renderDirectory(sourcePath, targetPath, variables);
      continue;
    }

    if (entry.name === ".DS_Store") {
      continue;
    }

    const extname = path.extname(entry.name).toLowerCase();
    const buffer = await fs.readFile(sourcePath);
    const isBinary = BINARY_EXTENSIONS.has(extname) || isBinaryByBuffer(buffer);
    if (isBinary) {
      await fs.writeFile(targetPath, buffer);
      continue;
    }

    const rendered = renderTemplateString(buffer.toString("utf-8"), variables);
    await fs.writeFile(targetPath, rendered, "utf-8");
  }
}

export class ProjectGenerator {
  constructor(private readonly templateService = new TemplateService()) {}

  async generate(input: GenerateProjectInput): Promise<string> {
    const template = await this.templateService.getTemplateById(
      input.templateId
    );
    const sourceDir = await this.templateService.resolveTemplateDir(
      template.id
    );
    const targetDir = path.resolve(
      input.dest ?? process.cwd(),
      input.projectName
    );

    if (await fs.pathExists(targetDir)) {
      const files = await fs.readdir(targetDir);
      if (files.length > 0 && !input.force) {
        throw new CliError(`目标目录非空: ${targetDir}，可使用 --force 覆盖`);
      }
    }

    await fs.ensureDir(targetDir);
    const variables = await collectVariables(
      template,
      input.projectName,
      input.variables ?? {}
    );
    await renderDirectory(sourceDir, targetDir, variables);
    return targetDir;
  }
}
