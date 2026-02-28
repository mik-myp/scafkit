import path from "node:path";
import fs from "fs-extra";
import { simpleGit } from "simple-git";
import { randomUUID } from "node:crypto";
import { readDb, writeDb } from "../db/store.js";
import type { TemplateRecord, TemplateVariable } from "../types.js";
import { asErrorMessage, CliError } from "../utils/errors.js";
import { getScafkitPaths } from "../utils/path.js";
import { buildTemplateGitSourceCandidates, normalizeTemplateGitSource } from "../utils/git-source.js";

export interface AddTemplateInput {
  id?: string;
  name: string;
  description?: string;
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

function getTemplateCacheDir(templateId: string): string {
  return path.join(getScafkitPaths().templatesDir, templateId);
}

async function cloneGitTemplate(
  sourceCandidates: string[],
  branch: string | undefined,
  targetDir: string
): Promise<string> {
  await fs.ensureDir(path.dirname(targetDir));
  const options = branch ? ["--branch", branch, "--single-branch"] : [];
  const errors: string[] = [];

  for (const source of sourceCandidates) {
    await fs.remove(targetDir);
    try {
      await simpleGit().clone(source, targetDir, options);
      return source;
    } catch (error) {
      errors.push(`${source}: ${asErrorMessage(error)}`);
    }
  }

  throw new CliError(`模板仓库同步失败，已尝试:\n${errors.join("\n")}`);
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
    const normalizedSource = normalizeTemplateGitSource(input.source);
    const now = new Date().toISOString();
    const record: TemplateRecord = {
      id: input.id || createTemplateId(),
      name: input.name,
      description: input.description,
      source: normalizedSource,
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

    try {
      await this.syncTemplate(record.id);
    } catch (error) {
      await writeDb((draft) => {
        draft.templates = draft.templates.filter((item) => item.id !== record.id);
      });
      throw error;
    }

    return created;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<TemplateRecord> {
    const current = await this.getTemplateById(id);
    const updatedSource = input.source ?? current.source;
    const normalizedSource = normalizeTemplateGitSource(updatedSource);

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
        source: normalizedSource,
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

    await this.syncTemplate(result.id);
    return result;
  }

  async removeTemplate(id: string): Promise<void> {
    await this.getTemplateById(id);
    await writeDb((draft) => {
      draft.templates = draft.templates.filter((item) => item.id !== id);
    });
    await fs.remove(getTemplateCacheDir(id));
  }

  async syncTemplate(id: string): Promise<void> {
    const template = await this.getTemplateById(id);
    const finalDir = getTemplateCacheDir(id);
    const tempDir = `${finalDir}.tmp.${Date.now()}`;
    const sourceCandidates = buildTemplateGitSourceCandidates(template.source);

    await fs.remove(tempDir);
    try {
      const usedSource = await cloneGitTemplate(sourceCandidates, template.branch, tempDir);
      if (template.subPath) {
        const subDir = path.join(tempDir, template.subPath);
        if (!(await fs.pathExists(subDir))) {
          throw new CliError(`模板 subPath 不存在: ${template.subPath}`);
        }
      }
      await fs.remove(finalDir);
      await fs.move(tempDir, finalDir);

      if (usedSource !== template.source) {
        await writeDb((draft) => {
          const index = draft.templates.findIndex((item) => item.id === id);
          if (index === -1) {
            return;
          }
          draft.templates[index] = {
            ...draft.templates[index],
            source: usedSource,
            updatedAt: new Date().toISOString()
          };
        });
      }
    } catch (error) {
      await fs.remove(tempDir);
      throw error;
    }
  }

  async resolveTemplateDir(id: string): Promise<string> {
    const template = await this.getTemplateById(id);
    const baseDir = getTemplateCacheDir(template.id);
    if (!(await fs.pathExists(baseDir))) {
      await this.syncTemplate(template.id);
    }

    const resolvedDir = template.subPath ? path.join(baseDir, template.subPath) : baseDir;
    const exists = await fs.pathExists(resolvedDir);
    if (!exists) {
      throw new CliError(`模板目录不存在: ${resolvedDir}`);
    }
    return resolvedDir;
  }
}
