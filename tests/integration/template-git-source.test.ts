import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../src/db/store.js";
import { TemplateService } from "../../src/core/template-service.js";

class NoSyncTemplateService extends TemplateService {
  override async syncTemplate(_id: string): Promise<void> {
    return;
  }
}

describe("template service git source", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scafkit-git-source-"));
    process.env.SCAFKIT_HOME = path.join(tempRoot, ".scafkit");
    resetDbForTests();
  });

  afterEach(async () => {
    resetDbForTests();
    delete process.env.SCAFKIT_HOME;
    if (tempRoot) {
      await fs.remove(tempRoot);
    }
  });

  it("normalizes github https source on add", async () => {
    const service = new NoSyncTemplateService();
    const result = await service.addTemplate({
      name: "gh-https-template",
      sourceType: "git",
      source: "https://github.com/openai/scafkit"
    });

    expect(result.source).toBe("https://github.com/openai/scafkit.git");
  });

  it("normalizes gitlab ssh source on add", async () => {
    const service = new NoSyncTemplateService();
    const result = await service.addTemplate({
      name: "gl-ssh-template",
      sourceType: "git",
      source: "git@gitlab.com:group/subgroup/template"
    });

    expect(result.source).toBe("git@gitlab.com:group/subgroup/template.git");
  });
});
