/**
 * Adding Nextly to an existing app reads every template it writes from before
 * it installs or writes anything. A template folder that cannot supply them
 * (a wrong or incomplete --local-template) stops the run with the app exactly
 * as it was, naming the missing file, so a retry starts clean. The flow runs
 * for real with the prompts and the install replaced, against a real app
 * folder.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({ cancel: vi.fn() }));
const install = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: prompts.cancel,
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
vi.mock("../installers/dependencies", () => ({ installDependencies: install }));
vi.mock("../utils/detect", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/detect")>()),
  detectProject: vi.fn(async () => ({
    isNextJs: true,
    isAppRouter: true,
    hasTypescript: true,
    packageManager: "pnpm",
    nextVersion: "16.0.0",
    srcDir: true,
    appDir: "src/app",
  })),
}));

import { createNextly } from "../create-nextly";

const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  dir = await mkdtemp(path.join(tmpdir(), "nextly-templates-first-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Every file under `folder` with its text, so "unchanged" compares contents, not only names. */
async function snapshot(folder: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    found[path.relative(folder, file)] = await readFile(file, "utf8");
  }
  return found;
}

/** An App Router app with a page, a layout and its package.json. */
async function existingApp(): Promise<string> {
  const app = path.join(dir, "app");
  await mkdir(path.join(app, "src/app"), { recursive: true });
  // A supported Next.js, so the run gets past the framework version check.
  await writeFile(
    path.join(app, "package.json"),
    JSON.stringify({ dependencies: { next: "16.4.2" } })
  );
  await writeFile(
    path.join(app, "src/app/page.tsx"),
    "export default function Page() { return null; }\n"
  );
  return app;
}

/** A template folder holding only the health route of the three the existing-app path writes. */
async function incompleteTemplates(): Promise<string> {
  const templates = path.join(dir, "templates");
  const health = "base/src/app/api/health/route.ts";
  await mkdir(path.dirname(path.join(templates, health)), { recursive: true });
  await writeFile(
    path.join(templates, health),
    await readFile(path.join(TEMPLATES, health), "utf8")
  );
  return templates;
}

describe("adding Nextly to an app from templates that cannot supply its routes", () => {
  it("stops before installing or writing anything, naming the missing file", async () => {
    const app = await existingApp();
    const before = await snapshot(app);

    await expect(
      createNextly({
        cwd: app,
        defaults: true,
        database: "sqlite",
        skills: false,
        localTemplatePath: await incompleteTemplates(),
      })
    ).rejects.toThrow("process.exit(1)");

    expect(install).not.toHaveBeenCalled();
    expect(await snapshot(app)).toEqual(before);
    const said = prompts.cancel.mock.calls.map(([message]) => String(message));
    expect(said).toEqual([
      expect.stringContaining(
        "no readable base/src/app/admin/api/media/[[...path]]/route.ts"
      ),
    ]);
  });

  it("stops the same way when the --local-template folder does not exist", async () => {
    const app = await existingApp();
    const before = await snapshot(app);

    await expect(
      createNextly({
        cwd: app,
        defaults: true,
        database: "sqlite",
        skills: false,
        localTemplatePath: path.join(dir, "no-such-templates"),
      })
    ).rejects.toThrow("process.exit(1)");

    expect(install).not.toHaveBeenCalled();
    expect(await snapshot(app)).toEqual(before);
    expect(String(prompts.cancel.mock.calls[0]?.[0])).toContain(
      "Local templates directory not found"
    );
  });
});
