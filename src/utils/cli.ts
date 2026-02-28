import { CliError } from "./errors.js";

export function parseKeyValuePairs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const item of values) {
    const idx = item.indexOf("=");
    if (idx <= 0) {
      throw new CliError(`无效变量格式: ${item}，应为 key=value`);
    }
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    if (!key) {
      throw new CliError(`无效变量 key: ${item}`);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function parseJsonArrayOption<T>(input: string | undefined, fieldName: string): T[] | undefined {
  if (!input) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) {
      throw new Error("not array");
    }
    return parsed as T[];
  } catch {
    throw new CliError(`${fieldName} 需要合法 JSON 数组字符串`);
  }
}
