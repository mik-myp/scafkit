import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../../src/db/store.js";
import { AiService } from "../../src/core/ai-service.js";

describe("ai service config lifecycle", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scafkit-ai-config-"));
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

  it("removes active profile and switches to remaining profile", async () => {
    const service = new AiService();
    const defaultProfile = await service.setConfig({
      profileName: "default",
      apiKey: "sk-default"
    });
    const backupProfile = await service.setConfig({
      profileName: "backup",
      apiKey: "sk-backup"
    });

    const result = await service.removeConfig("backup");
    expect(result.removed.id).toBe(backupProfile.id);
    expect(result.active?.id).toBe(defaultProfile.id);

    const active = await service.getActiveProfile();
    expect(active?.id).toBe(defaultProfile.id);

    const profiles = await service.getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.id).toBe(defaultProfile.id);
  });

  it("removes last profile and clears active profile", async () => {
    const service = new AiService();
    const profile = await service.setConfig({
      profileName: "solo",
      apiKey: "sk-solo"
    });

    const result = await service.removeConfig(profile.id);
    expect(result.removed.id).toBe(profile.id);
    expect(result.active).toBeNull();
    expect(await service.getActiveProfile()).toBeNull();
    expect(await service.getProfiles()).toHaveLength(0);
  });

  it("throws when removing missing profile", async () => {
    const service = new AiService();
    await expect(service.removeConfig("missing")).rejects.toThrow(
      "未找到 AI 配置: missing"
    );
  });
});
