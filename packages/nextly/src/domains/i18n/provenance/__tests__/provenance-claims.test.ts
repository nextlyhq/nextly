/**
 * What a write's body may claim about where its values came from: each claim's shape, the sources
 * it may name, and who may make it. An accepted suggestion is server code's alone to claim.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import {
  assertClaimsAllowed,
  assertCopySources,
  provenanceClaimsOf,
  type ProvenanceClaims,
} from "../provenance-claims";
import { valueFingerprint } from "../value-fingerprint";

const FINGERPRINT = valueFingerprint("Hola");

/** The issues a check refuses with; none where it accepts. */
function issuesOf(check: () => unknown): { path: string; code: string }[] {
  try {
    check();
    return [];
  } catch (error) {
    if (!NextlyError.isValidation(error)) throw error;
    const { errors } = error.publicData as {
      errors: { path: string; code: string }[];
    };
    return errors.map(({ path, code }) => ({ path, code }));
  }
}

/** The claims of a body that makes one of its title. */
const claiming = (title: unknown) =>
  provenanceClaimsOf({ title: "Salut", _provenance: { title } });

describe("a claim that a value was translated from a language", () => {
  it.each([
    [{ origin: "translated", sourceLocale: "es" }],
    [
      {
        origin: "translated",
        sourceLocale: "es",
        sourceFingerprint: FINGERPRINT,
      },
    ],
  ])("is read as it is stated: %j", claim => {
    expect(claiming(claim)).toEqual({ title: claim });
  });

  it.each([
    ["no source language", { origin: "translated" }, "title.sourceLocale"],
    [
      "an empty source language",
      { origin: "translated", sourceLocale: "" },
      "title.sourceLocale",
    ],
    [
      "a fingerprint too short",
      { origin: "translated", sourceLocale: "es", sourceFingerprint: "abc" },
      "title.sourceFingerprint",
    ],
    [
      // As long as one, so only its characters tell it apart.
      "a fingerprint that is no hex",
      {
        origin: "translated",
        sourceLocale: "es",
        sourceFingerprint: "g".repeat(64),
      },
      "title.sourceFingerprint",
    ],
    [
      "a key it does not have",
      { origin: "translated", sourceLocale: "es", engine: "e1" },
      "title",
    ],
  ])("is refused with %s", (_why, claim, path) => {
    expect(issuesOf(() => claiming(claim)).map(issue => issue.path)).toEqual([
      path,
    ]);
  });
});

describe("a claim that a value is an accepted suggestion", () => {
  it("is refused of a body, whatever it says", () => {
    const suggestion = {
      origin: "suggestion",
      made: "machine",
      engine: "e1",
      sourceLocale: "en",
      sourceFingerprint: FINGERPRINT,
    };
    expect(issuesOf(() => claiming(suggestion))).toEqual([
      expect.objectContaining({ path: "title.origin" }),
    ]);
    // The same source, claimed as a body may claim it.
    expect(
      issuesOf(() =>
        claiming({
          origin: "translated",
          sourceLocale: "en",
          sourceFingerprint: FINGERPRINT,
        })
      )
    ).toEqual([]);
  });
});

describe("the sources a claim may name", () => {
  const languages = { configured: ["en", "es", "fr"], target: "fr" };
  const refusals = (claim: ProvenanceClaims[string]) =>
    issuesOf(() => assertCopySources({ title: claim }, languages));

  it.each([
    ["translated", "PROVENANCE_TRANSLATED_SOURCE"],
    ["copy", "PROVENANCE_COPY_SOURCE"],
  ] as const)("are the site's other languages: %s", (origin, code) => {
    const path = "_provenance.title.sourceLocale";
    expect(refusals({ origin, sourceLocale: "de" })).toEqual([
      { path, code: `${code}_UNKNOWN` },
    ]);
    expect(refusals({ origin, sourceLocale: "fr" })).toEqual([
      { path, code: `${code}_IS_TARGET` },
    ]);
    expect(refusals({ origin, sourceLocale: "es" })).toEqual([]);
  });

  it("are not asked of a claim that names none", () => {
    expect(refusals({ origin: "machine", engine: "e1" })).toEqual([]);
    expect(refusals({ origin: "original" })).toEqual([]);
  });
});

describe("who may make a claim", () => {
  const agent: ProvenanceClaims = { title: { origin: "agent" } };
  const translated: ProvenanceClaims = {
    title: { origin: "translated", sourceLocale: "es" },
  };

  it("an agent's is an API key's or a plugin-defined person's", () => {
    expect(
      issuesOf(() => assertClaimsAllowed(agent, { type: "user", id: "ann" }))
    ).toEqual([
      { path: "_provenance.title", code: "PROVENANCE_AGENT_NOT_ALLOWED" },
    ]);
    expect(
      issuesOf(() => assertClaimsAllowed(agent, { type: "apiKey", id: "k1" }))
    ).toEqual([]);
  });

  it("a translation's is anyone's", () => {
    for (const type of ["user", "apiKey"] as const) {
      expect(
        issuesOf(() => assertClaimsAllowed(translated, { type, id: "x" }))
      ).toEqual([]);
    }
  });
});
