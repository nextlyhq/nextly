/**
 * Adding Nextly to an existing app whose Next.js, React or React DOM is
 * outside the ranges this release supports.
 *
 * Nextly is built and tested against one Next.js major and one React major, so
 * an app below the floor or on a newer major would install and then fail at
 * build or at run time. The run stops before it writes or installs anything,
 * naming the version it found, the supported range and what to change. The
 * flow runs for real, the installer and the file generators included, with
 * only the prompts, telemetry and the package manager's processes replaced: a
 * check made after any write would leave a changed file behind.
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

import { createNextly } from "../create-nextly";

const IN_RANGE = { next: "16.4.2", react: "19.3.1", "react-dom": "19.3.1" };

let app: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  app = await mkdtemp(path.join(tmpdir(), "nextly-framework-versions-"));
  await mkdir(path.join(app, "src/app"), { recursive: true });
  await writeFile(
    path.join(app, "src/app/layout.tsx"),
    "export default function Layout({ children }) { return children; }\n"
  );
  await writeFile(path.join(app, "tsconfig.json"), "{}\n");
  await writeFile(path.join(app, "next.config.ts"), "export default {};\n");
  // The lockfile names the package manager, so the command in the message
  // does not depend on what launched the test run.
  await writeFile(path.join(app, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
});

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

async function declare(deps: Record<string, string>) {
  await writeFile(
    path.join(app, "package.json"),
    JSON.stringify({ name: "app", dependencies: deps }, null, 2)
  );
}

async function install(versions: Record<string, string>) {
  for (const [name, version] of Object.entries(versions)) {
    await mkdir(path.join(app, "node_modules", name), { recursive: true });
    await writeFile(
      path.join(app, "node_modules", name, "package.json"),
      JSON.stringify({ name, version })
    );
  }
}

const installs = () =>
  execa.mock.calls.filter(
    ([cmd, args]) => cmd === "pnpm" && (args as string[])[0] === "add"
  );

/** Run the flow on an app that should be refused, and return what it said. */
async function refusal(): Promise<string> {
  const before = await tree(app);
  await expect(
    createNextly({ cwd: app, defaults: true, skills: false })
  ).rejects.toThrow("process.exit(1)");
  // Nothing written and nothing installed: the app is exactly as it was.
  expect(await tree(app)).toEqual(before);
  expect(installs()).toEqual([]);
  expect(cancel).toHaveBeenCalledTimes(1);
  const message = String(cancel.mock.calls[0]?.[0]);
  expect(message).toContain("Nothing was changed");
  return message;
}

describe("an existing app below the supported versions", () => {
  it("stops on Next.js 15, naming the version, the range and the codemod", async () => {
    const installed = { ...IN_RANGE, next: "15.5.2" };
    await declare({ ...installed, next: "^15.5.2" });
    await install(installed);

    const message = await refusal();

    expect(message).toMatch(/next: installed 15\.5\.2/);
    expect(message).toContain("^16.4.1");
    expect(message).toContain("npx @next/codemod@latest upgrade 16.4.2");
    expect(message).not.toMatch(/react(-dom)?: installed/);
  });

  it.each(["react", "react-dom"])(
    "stops on %s 18, naming the version, the range and the install command",
    async name => {
      const installed = { ...IN_RANGE, [name]: "18.3.1" };
      await declare(installed);
      await install(installed);

      const message = await refusal();

      expect(message).toContain(`${name}: installed 18.3.1`);
      expect(message).toContain("^19.3.0");
      expect(message).toContain("pnpm add react@^19.3.0 react-dom@^19.3.0");
      expect(message).not.toMatch(/next: installed/);
    }
  );

  // Not installed yet: the lowest version the app's range admits is what an
  // install could resolve to, so that is what is judged.
  it("judges the lowest declared version when nothing is installed", async () => {
    await declare({ ...IN_RANGE, next: "^15.5.2" });

    const message = await refusal();

    expect(message).toMatch(/next: declared \^15\.5\.2/);
    expect(message).toContain("^16.4.1");
  });
});

describe("an existing app above the supported versions", () => {
  it("stops on Next.js 17, saying this release supports up to 16.x", async () => {
    const installed = { ...IN_RANGE, next: "17.0.0" };
    await declare(installed);
    await install(installed);

    const message = await refusal();

    expect(message).toContain("next: installed 17.0.0");
    expect(message).toContain("^16.4.1");
    expect(message).toContain("16.x");
    expect(message).toContain("pnpm add next@16");
    expect(message).toMatch(/wait for a Nextly release/);
  });

  it.each(["react", "react-dom"])(
    "stops on %s 20, saying this release supports up to 19.x",
    async name => {
      const installed = { ...IN_RANGE, [name]: "20.0.0" };
      await declare(installed);
      await install(installed);

      const message = await refusal();

      expect(message).toContain(`${name}: installed 20.0.0`);
      expect(message).toContain("^19.3.0");
      expect(message).toContain("19.x");
      expect(message).toContain("pnpm add react@19 react-dom@19");
    }
  );
});

describe("an existing app on the supported versions", () => {
  it("proceeds and installs Nextly", async () => {
    await declare(IN_RANGE);
    await install(IN_RANGE);

    await createNextly({ cwd: app, defaults: true, skills: false });

    expect(cancel).not.toHaveBeenCalled();
    expect(installs().length).toBeGreaterThan(0);
  });

  // A package the app neither declares nor has installed is not judged: the
  // install that follows adds what Nextly needs.
  it("proceeds when React DOM is neither declared nor installed", async () => {
    const rest = Object.fromEntries(
      Object.entries(IN_RANGE).filter(([name]) => name !== "react-dom")
    );
    await declare(rest);
    await install(rest);

    await createNextly({ cwd: app, defaults: true, skills: false });

    expect(cancel).not.toHaveBeenCalled();
    expect(installs().length).toBeGreaterThan(0);
  });
});
