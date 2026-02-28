import { appDbSchema, aiConfigSchema, templateRecordSchema } from "./schemas.js";
import type { AiConfig, AppDB, TemplateRecord } from "../types.js";

export const CURRENT_DB_VERSION = 1;

export function createDefaultDb(): AppDB {
  return {
    version: CURRENT_DB_VERSION,
    templates: [],
    ai: null
  };
}

function sanitizeTemplateList(input: unknown): TemplateRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const results: TemplateRecord[] = [];
  for (const item of input) {
    const parsed = templateRecordSchema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    }
  }
  return results;
}

function sanitizeAiConfig(input: unknown): AiConfig | null {
  if (!input) {
    return null;
  }
  const parsed = aiConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function migrateDb(rawData: unknown): AppDB {
  if (rawData === null || rawData === undefined) {
    return createDefaultDb();
  }

  const candidate =
    typeof rawData === "object" && rawData !== null ? (rawData as Record<string, unknown>) : {};

  const migrated: AppDB = {
    version: CURRENT_DB_VERSION,
    templates: sanitizeTemplateList(candidate.templates),
    ai: sanitizeAiConfig(candidate.ai)
  };

  const parsed = appDbSchema.safeParse(migrated);
  if (!parsed.success) {
    return createDefaultDb();
  }
  return parsed.data;
}
