import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../src/db/store.js";
import { TemplateService } from "../../src/core/template-service.js";
import { ProjectGenerator } from "../../src/core/project-generator.js";

describe("template service + project generator", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scafkit-test-"));
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

  it("creates project from local template and renders variables", async () => {
    const templateDir = path.join(tempRoot, "template-local");
    await fs.ensureDir(templateDir);
    await fs.writeFile(
      path.join(templateDir, "README.md.ejs"),
      "# <%= projectName %>\nowner=<%= owner %>\n",
      "utf-8"
    );

    const service = new TemplateService();
    const template = await service.addTemplate({
      name: "local-template",
      sourceType: "local",
      source: templateDir,
      variables: [{ key: "owner", required: true }]
    });

    const generator = new ProjectGenerator(service);
    const outputRoot = path.join(tempRoot, "output");
    const outputDir = await generator.generate({
      projectName: "demo-app",
      templateId: template.id,
      dest: outputRoot,
      variables: { owner: "kirito" }
    });

    expect(outputDir).toBe(path.join(outputRoot, "demo-app"));
    const readme = await fs.readFile(path.join(outputDir, "README.md"), "utf-8");
    expect(readme).toContain("# demo-app");
    expect(readme).toContain("owner=kirito");
  });
});
