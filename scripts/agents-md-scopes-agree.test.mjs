import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The accepted PR scopes are enforced in exactly one place — the pr-title
 * workflow — and stated in prose in AGENTS.md. Nothing noticed when the two
 * drifted: eslint-plugin was accepted by the check and absent from the
 * document for months, so contributors following the document avoided a
 * scope they were allowed to use. This asserts the document's list stays a
 * transcription of the enforced one, in both directions.
 *
 * Lives beside the other repository-wide script tests because it makes a
 * claim about the repository as a whole and no feature owns it.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(resolve(repoRoot, file), "utf8");

/** The list the CI check actually enforces. */
function enforcedScopes() {
  const workflow = read(".github/workflows/pr-title.yml");
  const block = workflow.match(/scopes: \|\n([\s\S]*?)\n\s+requireScope/);
  expect(block, "scopes block not found in pr-title.yml — the anchor moved").toBeTruthy();
  return block[1].split("\n").map(l => l.trim()).filter(Boolean).sort();
}

/** The list AGENTS.md documents, read from the backticked names in its scope sentence. */
function documentedScopes() {
  const doc = read("AGENTS.md");
  const sentence = doc.match(/Allowed PR scopes are package-based \(([\s\S]*?)\)\s*plus\s*([\s\S]*?)\./);
  expect(sentence, "scope sentence not found in AGENTS.md — the anchor moved").toBeTruthy();
  const names = `${sentence[1]} ${sentence[2]}`.match(/`([^`]+)`/g) || [];
  return names.map(n => n.replace(/`/g, "")).sort();
}

describe("AGENTS.md scope list matches the enforced pr-title list", () => {
  it("documents every enforced scope and nothing else", () => {
    expect(documentedScopes()).toEqual(enforcedScopes());
  });
});
