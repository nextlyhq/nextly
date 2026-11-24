/**
 * What a publish says before and after, from the server's own description and
 * report: each outcome its own sentence, and the shared fields said to have
 * moved only where they did.
 */
import { describe, expect, it } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";
import type { PartsLanguageOutcome } from "@admin/services/publishParts";

import {
  emptyFieldLine,
  goingLiveTooSentence,
  offlineSentence,
  publishedMessage,
  publishes,
  publishSentence,
  refusalMessages,
} from "../publish-language-words";

const LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
};
const labelOf = (code: string) => LABELS[code] ?? code;

describe("before a publish", () => {
  it.each([
    [{ outcome: "goes-live" }, /will see this translation/, true],
    [
      { outcome: "goes-live-with-pending-change" },
      /will see your saved changes/,
      true,
    ],
    // Never the language named, which may be one nobody has published.
    [
      { outcome: "shows-fallback", fallback: "en" },
      /^(?!.*English).*another published language where there is one/,
      true,
    ],
    [{ outcome: "shows-fallback", fallback: null }, /no text of its own/, true],
    [{ outcome: "stays-published" }, /nothing to publish/, false],
    [
      { outcome: "out-of-date", fields: ["articleCount"], hiddenCount: 1 },
      /Article Count and 1 field you can't view, which changed/,
      false,
    ],
  ] as const)("%o", (outcome, sentence, does) => {
    const described = { locale: "es", ...outcome } as PartsLanguageOutcome;
    expect(publishSentence(described, "Spanish", false)).toMatch(sentence);
    expect(publishes(described, false)).toBe(does);
  });

  it("publishes a language marked published while the document is not", () => {
    const marked = { locale: "es", outcome: "stays-published" } as const;
    expect(publishes(marked, true)).toBe(true);
    expect(publishSentence(marked, "Spanish", true)).not.toMatch(/nothing to/);
    // Behind the shared fields, it is refused all the same.
    expect(
      publishes({ locale: "es", outcome: "out-of-date", fields: ["a"] }, true)
    ).toBe(false);
  });

  it("names the languages a first publish shows too", () => {
    expect(goingLiveTooSentence([], labelOf)).toBeUndefined();
    expect(goingLiveTooSentence(["en"], labelOf)).toBe(
      "English is already marked published, so it goes live too."
    );
    expect(goingLiveTooSentence(["en", "fr"], labelOf)).toBe(
      "English and French are already marked published, so they go live too."
    );
    expect(goingLiveTooSentence(undefined, labelOf)).toMatch(/^Any other/);
  });

  it("publishes nothing the server has not described", () => {
    expect(publishes(undefined, true)).toBe(false);
  });

  it("says what an empty field shows, and claims nothing unknown", () => {
    const line = (shows: string | null | undefined) =>
      emptyFieldLine({ name: "title", label: "Title", shows }, labelOf);
    expect(line("en")).toBe("Title: English is shown");
    expect(line(null)).toBe("Title: nothing is shown");
    expect(line(undefined)).toBe("Title: another language may be shown");
  });
});

describe("after a publish", () => {
  const done = (
    shared: { changes: boolean; added: boolean },
    goingLiveToo: string[] | undefined = []
  ) =>
    publishedMessage({
      result: { shared },
      language: "Spanish",
      defaultLocale: "en",
      goingLiveToo,
      labelOf,
    });

  it("says the shared fields are unchanged only where they are", () => {
    expect(done({ changes: false, added: false })).toBe(
      "Spanish is published. English and the shared fields are unchanged."
    );
    for (const moved of [
      { changes: true, added: true },
      { changes: true, added: false },
      { changes: false, added: true },
    ]) {
      expect(done(moved)).toBe(
        "Spanish is published, and the shared fields went live with it. English is unchanged."
      );
    }
  });

  it("says the default language is unchanged only where it is", () => {
    const first = { changes: true, added: true };
    expect(done(first, ["fr"])).toMatch(
      /So did French\. English is unchanged\.$/
    );
    expect(done(first, ["en"])).toMatch(/So did English\.$/);
    expect(
      publishedMessage({
        result: { shared: first },
        language: "Spanish",
        defaultLocale: "en",
        goingLiveToo: undefined,
        labelOf,
      })
    ).not.toMatch(/English/);
  });
});

describe("taking a language offline", () => {
  it("says both what its readers can get", () => {
    expect(offlineSentence("Spanish")).toMatch(/“not found”/);
    expect(offlineSentence("Spanish")).toMatch(/fallback language/);
  });
});

describe("a refusal", () => {
  const refused = (errors: object[]) =>
    parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          data: { errors },
        },
      },
      400
    );

  it("is nothing without one", () => {
    expect(refusalMessages(null, "Spanish", "Failed.")).toEqual([]);
  });

  it("is each of the server's reasons, once", () => {
    const reason = { path: "es", code: "NOT_APPROVED", message: "In review." };
    expect(
      refusalMessages(
        refused([reason, reason, { path: "bio", message: "Too long." }]),
        "Spanish",
        "Failed."
      )
    ).toEqual(["In review.", "Too long."]);
  });

  it("puts the server's codes into words, and names its fields", () => {
    expect(
      refusalMessages(
        refused([
          {
            path: "articleCount, bio",
            code: "pending-change-invalid",
            message: "Publishing would be refused (pending-change-invalid).",
          },
        ]),
        "Spanish",
        "Failed."
      )
    ).toEqual([
      "Spanish's saved changes to Article Count and Bio don't pass validation.",
    ]);
  });

  it("says a document changed since, and any other failure in its words", () => {
    const stale = parseApiError(
      {
        error: {
          code: "STALE_VERSION",
          message: "The document changed.",
          data: { currentVersion: "8" },
        },
      },
      409
    );
    expect(refusalMessages(stale, "Spanish", "Failed.")[0]).toMatch(
      /changed since you opened it/
    );
    const forbidden = parseApiError(
      { error: { code: "FORBIDDEN", message: "You may not." } },
      403
    );
    expect(refusalMessages(forbidden, "Spanish", "Failed.")).toEqual([
      "You may not.",
    ]);
  });
});
