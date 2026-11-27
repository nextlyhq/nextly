/**
 * Where the command line keeps a sign-in: the system keychain, keyed by the
 * site's sign-in issuer; without one, a file only the person can read in
 * their own settings folder, with a warning. Never inside the project.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openSignInStore,
  tokenHint,
  type KeychainBinding,
  type StoredSignIn,
} from "../index";

const signIn: StoredSignIn = {
  site: "https://site.example",
  issuer: "https://site.example",
  credentialId: "ncc_0123456789abcdef0123456789abcdef",
  accessToken: "header.payload.signature-of-the-access-token",
  accessTokenExpiresAt: "2026-11-27T10:15:00.000Z",
  refreshToken: "nxcli_ncc_0123456789abcdef0123456789abcdef.0.random.tag",
  signInEndsAt: "2027-02-25T10:00:00.000Z",
};

/** A keychain held in memory, recording how each entry was opened. */
function memoryKeychain() {
  const items = new Map<string, string>();
  const opened: Array<{ service: string; account: string; options: unknown }> =
    [];
  const binding: KeychainBinding = {
    AsyncEntry: class {
      private readonly key: string;
      constructor(service: string, account: string, options?: unknown) {
        opened.push({ service, account, options });
        this.key = `${service}\u0000${account}`;
      }
      async getPassword() {
        return items.get(this.key) ?? null;
      }
      async setPassword(value: string) {
        items.set(this.key, value);
      }
      async deletePassword() {
        return items.delete(this.key);
      }
    },
  };
  return { items, opened, binding };
}

let home: string;
let project: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nextly-settings-"));
  project = mkdtempSync(join(tmpdir(), "nextly-project-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("with a system keychain", () => {
  it("keeps the sign-in there, keyed by the site's sign-in issuer, and writes no file", async () => {
    const keychain = memoryKeychain();
    const { store, warning } = await openSignInStore({
      loadBinding: async () => keychain.binding,
      settingsFolder: home,
      projectFolder: project,
    });

    expect(store.kind).toBe("keychain");
    expect(warning).toBeNull();
    await store.write(signIn);
    expect(await store.read("https://site.example")).toEqual(signIn);
    expect(keychain.opened.at(-1)).toMatchObject({
      service: "nextly",
      account: "https://site.example",
    });
    expect(() => statSync(join(home, "cli-sign-ins.json"))).toThrow();

    expect(await store.remove("https://site.example")).toBe(true);
    expect(await store.read("https://site.example")).toBeNull();
  });

  it("asks Linux for its Secret Service, never the kernel keyring that forgets at reboot", async () => {
    const keychain = memoryKeychain();
    await openSignInStore({
      loadBinding: async () => keychain.binding,
      settingsFolder: home,
      projectFolder: project,
    });
    expect(keychain.opened[0]?.options).toEqual({
      linux: { store: "secret-service" },
    });
  });
});

describe("without a system keychain", () => {
  const cases: Array<[string, () => Promise<KeychainBinding>]> = [
    [
      "the binding will not load (no prebuilt binary for this system)",
      async () => {
        throw new Error("Cannot find module '@napi-rs/keyring-linux-x64-gnu'");
      },
    ],
    [
      "the keychain cannot be reached (a Linux container with no Secret Service)",
      async () => ({
        AsyncEntry: class {
          async getPassword(): Promise<string | null> {
            throw new Error("Platform secure storage failure");
          }
          async setPassword() {}
          async deletePassword() {
            return false;
          }
        },
      }),
    ],
  ];

  it.each(cases)(
    "when %s, keeps it in a file only the person can read, and warns where",
    async (_case, loadBinding) => {
      const { store, warning } = await openSignInStore({
        loadBinding,
        settingsFolder: home,
        projectFolder: project,
      });

      expect(store.kind).toBe("file");
      const file = join(home, "cli-sign-ins.json");
      expect(store.location).toBe(file);
      expect(warning).toContain(file);
      expect(warning).toMatch(/no system keychain/i);

      await store.write(signIn);
      // Checked before any read, which would tighten a wider file itself.
      if (process.platform !== "win32") {
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(home).mode & 0o077).toBe(0);
      }
      expect(await store.read("https://site.example")).toEqual(signIn);
      expect(await store.remove("https://site.example")).toBe(true);
      expect(await store.read("https://site.example")).toBeNull();
    }
  );

  it("keeps each site's sign-in apart in the file", async () => {
    const { store } = await openSignInStore({
      loadBinding: async () => {
        throw new Error("no binding");
      },
      settingsFolder: home,
      projectFolder: project,
    });
    const other = {
      ...signIn,
      site: "https://other.example",
      issuer: "https://other.example",
    };
    await store.write(signIn);
    await store.write(other);
    await store.remove("https://site.example");

    expect(await store.read("https://other.example")).toEqual(other);
    expect(JSON.parse(readFileSync(store.location, "utf8"))).not.toHaveProperty(
      ["https://site.example"]
    );
  });

  it("writes a file only the person can read even over one a stopped write left", async () => {
    if (process.platform === "win32") return;
    const { store } = await openSignInStore({
      loadBinding: async () => {
        throw new Error("no binding");
      },
      settingsFolder: home,
      projectFolder: project,
    });
    // The half-written file a crash would leave, readable by anyone.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${store.location}.${process.pid}.next`, "{}", {
      mode: 0o644,
    });

    await store.write(signIn);

    expect(statSync(store.location).mode & 0o777).toBe(0o600);
  });

  it("tightens a file someone else could read before reading it", async () => {
    if (process.platform === "win32") return;
    const { store } = await openSignInStore({
      loadBinding: async () => {
        throw new Error("no binding");
      },
      settingsFolder: home,
      projectFolder: project,
    });
    await store.write(signIn);
    const { chmodSync } = await import("node:fs");
    chmodSync(store.location, 0o644);

    expect(await store.read("https://site.example")).toEqual(signIn);
    expect(statSync(store.location).mode & 0o777).toBe(0o600);
  });
});

describe("the project folder", () => {
  it("never holds the file, even when the settings folder is inside it", async () => {
    await expect(
      openSignInStore({
        loadBinding: async () => {
          throw new Error("no binding");
        },
        settingsFolder: join(project, ".nextly"),
        projectFolder: project,
      })
    ).rejects.toMatchObject({
      logContext: { reason: "sign-in-store-inside-the-project" },
    });
  });
});

describe("naming a token", () => {
  it("shows only its last four characters", () => {
    expect(tokenHint(signIn.refreshToken)).toBe(
      `…${signIn.refreshToken.slice(-4)}`
    );
    expect(tokenHint(signIn.refreshToken)).not.toContain(
      signIn.refreshToken.slice(0, -4)
    );
  });

  it("shows nothing of a token too short to hide", () => {
    expect(tokenHint("abcd")).toBe("…");
  });
});
