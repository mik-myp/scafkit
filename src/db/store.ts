import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs-extra";
import { createDefaultDb, migrateDb } from "./migrations.js";
import type { AppDB } from "../types.js";
import { getScafkitPaths } from "../utils/path.js";

let dbInstance: Low<AppDB> | null = null;

async function safeRead(db: Low<AppDB>): Promise<void> {
  try {
    await db.read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isJsonParseError =
      message.includes("Unexpected end of JSON input") ||
      message.includes("Unexpected token") ||
      message.includes("JSON");
    if (!isJsonParseError) {
      throw error;
    }
    db.data = createDefaultDb();
    await db.write();
  }
}

async function initDb(): Promise<Low<AppDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  const paths = getScafkitPaths();
  await fs.ensureDir(paths.homeDir);
  await fs.ensureDir(paths.templatesDir);
  await fs.ensureFile(paths.dbPath);

  const adapter = new JSONFile<AppDB>(paths.dbPath);
  const db = new Low<AppDB>(adapter, createDefaultDb());
  await safeRead(db);
  db.data = migrateDb(db.data);
  await db.write();
  dbInstance = db;
  return db;
}

export async function readDb(): Promise<AppDB> {
  const db = await initDb();
  await safeRead(db);
  db.data = migrateDb(db.data);
  return structuredClone(db.data);
}

export async function writeDb(mutator: (data: AppDB) => void): Promise<AppDB> {
  const db = await initDb();
  await safeRead(db);
  db.data = migrateDb(db.data);
  mutator(db.data);
  await db.write();
  return structuredClone(db.data);
}

export function resetDbForTests(): void {
  dbInstance = null;
}
