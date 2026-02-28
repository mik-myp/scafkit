import { describe, expect, it } from "vitest";
import { CURRENT_DB_VERSION, createDefaultDb, migrateDb } from "../../src/db/migrations.js";

describe("db migrations", () => {
  it("returns default db when input is undefined", () => {
    const db = migrateDb(undefined);
    expect(db).toEqual(createDefaultDb());
  });

  it("keeps valid records and drops invalid ones", () => {
    const db = migrateDb({
      version: 0,
      templates: [
        {
          id: "tpl_1",
          name: "ok",
          sourceType: "local",
          source: "/tmp/a",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "",
          name: "",
          sourceType: "invalid",
          source: ""
        }
      ],
      ai: {
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-4o-mini",
        timeoutMs: 15000
      }
    });

    expect(db.version).toBe(CURRENT_DB_VERSION);
    expect(db.templates).toHaveLength(1);
    expect(db.ai?.model).toBe("gpt-4o-mini");
  });
});
