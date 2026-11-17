/**
 * What a person is offered to publish: the language being edited and, when they hold unpublished
 * changes, the shared fields, chosen by default; each language and the shared fields chosen on
 * their own; and each refusal read back beside the part it names.
 *
 * The plausible broken defaults: choosing every language (what publishing all does), choosing the
 * shared fields whatever they hold, or losing the app's order when a language is ticked.
 */
import { describe, expect, it } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import {
  choosesAnything,
  defaultPartsChoice,
  partsOutcomeSentence,
  refusalsByPart,
  sharedSentence,
  withLanguage,
  type PartsChoice,
} from "../publish-parts-choice";

const LANGUAGES = ["en", "es", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", ar: "Arabic" })[code] ?? code;

describe("the choice the menu opens with", () => {
  it("chooses the language being edited, and not the shared fields when they hold nothing new", () => {
    expect(
      defaultPartsChoice({
        languages: LANGUAGES,
        currentLocale: "es",
        defaultLocale: "en",
        sharedPending: false,
      })
    ).toEqual({ locales: ["es"], shared: false });
  });

  it("chooses the shared fields too when they hold unpublished changes", () => {
    expect(
      defaultPartsChoice({
        languages: LANGUAGES,
        currentLocale: undefined,
        defaultLocale: "en",
        sharedPending: true,
      })
    ).toEqual({ locales: ["en"], shared: true });
  });

  it("chooses the shared fields alone for a document that is not translated", () => {
    expect(
      defaultPartsChoice({
        languages: [],
        currentLocale: undefined,
        defaultLocale: undefined,
        sharedPending: false,
      })
    ).toEqual({ locales: [], shared: true });
  });
});

describe("choosing parts", () => {
  it("keeps the app's order of languages, whatever order they are ticked in", () => {
    let choice: PartsChoice = { locales: [], shared: false };
    choice = withLanguage(choice, LANGUAGES, "ar", true);
    choice = withLanguage(choice, LANGUAGES, "en", true);
    expect(choice.locales).toEqual(["en", "ar"]);
    expect(withLanguage(choice, LANGUAGES, "en", false).locales).toEqual([
      "ar",
    ]);
  });

  it("chooses nothing when no language and no shared fields are ticked", () => {
    expect(choosesAnything({ locales: [], shared: false })).toBe(false);
    expect(choosesAnything({ locales: [], shared: true })).toBe(true);
    expect(choosesAnything({ locales: ["es"], shared: false })).toBe(true);
  });
});

describe("what each part will do", () => {
  it("says what an unpublish does to each language", () => {
    expect(
      partsOutcomeSentence({ locale: "es", outcome: "taken-down" }, labelOf)
    ).toMatch(/Comes down/);
    expect(
      partsOutcomeSentence(
        { locale: "es", outcome: "stays-unpublished" },
        labelOf
      )
    ).toMatch(/nothing changes/);
  });

  it("says a first publish takes the shared fields along", () => {
    expect(sharedSentence("publish", { changes: true, added: true })).toMatch(
      /first publish/
    );
    expect(sharedSentence("publish", { changes: false, added: false })).toBe(
      "Nothing changes."
    );
  });
});

describe("a refusal", () => {
  it("is read back by the part it names, the gate's reasons included", () => {
    const refusal = parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "r1",
          data: {
            errors: [
              {
                path: "es",
                code: "NOT_APPROVED",
                locale: "es",
                message: 'The "es" language has no current approval.',
              },
              {
                path: "shared",
                code: "FORBIDDEN",
                message: "The shared part: you may not publish it.",
              },
            ],
          },
        },
      },
      400
    );

    const byPart = refusalsByPart(refusal, ["en", "es", "shared"]);

    expect(byPart.get("es")).toEqual([
      'The "es" language has no current approval.',
    ]);
    expect(byPart.get("shared")).toEqual([
      "The shared part: you may not publish it.",
    ]);
    expect(byPart.has("en")).toBe(false);
  });
});
