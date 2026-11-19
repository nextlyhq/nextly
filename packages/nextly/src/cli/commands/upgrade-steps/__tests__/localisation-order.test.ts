/**
 * The order `nextly migrate` runs the localisation data steps in, which each step relies on:
 * - after the steps over stored data it already ran, and so after the run's migrations, which
 *   give the version history the columns the steps write;
 * - language codes first, so every later step reads and writes the standard code;
 * - pending changes keyed before they are split, so the split sees one draft per language;
 * - values moved per language before the drafts are split against them;
 * - translations dated after that, from the history the steps before left;
 * - the archive listed last, having nothing to change.
 */
import { describe, expect, it } from "vitest";

import { LOCALISATION_DATA_STEPS, MIGRATE_DATA_STEPS } from "../index";

describe("the localisation data steps' order", () => {
  it("runs codes, keys, values, drafts, stamps and the archive listing, in that order", () => {
    expect(LOCALISATION_DATA_STEPS.map(step => step.title)).toEqual([
      "convert language codes to their standard form",
      "give every pending change its key",
      "store translatable values per language",
      "split pending changes into shared and language drafts",
      "date translations from their version history",
      "list archived translations of no known entity",
    ]);
  });

  it("runs them after every other step of `nextly migrate`, in one block", () => {
    const titles = MIGRATE_DATA_STEPS.map(step => step.title);
    const localisation = LOCALISATION_DATA_STEPS.map(step => step.title);
    expect(titles.slice(-localisation.length)).toEqual(localisation);
  });
});
