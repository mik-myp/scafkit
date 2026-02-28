import { describe, expect, it } from "vitest";
import { CURRENT_DB_VERSION, createDefaultDb, migrateDb } from "../../src/db/migrations.js";

describe("db migrations", () => {
  it("returns default db when input is undefined", () => {
    const db = migrateDb(undefined);
    expect(db).toEqual(createDefaultDb());
  });

  it("drops local templates and keeps valid git records", () => {
    const db = migrateDb({
      version: 0,
      templates: [
        {
          id: "tpl_local",
          name: "local",
          sourceType: "local",
          source: "/tmp/a",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "tpl_git",
          name: "git-template",
          sourceType: "git",
          source: "https://github.com/openai/scafkit.git",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "",
          name: "",
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
    expect(db.templates[0]?.id).toBe("tpl_git");

    expect(db.ai.profiles).toHaveLength(1);
    expect(db.ai.activeProfileId).toBe(db.ai.profiles[0]?.id);
    expect(db.ai.profiles[0]?.model).toBe("gpt-4o-mini");
  });
});
