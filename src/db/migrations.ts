import { randomUUID } from "node:crypto";
import {
  aiConfigSchema,
  aiProfileSchema,
  aiSettingsSchema,
  appDbSchema,
  templateRecordSchema
} from "./schemas.js";
import type { AiConfig, AiProfile, AiSettings, AppDB, TemplateRecord } from "../types.js";

export const CURRENT_DB_VERSION = 2;

export function createDefaultDb(): AppDB {
  return {
    version: CURRENT_DB_VERSION,
    templates: [],
    ai: {
      activeProfileId: null,
      profiles: []
    }
  };
}

function sanitizeTemplateList(input: unknown): TemplateRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const results: TemplateRecord[] = [];
  for (const item of input) {
    if (
      typeof item === "object" &&
      item !== null &&
      "sourceType" in item &&
      (item as Record<string, unknown>).sourceType === "local"
    ) {
      continue;
    }
    const parsed = templateRecordSchema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    }
  }
  return results;
}

function createAiProfile(config: AiConfig, name: string): AiProfile {
  const now = new Date().toISOString();
  return {
    id: `ai_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    name,
    ...config,
    createdAt: now,
    updatedAt: now
  };
}

function sanitizeAiSettings(input: unknown): AiSettings {
  if (!input) {
    return {
      activeProfileId: null,
      profiles: []
    };
  }

  const parsed = aiConfigSchema.safeParse(input);
  if (parsed.success) {
    const profile = createAiProfile(parsed.data, "default");
    return {
      activeProfileId: profile.id,
      profiles: [profile]
    };
  }

  if (typeof input !== "object" || input === null) {
    return {
      activeProfileId: null,
      profiles: []
    };
  }

  const candidate = input as Record<string, unknown>;
  const profiles: AiProfile[] = [];

  if (Array.isArray(candidate.profiles)) {
    for (const item of candidate.profiles) {
      const profileParsed = aiProfileSchema.safeParse(item);
      if (profileParsed.success) {
        profiles.push(profileParsed.data);
      }
    }
  }

  const activeProfileIdRaw =
    typeof candidate.activeProfileId === "string" ? candidate.activeProfileId : null;
  const activeProfileId =
    activeProfileIdRaw && profiles.some((item) => item.id === activeProfileIdRaw)
      ? activeProfileIdRaw
      : profiles[0]?.id ?? null;

  const settings: AiSettings = {
    activeProfileId,
    profiles
  };

  const settingsParsed = aiSettingsSchema.safeParse(settings);
  if (!settingsParsed.success) {
    return {
      activeProfileId: null,
      profiles: []
    };
  }
  return settingsParsed.data;
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
    ai: sanitizeAiSettings(candidate.ai)
  };

  const parsed = appDbSchema.safeParse(migrated);
  if (!parsed.success) {
    return createDefaultDb();
  }
  return parsed.data;
}
