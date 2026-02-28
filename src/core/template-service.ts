import path from "node:path";
import fs from "fs-extra";
import { simpleGit } from "simple-git";
import { randomUUID } from "node:crypto";
import { readDb, writeDb } from "../db/store.js";
import type { TemplateRecord, TemplateSourceType, TemplateVariable } from "../types.js";
import { CliError } from "../utils/errors.js";
import { getScafkitPaths, normalizePath } from "../utils/path.js";

export interface AddTemplateInput {
  id?: string;
  name: string;
  description?: string;
  sourceType: TemplateSourceType;
  source: string;
  branch?: string;
  subPath?: string;
  variables?: TemplateVariable[];
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  source?: string;
  branch?: string;
  subPath?: string;
  variables?: TemplateVariable[];
}

function createTemplateId(): string {
  return `tpl_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function ensureLocalTemplateExists(source: string): Promise<void> {
  const resolved = normalizePath(source);
  const exists = await fs.pathExists(resolved);
  if (!exists) {
    throw new CliError(`本地模板路径不存在: ${resolved}`);
  }
}

function getTemplateCacheDir(templateId: string): string {
  return path.join(getScafkitPaths().templatesDir, templateId);
}

async function cloneGitTemplate(source: string, branch: string | undefined, targetDir: string): Promise<void> {
  await fs.ensureDir(path.dirname(targetDir));
  const git = simpleGit();
  const options = branch ? ["--branch", branch, "--single-branch"] : [];
  await git.clone(source, targetDir, options);
}

export class TemplateService {
  async listTemplates(): Promise<TemplateRecord[]> {
    const db = await readDb();
    return db.templates;
  }

  async getTemplateById(id: string): Promise<TemplateRecord> {
    const db = await readDb();
    const template = db.templates.find((item) => item.id === id);
    if (!template) {
      throw new CliError(`未找到模板: ${id}`);
    }
    return template;
  }

  async addTemplate(input: AddTemplateInput): Promise<TemplateRecord> {
    if (input.sourceType !== "local" && input.sourceType !== "git") {
      throw new CliError(`不支持的模板来源类型: ${String(input.sourceType)}`);
    }
    if (input.sourceType === "local") {
      await ensureLocalTemplateExists(input.source);
    }

    const now = new Date().toISOString();
    const record: TemplateRecord = {
      id: input.id || createTemplateId(),
      name: input.name,
      description: input.description,
      sourceType: input.sourceType,
      source: input.sourceType === "local" ? normalizePath(input.source) : input.source,
      branch: input.branch,
      subPath: input.subPath,
      variables: input.variables,
      createdAt: now,
      updatedAt: now
    };

    const db = await writeDb((draft) => {
      const hasId = draft.templates.some((item) => item.id === record.id);
      if (hasId) {
        throw new CliError(`模板 ID 已存在: ${record.id}`);
      }
      const hasName = draft.templates.some((item) => item.name === record.name);
      if (hasName) {
        throw new CliError(`模板名称已存在: ${record.name}`);
      }
      draft.templates.push(record);
    });

    const created = db.templates.find((item) => item.id === record.id);
    if (!created) {
      throw new CliError("模板创建失败");
    }

    if (record.sourceType === "git") {
      try {
        await this.syncTemplate(record.id);
      } catch (error) {
        await writeDb((draft) => {
          draft.templates = draft.templates.filter((item) => item.id !== record.id);
        });
        throw error;
      }
    }

    return created;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<TemplateRecord> {
    const current = await this.getTemplateById(id);
    const updatedSource = input.source ?? current.source;
    if (current.sourceType === "local" && input.source) {
      await ensureLocalTemplateExists(updatedSource);
    }

    const db = await writeDb((draft) => {
      const index = draft.templates.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new CliError(`未找到模板: ${id}`);
      }
      if (input.name) {
        const conflict = draft.templates.some((item, i) => i !== index && item.name === input.name);
        if (conflict) {
          throw new CliError(`模板名称已存在: ${input.name}`);
        }
      }
      draft.templates[index] = {
        ...draft.templates[index],
        name: input.name ?? draft.templates[index].name,
        description: input.description ?? draft.templates[index].description,
        source:
          draft.templates[index].sourceType === "local"
            ? normalizePath(updatedSource)
            : updatedSource,
        branch: input.branch ?? draft.templates[index].branch,
        subPath: input.subPath ?? draft.templates[index].subPath,
        variables: input.variables ?? draft.templates[index].variables,
        updatedAt: new Date().toISOString()
      };
    });

    const result = db.templates.find((item) => item.id === id);
    if (!result) {
      throw new CliError("模板更新失败");
    }

    if (result.sourceType === "git") {
      await this.syncTemplate(result.id);
    }

    return result;
  }

  async removeTemplate(id: string): Promise<void> {
    const template = await this.getTemplateById(id);
    await writeDb((draft) => {
      draft.templates = draft.templates.filter((item) => item.id !== id);
    });
    if (template.sourceType === "git") {
      await fs.remove(getTemplateCacheDir(id));
    }
  }

  async syncTemplate(id: string): Promise<void> {
    const template = await this.getTemplateById(id);
    if (template.sourceType !== "git") {
      return;
    }

    const finalDir = getTemplateCacheDir(id);
    const tempDir = `${finalDir}.tmp.${Date.now()}`;

    await fs.remove(tempDir);
    try {
      await cloneGitTemplate(template.source, template.branch, tempDir);
      if (template.subPath) {
        const subDir = path.join(tempDir, template.subPath);
        if (!(await fs.pathExists(subDir))) {
          throw new CliError(`模板 subPath 不存在: ${template.subPath}`);
        }
      }
      await fs.remove(finalDir);
      await fs.move(tempDir, finalDir);
    } catch (error) {
      await fs.remove(tempDir);
      throw error;
    }
  }

  async resolveTemplateDir(id: string): Promise<string> {
    const template = await this.getTemplateById(id);
    let baseDir: string;
    if (template.sourceType === "local") {
      baseDir = normalizePath(template.source);
    } else {
      baseDir = getTemplateCacheDir(template.id);
      if (!(await fs.pathExists(baseDir))) {
        await this.syncTemplate(template.id);
      }
    }
    const resolvedDir = template.subPath ? path.join(baseDir, template.subPath) : baseDir;
    const exists = await fs.pathExists(resolvedDir);
    if (!exists) {
      throw new CliError(`模板目录不存在: ${resolvedDir}`);
    }
    return resolvedDir;
  }
}
