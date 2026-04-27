// Tests for the jiti-based wrapper config loader.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadNextlyConfig, resolveConfigPath } from "./config-loader.js";

describe("config-loader", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "nextly-cfg-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("resolves nextly.config.ts at project root", async () => {
    await writeFile(
      join(tmpRoot, "nextly.config.ts"),
      "export default { collections: [] };"
    );
    const resolved = await resolveConfigPath(tmpRoot);
    expect(resolved).toContain("nextly.config.ts");
  });

  it("falls back to src/nextly.config.ts when root is missing", async () => {
    const srcDir = join(tmpRoot, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "nextly.config.ts"),
      "export default { collections: [] };"
    );
    const resolved = await resolveConfigPath(tmpRoot);
    expect(resolved).toContain(join("src", "nextly.config.ts"));
  });

  it("throws a descriptive error listing candidates when no config exists", async () => {
    await expect(resolveConfigPath(tmpRoot)).rejects.toThrow(
      /No nextly config found/
    );
    await expect(resolveConfigPath(tmpRoot)).rejects.toThrow(
      /nextly\.config\.ts/
    );
  });

  it("loads a TypeScript config and returns parsed config + path + hash", async () => {
    await writeFile(
      join(tmpRoot, "nextly.config.ts"),
      `export default { collections: [{ slug: "posts", fields: [] }] };`
    );
    const result = await loadNextlyConfig(tmpRoot);
    expect(
      (result.config as unknown as { collections: unknown[] }).collections
    ).toHaveLength(1);
    expect(result.configPath).toContain("nextly.config.ts");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces identical hashes for identical content", async () => {
    await writeFile(
      join(tmpRoot, "nextly.config.ts"),
      "export default { collections: [] };"
    );
    const first = await loadNextlyConfig(tmpRoot);
    const second = await loadNextlyConfig(tmpRoot);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("produces different hashes when content changes", async () => {
    const file = join(tmpRoot, "nextly.config.ts");
    await writeFile(file, "export default { collections: [] };");
    const first = await loadNextlyConfig(tmpRoot);
    await writeFile(
      file,
      "export default { collections: [{ slug: 'posts', fields: [] }] };"
    );
    const second = await loadNextlyConfig(tmpRoot);
    expect(first.contentHash).not.toBe(second.contentHash);
  });
});
