import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The accepted PR scopes are enforced in exactly one place —
 * .github/workflows/pr-title.yml — and stated in prose in AGENTS.md. Nothing else notices when the
 * two lists disagree, so a contributor following the document can avoid a
 * scope the check accepts, or attempt one it refuses. These tests hold the
 * document to being a transcription of the enforced list, in both
 * directions, and hold AGENTS.md's list of scope-less packages to the
 * workspace's actual contents.
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

/** The packages AGENTS.md names as having no accepted scope, empty when the document names none. */
function documentedUnscoped() {
  const doc = read("AGENTS.md");
  const sentence = doc.match(/Packages currently without an\n\s+accepted scope \(([^)]*)\)/);
  if (!sentence) return [];
  return (sentence[1].match(/`([^`]+)`/g) || []).map(n => n.replace(/`/g, "")).sort();
}

describe("AGENTS.md scope documentation matches what is enforced", () => {
  it("documents every enforced scope and nothing else", () => {
    const enforced = enforcedScopes();
    // Two empty lists are equal, so equality alone passes when both
    // extractions silently read nothing; a member that can never leave the
    // list is the control that proves the reads reached their subject.
    expect(enforced).toContain("nextly");
    expect(enforced.length).toBeGreaterThan(10);
    expect(documentedScopes()).toEqual(enforced);
  });

  it("names exactly the packages that have no accepted scope", () => {
    const enforced = new Set(enforcedScopes());
    const actualUnscoped = readdirSync(resolve(repoRoot, "packages"))
      .filter(p => existsSync(resolve(repoRoot, "packages", p, "package.json")))
      .filter(p => !enforced.has(p))
      .sort();
    expect(documentedUnscoped()).toEqual(actualUnscoped);
  });
});
