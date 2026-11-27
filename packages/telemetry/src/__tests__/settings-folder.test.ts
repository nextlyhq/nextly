import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// The `settings-folder` entry exists so a caller can learn the folder without
// loading the usage-data client. If anything in its import graph reached
// posthog-node, this factory would run and the import below would fail.
vi.mock("posthog-node", () => {
  throw new Error("the settings-folder entry must not load posthog-node");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the settings-folder entry", () => {
  it("exports nothing but nextlySettingsFolder", async () => {
    const entry = await import("../settings-folder.js");
    expect(Object.keys(entry)).toEqual(["nextlySettingsFolder"]);
  });

  it("names the platform's config folder for nextly-nodejs", async () => {
    const { nextlySettingsFolder } = await import("../settings-folder.js");
    const base = join(homedir(), "nextly-settings-folder-test");
    // env-paths reads these two at call time, so the answer follows them.
    vi.stubEnv("XDG_CONFIG_HOME", join(base, "xdg"));
    vi.stubEnv("APPDATA", join(base, "appdata"));

    const expected: Record<string, string> = {
      darwin: join(homedir(), "Library", "Preferences", "nextly-nodejs"),
      win32: join(base, "appdata", "nextly-nodejs", "Config"),
    };
    expect(nextlySettingsFolder()).toBe(
      expected[process.platform] ?? join(base, "xdg", "nextly-nodejs")
    );
  });

  it("answers an absolute folder when the environment names a relative one", async () => {
    const { nextlySettingsFolder } = await import("../settings-folder.js");
    // conf resolves its folder against the working directory; so does this.
    vi.stubEnv("XDG_CONFIG_HOME", join("relative", "xdg"));
    vi.stubEnv("APPDATA", join("relative", "appdata"));

    expect(isAbsolute(nextlySettingsFolder())).toBe(true);
  });
});
