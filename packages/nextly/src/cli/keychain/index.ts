/**
 * Where the command line keeps a person's sign-in to a live site.
 *
 * In the operating system's keychain (Keychain on macOS, Credential Manager
 * on Windows, the Secret Service on Linux), one entry per site, keyed by the
 * site's sign-in issuer. Where there is none, as in a Linux container, in a
 * file only the person can read, in their own Nextly settings folder, and
 * the caller prints the warning this returns. Never inside the project, so a
 * sign-in can't be committed or copied with it.
 *
 * The keychain binding is a native module, loaded here and only here, when a
 * store is opened: a system without its prebuilt binary, or with a broken
 * one, still starts every command and falls back to the file.
 *
 * Nothing here prints a token. Where one must be named, {@link tokenHint}
 * shows its last four characters.
 *
 * @module cli/keychain
 */
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { NextlyError } from "../../errors/nextly-error";

/** One site's sign-in, as the command line keeps it. */
export interface StoredSignIn {
  /** The site's address, as the person signed in to it. */
  site: string;
  /** The site's sign-in issuer, which the entry is keyed by. */
  issuer: string;
  credentialId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  signInEndsAt: string;
}

/** Where sign-ins are kept, and how to read, write and remove one. */
export interface SignInStore {
  readonly kind: "keychain" | "file";
  /** Where they are, for `nextly whoami` to show. */
  readonly location: string;
  read(issuer: string): Promise<StoredSignIn | null>;
  write(signIn: StoredSignIn): Promise<void>;
  /** True when there was a sign-in to remove. */
  remove(issuer: string): Promise<boolean>;
}

/** The part of the keychain binding this module uses. */
export interface KeychainBinding {
  AsyncEntry: new (
    service: string,
    account: string,
    options?: { linux?: { store?: "secret-service" | "keyutils" } }
  ) => {
    getPassword(): Promise<string | null>;
    setPassword(value: string): Promise<void>;
    deletePassword(): Promise<boolean>;
  };
}

/** The keychain service every site's entry is kept under. */
const KEYCHAIN_SERVICE = "nextly";

/** The fallback file's name in the settings folder. */
const FALLBACK_FILE = "cli-sign-ins.json";

/**
 * On Linux, the Secret Service only. The kernel keyring the binding would
 * otherwise fall back to forgets everything at reboot, so a sign-in kept
 * there would vanish without a word; a system without the Secret Service
 * gets the file and the warning instead.
 */
const ENTRY_OPTIONS = { linux: { store: "secret-service" as const } };

/** A token named without being shown: its last four characters. */
export function tokenHint(token: string): string {
  return token.length > 8 ? `…${token.slice(-4)}` : "…";
}

/** Load the binding the way production does: a dynamic import, only here. */
async function loadKeychainBinding(): Promise<KeychainBinding> {
  return await import("@napi-rs/keyring");
}

/**
 * Whether the keychain can be reached: one read of an entry nobody writes.
 * A keychain that is there answers null; one that can't be reached throws.
 */
async function keychainAnswers(binding: KeychainBinding): Promise<boolean> {
  try {
    await new binding.AsyncEntry(
      KEYCHAIN_SERVICE,
      "reachable",
      ENTRY_OPTIONS
    ).getPassword();
    return true;
  } catch {
    return false;
  }
}

function keychainStore(binding: KeychainBinding): SignInStore {
  const entry = (issuer: string) =>
    new binding.AsyncEntry(KEYCHAIN_SERVICE, issuer, ENTRY_OPTIONS);
  return {
    kind: "keychain",
    location: "the system keychain",
    async read(issuer) {
      const value = await entry(issuer).getPassword();
      return value === null ? null : parseSignIn(value);
    },
    async write(signIn) {
      await entry(signIn.issuer).setPassword(JSON.stringify(signIn));
    },
    async remove(issuer) {
      return entry(issuer).deletePassword();
    },
  };
}

/** A stored sign-in read back, or null when it isn't one. */
function parseSignIn(value: string): StoredSignIn | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isStoredSignIn(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStoredSignIn(value: unknown): value is StoredSignIn {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return [
    "site",
    "issuer",
    "credentialId",
    "accessToken",
    "accessTokenExpiresAt",
    "refreshToken",
    "signInEndsAt",
  ].every(key => typeof record[key] === "string");
}

/**
 * The fallback: one file, a map of issuer to sign-in, readable and writable
 * by the person alone. Written whole to a new file beside it and renamed
 * over, so a crash mid-write leaves the previous file, never half of one.
 */
function fileStore(folder: string): SignInStore {
  const file = join(folder, FALLBACK_FILE);
  const isPosix = process.platform !== "win32";

  async function readAll(): Promise<Record<string, StoredSignIn>> {
    let text: string;
    try {
      if (isPosix && ((await stat(file)).mode & 0o077) !== 0) {
        // Someone else could read it: take that away before using it.
        await chmod(file, 0o600);
      }
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const parsed: unknown = JSON.parse(text);
    const all: Record<string, StoredSignIn> = {};
    if (typeof parsed === "object" && parsed !== null) {
      for (const [issuer, value] of Object.entries(parsed)) {
        if (isStoredSignIn(value)) all[issuer] = value;
      }
    }
    return all;
  }

  async function writeAll(all: Record<string, StoredSignIn>): Promise<void> {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if (isPosix) await chmod(folder, 0o700);
    const next = `${file}.${process.pid}.next`;
    await writeFile(next, JSON.stringify(all), { mode: 0o600, flag: "w" });
    // `mode` applies only when the file is created; one left behind by a
    // write that stopped keeps its own, so set it before the file replaces
    // the sign-ins.
    if (isPosix) await chmod(next, 0o600);
    await rename(next, file);
  }

  return {
    kind: "file",
    location: file,
    async read(issuer) {
      return (await readAll())[issuer] ?? null;
    },
    async write(signIn) {
      const all = await readAll();
      all[signIn.issuer] = signIn;
      await writeAll(all);
    },
    async remove(issuer) {
      const all = await readAll();
      if (!(issuer in all)) return false;
      delete all[issuer];
      await writeAll(all);
      return true;
    },
  };
}

/** Whether `folder` is the project folder or inside it. */
function insideFolder(folder: string, project: string): boolean {
  const path = relative(project, folder);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * Open the place sign-ins are kept: the keychain when it answers, else the
 * file, with the warning to print. Refuses a settings folder inside the
 * project, so the fallback can never write a sign-in where it could be
 * committed.
 */
export async function openSignInStore(deps: {
  settingsFolder: string;
  projectFolder: string;
  loadBinding?: () => Promise<KeychainBinding>;
}): Promise<{ store: SignInStore; warning: string | null }> {
  if (insideFolder(deps.settingsFolder, deps.projectFolder)) {
    throw NextlyError.internal({
      logContext: {
        reason: "sign-in-store-inside-the-project",
        remedy:
          "The settings folder for sign-ins is inside the project, where a sign-in could be committed.",
      },
    });
  }
  let binding: KeychainBinding | null = null;
  try {
    binding = await (deps.loadBinding ?? loadKeychainBinding)();
  } catch {
    binding = null;
  }
  if (binding && (await keychainAnswers(binding))) {
    return { store: keychainStore(binding), warning: null };
  }
  const store = fileStore(deps.settingsFolder);
  return {
    store,
    warning:
      `No system keychain was found, so your sign-in is kept in ${store.location}, ` +
      "a file only you can read. `nextly whoami` shows where it is.",
  };
}
