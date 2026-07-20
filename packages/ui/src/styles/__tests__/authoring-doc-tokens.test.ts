/**
 * Asserts that every design token named in the plugin authoring guide actually
 * exists in `theme.css`.
 *
 * The guide is the contract external plugin authors build against, and CSS
 * fails silently: a token that does not exist resolves to nothing, so a stale
 * name produces unstyled UI with no error anywhere. The guide had drifted to a
 * scope class that is rendered nowhere and to unprefixed token names that
 * nothing reads, which is undetectable without a check like this one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, "../../../docs/plugin-ui-authoring.md");
const THEME = resolve(HERE, "../theme.css");

const doc = readFileSync(DOC, "utf8");
const theme = readFileSync(THEME, "utf8");

/** Custom properties the theme actually declares, e.g. `--nx-card`. */
const declared = new Set(
  [...theme.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1])
);

/**
 * Token names the guide tells authors to use. Wildcard stubs (`--nx-sidebar-*`
 * written as prose) and the generic `--token` placeholder are not real names.
 */
const referenced = [
  ...new Set([...doc.matchAll(/--[a-z0-9-]+/g)].map(match => match[0])),
].filter(token => !token.endsWith("-") && token !== "--token");

describe("plugin authoring guide", () => {
  it("references only tokens that theme.css declares", () => {
    const missing = referenced.filter(token => !declared.has(token));

    expect(
      missing,
      `These tokens are documented but not declared in theme.css, so CSS using ` +
        `them silently resolves to nothing: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("documents the scope class the admin actually renders", () => {
    // The admin root renders `.nextly-admin`, and the admin stylesheet is
    // scoped to it; any other class leaves plugin CSS inert.
    expect(doc).toContain(".nextly-admin");
    expect(doc).not.toContain("adminapp");
  });

  it("names at least one real token, so the check cannot pass vacuously", () => {
    expect(referenced.length).toBeGreaterThan(10);
    expect(referenced).toContain("--nx-primary");
  });
});
