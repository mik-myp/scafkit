export type TemplateSourceType = "local" | "git";

export interface TemplateVariable {
  key: string;
  required: boolean;
  defaultValue?: string;
  desc?: string;
}

export interface TemplateRecord {
  id: string;
  name: string;
  description?: string;
  sourceType: TemplateSourceType;
  source: string;
  branch?: string;
  subPath?: string;
  variables?: TemplateVariable[];
  createdAt: string;
  updatedAt: string;
}

export interface AiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface AppDB {
  version: number;
  templates: TemplateRecord[];
  ai: AiConfig | null;
}

export interface CommitSuggestion {
  type: string;
  scope?: string;
  subject: string;
  body?: string;
}

export interface ReviewResult {
  summary: string;
  riskItems: string[];
  testSuggestions: string[];
  commitSuggestion: CommitSuggestion;
}
