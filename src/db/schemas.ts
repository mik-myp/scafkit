import { z } from "zod";

export const templateVariableSchema = z.object({
  key: z.string().min(1),
  required: z.boolean(),
  defaultValue: z.string().optional(),
  desc: z.string().optional()
});

export const templateRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.string().min(1),
  branch: z.string().optional(),
  subPath: z.string().optional(),
  variables: z.array(templateVariableSchema).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const aiConfigSchema = z.object({
  baseURL: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  timeoutMs: z.number().int().positive()
});

export const aiProfileSchema = aiConfigSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const aiSettingsSchema = z.object({
  activeProfileId: z.string().min(1).nullable(),
  profiles: z.array(aiProfileSchema)
});

export const appDbSchema = z.object({
  version: z.number().int().nonnegative(),
  templates: z.array(templateRecordSchema),
  ai: aiSettingsSchema
});
