/**
 * The shapes the API-key scope guard fires on, and the ones it must not.
 *
 * The selector answers a question with two failure directions, and they are not
 * symmetric. A MISS lets a hand-built scope back in — the defect the rule
 * exists for. A FALSE POSITIVE is worse in a different way: it fires on code
 * that is no kind of scope, and the cheapest ways out are renaming the field or
 * disabling the rule, both of which cost every true positive too.
 *
 * That direction was live. `actorType` plus ANY spread matched every object
 * carrying a field of that name and spreading anything, and an activity-log row
 * does exactly that.
 *
 * @module auth/__tests__/api-key-scope-selector.test
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Whether the scope guard fires on `source`, linted as real package source. */
async function firesOn(source: string): Promise<boolean> {
  const results = await new ESLint({ cwd: packageRoot }).lintText(source, {
    // A path that REALLY EXISTS in the package's tsconfig project. Type-aware
    // linting resolves the file through the project service, and an invented
    // path fails to parse — which arrives as a fatal message rather than as a
    // rule that declined to fire, so the guard below tells the two apart.
    filePath: join(packageRoot, "src", "api", "releases.ts"),
  });
  const messages = results[0]?.messages ?? [];
  // A parse failure arrives as a fatal message with a null ruleId, which would
  // otherwise read as "the rule did not fire" — the same answer a correct
  // exemption gives.
  const fatal = messages.find(message => message.fatal);
  if (fatal) throw new Error(`probe failed to parse: ${fatal.message}`);
  return messages.some(
    message =>
      message.ruleId === "no-restricted-syntax" &&
      message.message.includes("apiKeyScopeFrom")
  );
}

describe("the API-key scope selector", () => {
  it("fires on the pair, which is what all nine instances looked like", async () => {
    expect(
      await firesOn('const s = { actorType: "apiKey", permissions: [] };')
    ).toBe(true);
  });

  it("fires whichever order the pair is written in", async () => {
    // `:has()` is order-independent; a scan over source is not, and the regex
    // this replaced could be evaded by swapping the two keys.
    expect(
      await firesOn('const s = { permissions: [], actorType: "apiKey" };')
    ).toBe(true);
  });

  it("fires when the second half is hidden behind a spread", async () => {
    // `{ actorType: "apiKey", ...auth }` is as lossy as the pair and the pair
    // shape cannot see it.
    expect(
      await firesOn('const a = {}; const s = { actorType: "apiKey", ...a };')
    ).toBe(true);
  });

  it("does NOT fire on a row that merely has an actorType and a spread", async () => {
    // An activity-log row records what KIND of caller wrote it and spreads its
    // optional columns. It is no kind of scope, and a guard that refuses it is
    // one a developer works around.
    expect(
      await firesOn(
        'const rest = {}; const row = { actorType: "user" as string, userId: "u", ...rest };'
      )
    ).toBe(false);
  });

  it("does NOT fire on an object that only names an actorType", async () => {
    // `actorType` alone would reject the webhook outbox row and its column
    // definitions, which carry that field and are not scopes.
    expect(await firesOn('const w = { actorType: "apiKey" };')).toBe(false);
  });
});
