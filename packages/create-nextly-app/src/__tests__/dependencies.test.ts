/**
 * Tests for dependency installation.
 *
 * The yalc paths link local `@nextlyhq/*` builds instead of installing them
 * from the registry, so they carry their own package list. Anything the
 * generated project needs from npm has to be installed separately there:
 * `@nextlyhq/ui` declares `lucide-react` as a peer and admin externalises
 * `@tanstack/react-query`, and neither can come from the yalc store, so a yalc
 * install that only runs `yalc add` leaves those peers unresolved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installDependencies } from "../installers/dependencies";
import type { DatabaseConfig, ProjectInfo } from "../types";

const execa = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: "" }));
vi.mock("execa", () => ({ execa }));

const projectInfo = { packageManager: "pnpm" } as ProjectInfo;
const database = { adapter: "@nextlyhq/adapter-postgres" } as DatabaseConfig;

/** Every package name passed to the package manager across all calls. */
function installedFromRegistry(): string[] {
  return execa.mock.calls
    .filter(([cmd]) => cmd === "pnpm")
    .flatMap(([, args]: [string, string[]]) => args)
    .filter(arg => arg !== "add" && arg !== "install");
}

/** Every package handed to `yalc add`. */
function linkedViaYalc(): string[] {
  return execa.mock.calls
    .filter(([cmd]) => cmd === "yalc")
    .map(([, args]: [string, string[]]) => args[1]);
}

describe("installDependencies (existing project)", () => {
  beforeEach(() => {
    execa.mockClear();
  });

  it("installs the registry-only packages when linking with yalc", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      /* useYalc */ true,
      /* isFreshProject */ false
    );

    // These cannot come from the yalc store; without them @nextlyhq/ui's peer
    // is unresolved and its icons fail to resolve.
    expect(installedFromRegistry()).toContain("lucide-react");
    expect(installedFromRegistry()).toContain("@tanstack/react-query");
  });

  it("does not try to yalc-link registry packages", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      true,
      false
    );

    expect(linkedViaYalc()).not.toContain("lucide-react");
    expect(linkedViaYalc()).not.toContain("@tanstack/react-query");
    // The local builds still come from yalc.
    expect(linkedViaYalc()).toContain("@nextlyhq/ui");
  });

  it("installs everything from the registry without yalc", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      false,
      false
    );

    const installed = installedFromRegistry();
    for (const pkg of [
      "nextly",
      "@nextlyhq/admin",
      "@nextlyhq/ui",
      "lucide-react",
      "@tanstack/react-query",
      "@nextlyhq/adapter-postgres",
    ]) {
      expect(installed).toContain(pkg);
    }
    expect(execa.mock.calls.filter(([cmd]) => cmd === "yalc")).toHaveLength(0);
  });
});
