/**
 * The dev user's stored session, which makes each spec file's account and
 * serves whatever a spec opens from `STORAGE_STATE`, stays signed in however
 * long the suite runs: once it is older than `SESSION_MAX_AGE_MS`, it is
 * renewed before the next test (see `support/session` and `support/test`). And
 * each spec file runs as an account of its own, not as the dev user.
 *
 * The server's token lives 15 minutes, and a test cannot wait that long, so a
 * session the server refuses stands in for one that has expired: the stored
 * access token is replaced by one that does not verify. The server refuses
 * both the same way, and what decides a renewal is the stored session's age,
 * not why its token is refused. The age is set by the file's modification
 * time, which is what the renewal reads.
 *
 * @module tests/session-stays-signed-in
 */
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, request, type Page } from "@playwright/test";

import {
  keepSessionFresh,
  SESSION_MAX_AGE_MS,
  STORAGE_STATE,
} from "./support/session";
import { test } from "./support/test";

const TESTS = path.dirname(fileURLToPath(import.meta.url));

/** Whether the server takes the session stored at `file` as signed in. */
async function signedIn(baseURL: string, file: string): Promise<boolean> {
  const asked = await request.newContext({ baseURL, storageState: file });
  try {
    // A route that needs a session: the session route itself would sign a
    // refused visitor in again under the playground's dev auto-login.
    const answer = await asked.get("/admin/api/dashboard/layout");
    return answer.ok();
  } finally {
    await asked.dispose();
  }
}

interface StoredSession {
  cookies: Array<{ name: string; value: string }>;
}

/** The access token stored at `file`. */
function tokenIn(file: string): string | undefined {
  const stored = JSON.parse(readFileSync(file, "utf8")) as StoredSession;
  return stored.cookies.find(cookie => cookie.name === "nextly_session")?.value;
}

/** A copy of the suite's session in `dir` whose access token the server refuses. */
function refusedCopy(dir: string): string {
  const file = path.join(dir, "session.json");
  copyFileSync(STORAGE_STATE, file);
  const stored = JSON.parse(readFileSync(file, "utf8")) as StoredSession;
  for (const cookie of stored.cookies) {
    if (cookie.name === "nextly_session") cookie.value = "not-a-token";
  }
  writeFileSync(file, JSON.stringify(stored));
  return file;
}

/** Sets the session at `file` as stored `ms` ago. */
function ageBy(file: string, ms: number): void {
  const then = new Date(Date.now() - ms);
  utimesSync(file, then, then);
}

test.describe("a stored session", () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nextly-e2e-session-"));
  });
  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("older than its limit is replaced by one the server takes", async ({
    baseURL,
  }) => {
    const file = refusedCopy(dir);
    expect(await signedIn(baseURL!, file)).toBe(false);

    ageBy(file, SESSION_MAX_AGE_MS + 60_000);
    expect(await keepSessionFresh(baseURL!, file)).toBe(true);

    expect(tokenIn(file)).not.toBe("not-a-token");
    expect(await signedIn(baseURL!, file)).toBe(true);
  });

  test("within its limit is kept as it is", async ({ baseURL }) => {
    const file = refusedCopy(dir);
    ageBy(file, SESSION_MAX_AGE_MS - 60_000);
    expect(await keepSessionFresh(baseURL!, file)).toBe(false);
    expect(tokenIn(file)).toBe("not-a-token");
  });
});

// In order: the first ages the suite's own session past its limit, and the
// second reads what the suite's `test` made of it before that test began.
test.describe.serial("the suite's session, past its limit", () => {
  let aged: string | undefined;

  test("is aged", () => {
    aged = tokenIn(STORAGE_STATE);
    expect(aged).toBeDefined();
    ageBy(STORAGE_STATE, SESSION_MAX_AGE_MS + 60_000);
  });

  test("is renewed before the next test", async ({ baseURL }) => {
    const renewed = tokenIn(STORAGE_STATE);
    expect(renewed).toBeDefined();
    expect(renewed).not.toBe(aged);
    expect(await signedIn(baseURL!, STORAGE_STATE)).toBe(true);
  });
});

/** The address of the user a page's session belongs to. */
async function sessionEmail(page: Page): Promise<string | undefined> {
  const answer = await page.request.get("/admin/api/auth/session");
  expect(answer.ok(), await answer.text()).toBe(true);
  return ((await answer.json()) as { user?: { email?: string } }).user?.email;
}

// In order, so both tests are the same attempt of this file.
test.describe.serial("a spec file's own account", () => {
  let first: string | undefined;

  test("is not the dev user", async ({ page }) => {
    first = await sessionEmail(page);
    expect(first).toMatch(/^spec-.+@nextly\.local$/);
  });

  test("is the same for every test in the file", async ({ page }) => {
    expect(await sessionEmail(page)).toBe(first);
  });
});

/** Every spec under `dir`, but the production suite's, which has its own config. */
function specsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "production" ? [] : specsUnder(at);
    }
    return entry.name.endsWith(".spec.ts") ? [at] : [];
  });
}

test("every spec this config runs is written with the suite's test", () => {
  // Playwright's `test` runs without the renewal, and a spec on it is signed
  // out once the suite has run longer than the session's token lives. Spec
  // files are outside lint, so this is where that is held.
  const fromPlaywright = /import\s*\{([^}]*)\}\s*from\s*"@playwright\/test"/g;
  const onPlaywrightTest = specsUnder(TESTS).filter(file =>
    [...readFileSync(file, "utf8").matchAll(fromPlaywright)].some(match =>
      match[1]
        .split(",")
        .map(name => name.trim())
        .some(name => /^test(\s+as\s+\w+)?$/.test(name))
    )
  );
  expect(
    onPlaywrightTest.map(file => path.relative(TESTS, file)),
    'These specs take `test` from "@playwright/test", which runs without the ' +
      "session renewal and is signed out once a run passes 15 minutes. In each, " +
      'take `test` from the suite instead: import { test } from "./support/test" ' +
      '(or "../support/test" one folder down), keeping `expect` and the types ' +
      'from "@playwright/test".'
  ).toEqual([]);
});
