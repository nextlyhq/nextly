/**
 * Doctor checks run before the dev server starts. Each check is fast
 * (sub-100ms typical) and returns a structured result so the wrapper
 * can format a single combined error message.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  checkWorkspaceLinks,
  checkEnvFile,
  checkPort,
} from "../../../../scripts/dev-doctor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = resolve(HERE, "..", "..", "..", "..");

describe("doctor.checkWorkspaceLinks", () => {
  it("returns ok when @nextlyhq and @nextlyhq scopes exist as symlinks", async () => {
    const result = await checkWorkspaceLinks(NEXTLY_ROOT);
    expect(result.ok).toBe(true);
  });

  it("returns failure with named missing scope when symlinks are missing", async () => {
    const result = await checkWorkspaceLinks("/tmp/nonexistent-fake-root");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/workspace/i);
    expect(result.fix).toMatch(/pnpm install/);
  });
});

describe("doctor.checkEnvFile", () => {
  it("returns ok when the .env file exists", async () => {
    const tmp = `/tmp/doctor-env-${Date.now()}`;
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(`${tmp}/.env`, "DB_DIALECT=sqlite\n");
    const result = await checkEnvFile(`${tmp}/.env`);
    expect(result.ok).toBe(true);
    await fs.rm(tmp, { recursive: true });
  });

  it("returns failure with copy command when .env is missing", async () => {
    // Use a path that ends in .env so the doctor's path-derivation regex
    // (replace(/\.env$/, ".env.example")) produces a real "cp .env.example .env" hint.
    const result = await checkEnvFile("/tmp/doctor-missing-env-test/.env");
    expect(result.ok).toBe(false);
    expect(result.fix).toMatch(/cp .*\.env\.example .*\.env/);
  });
});

describe("doctor.checkPort", () => {
  it("returns ok when the port is free", async () => {
    const result = await checkPort(34567);
    expect(result.ok).toBe(true);
  });

  it("returns failure with an alternate-port hint when the port is in use", async () => {
    // Use port 0 so the OS picks a free one — avoids cross-test collisions
    // and CI flakes from someone else holding a hardcoded port.
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const result = await checkPort(port);
      expect(result.ok).toBe(false);
      expect(result.fix).toMatch(/PORT=/);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
