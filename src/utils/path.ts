import path from "node:path";
import os from "node:os";

export interface ScafkitPaths {
  homeDir: string;
  dbPath: string;
  templatesDir: string;
}

export function getScafkitHome(): string {
  return (
    process.env.SCAFKIT_HOME?.trim() ||
    // Backward compatibility for early internal builds.
    process.env.GCLI_HOME?.trim() ||
    path.join(os.homedir(), ".scafkit")
  );
}

export function getScafkitPaths(): ScafkitPaths {
  const homeDir = getScafkitHome();
  return {
    homeDir,
    dbPath: path.join(homeDir, "db.json"),
    templatesDir: path.join(homeDir, "templates")
  };
}

export function normalizePath(input: string): string {
  return path.resolve(input);
}
