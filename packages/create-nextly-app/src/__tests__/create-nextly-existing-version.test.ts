/**
 * Adding Nextly to an app that already has a Nextly package at another
 * version than this CLI's release.
 *
 * Nextly's packages version in lockstep, so such an app would end with a
 * mixed set, and changing a version it chose is not the CLI's to do. The run
 * stops before it writes or installs anything. The flow runs for real here,
 * the installer and the file generators included, with only the prompts,
 * project detection and the package manager's processes replaced: a check
 * made after any of them would leave a changed file behind.
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execa = vi.hoisted(() => vi.fn(async () => ({ stdout: "" })));
const cancel = vi.hoisted(() => vi.fn());

vi.mock("execa", () => ({ execa }));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel,
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
  confirm: vi.fn(async () => true),
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
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
import { packageVersion } from "../lib/package-version";

let app: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  app = await mkdtemp(path.join(tmpdir(), "nextly-existing-version-"));
  await makeNextApp(app);
});

/** The files project detection and the generators expect of a Next.js app. */
async function makeNextApp(dir: string) {
  await mkdir(path.join(dir, "src/app"), { recursive: true });
  await writeFile(
    path.join(dir, "src/app/layout.tsx"),
    "export default function Layout({ children }) { return children; }\n"
  );
  await writeFile(path.join(dir, "tsconfig.json"), "{}\n");
  await writeFile(path.join(dir, "next.config.ts"), "export default {};\n");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(app, { recursive: true, force: true });
});

/** Every file under the app, by path, with its bytes as text. */
async function tree(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(dir, full)] = await readFile(full, "utf8");
    }
  };
  await walk(dir);
  return files;
}

async function withPackageJson(nextly?: string, dir = app) {
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "app",
        dependencies: { next: "16.0.0", ...(nextly ? { nextly } : {}) },
      },
      null,
      2
    )
  );
}

async function withInstalled(version: string, dir = app) {
  await mkdir(path.join(dir, "node_modules/nextly"), { recursive: true });
  await writeFile(
    path.join(dir, "node_modules/nextly/package.json"),
    JSON.stringify({ name: "nextly", version })
  );
}

const release = packageVersion();
const installs = () =>
  execa.mock.calls.filter(
    ([cmd, args]) => cmd === "pnpm" && (args as string[])[0] === "add"
  );

describe("an existing app with Nextly at another version", () => {
  it.each([
    [
      "installed and declared at another version",
      async () => {
        await withPackageJson("0.0.1");
        await withInstalled("0.0.1");
      },
      /nextly: installed 0\.0\.1, declared 0\.0\.1/,
    ],
    [
      "declared as a range only",
      async () => withPackageJson("^0.0.1"),
      /nextly: declared \^0\.0\.1/,
    ],
    // A range names no one release, so it does not match even with this
    // release installed: the app would declare one thing and get another.
    [
      "declared as a caret range over this release, which is installed",
      async () => {
        await withPackageJson(`^${release}`);
        await withInstalled(release);
      },
      new RegExp(
        `nextly: installed ${release.replace(/\./g, "\\.")}, declared \\^`
      ),
    ],
    // Every field is judged, not only the first that names the package: npm
    // installs an optionalDependencies entry over a dependencies one.
    [
      "declared at this release and, in a later field, at another",
      async () =>
        writeFile(
          path.join(app, "package.json"),
          JSON.stringify({
            name: "app",
            dependencies: { next: "16.0.0", nextly: release },
            optionalDependencies: { nextly: "0.0.1" },
          })
        ),
      /nextly: declared 0\.0\.1/,
    ],
  ])(
    "stops with the app exactly as it was when %s",
    async (_label, arrange, said) => {
      await arrange();
      const before = await tree(app);

      await expect(createNextly({ cwd: app, defaults: true })).rejects.toThrow(
        "process.exit(1)"
      );

      expect(await tree(app)).toEqual(before);
      expect(installs()).toEqual([]);
      const message = String(cancel.mock.calls[0]?.[0]);
      expect(message).toMatch(said);
      expect(message).toContain("Nothing was changed");
      expect(message).toContain(`pnpm add --save-exact nextly@${release}`);
    }
  );
});

describe("an app in a workspace that hoists its dependencies", () => {
  // Node loads the first node_modules/nextly in the app or a folder above, so
  // an app with none of its own runs the workspace's. Declaring this release
  // does not change what it runs, and with --skip-install nothing would.
  it("stops when the nextly it loads from a folder above is another version", async () => {
    const web = path.join(app, "apps/web");
    await makeNextApp(web);
    await withPackageJson(release, web);
    await withInstalled("0.0.1", app);
    const before = await tree(app);

    await expect(
      createNextly({ cwd: web, defaults: true, skipInstall: true })
    ).rejects.toThrow("process.exit(1)");

    expect(await tree(app)).toEqual(before);
    expect(String(cancel.mock.calls[0]?.[0])).toMatch(
      new RegExp(
        `nextly: installed 0\\.0\\.1, declared ${release.replace(/\./g, "\\.")}`
      )
    );
  });
});

describe("an existing app with no Nextly package", () => {
  it("adds Nextly's packages at exactly this release", async () => {
    await withPackageJson();

    await createNextly({ cwd: app, defaults: true });

    expect(installs()).toContainEqual([
      "pnpm",
      expect.arrayContaining(["add", "--save-exact", `nextly@${release}`]),
      expect.anything(),
    ]);
  });
});
