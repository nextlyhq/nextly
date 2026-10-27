import { describe, expect, it } from "vitest";

import {
  type LanguageRow,
  MAX_ACTIVE_LANGUAGES,
  planLanguageChange,
} from "./language-changes";

const lang = (code: string, over: Partial<LanguageRow> = {}): LanguageRow => ({
  code,
  label: code,
  direction: "ltr",
  fallback: "[]",
  position: 0,
  isDefault: false,
  active: true,
  revision: 1,
  ...over,
});
const en = lang("en", { label: "English", isDefault: true });
const fr = lang("fr", { position: 1 });

const codesOf = (rows: LanguageRow[]) =>
  rows
    .filter(r => r.active)
    .sort((a, b) => a.position - b.position)
    .map(r => r.code);
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return `${String(error)} ${JSON.stringify((error as { publicData?: unknown }).publicData ?? null)}`;
  }
  return "no refusal";
};

describe("a change to the stored language list", () => {
  it("stores English as the default beside the first language a site adds", () => {
    const next = planLanguageChange([], {
      kind: "add",
      code: "fr",
      label: "French",
    });

    expect(codesOf(next)).toEqual(["en", "fr"]);
    expect(next.find(r => r.isDefault)?.code).toBe("en");
  });

  it("stores a code in its canonical BCP 47 form", () => {
    const next = planLanguageChange([en], {
      kind: "add",
      code: "PT-br",
      label: "Portuguese",
    });

    expect(codesOf(next)).toEqual(["en", "pt-BR"]);
  });

  it("refuses a code that is the same as one stored apart from letter case", () => {
    const rows = [en, lang("en-US", { position: 1 })];

    expect(
      refusal(() =>
        planLanguageChange(rows, { kind: "add", code: "EN-us", label: "x" })
      )
    ).toMatch(/already/i);
  });

  it("refuses a code that is not BCP 47, and the selector codes", () => {
    expect(
      refusal(() =>
        planLanguageChange([en], {
          kind: "add",
          code: "not a code",
          label: "x",
        })
      )
    ).toMatch(/BCP 47/);
    // Judged after canonicalizing, so a case variant cannot be stored under a selector's spelling.
    for (const code of ["all", "none", "ALL", "None"]) {
      expect(
        refusal(() =>
          planLanguageChange([en], { kind: "add", code, label: "x" })
        )
      ).toMatch(/reserved/);
    }
  });

  it("keeps a label without its surrounding spaces, and refuses one that is only spaces", () => {
    const added = planLanguageChange([en], {
      kind: "add",
      code: "fr",
      label: "  French ",
    });
    expect(added.find(row => row.code === "fr")?.label).toBe("French");

    for (const change of [
      { kind: "add", code: "fr", label: "   " },
      { kind: "update", code: "en", label: " \t " },
    ] as const) {
      expect(refusal(() => planLanguageChange([en], change))).toMatch(/label/i);
    }
  });

  it("refuses fallback lists that loop through other languages", () => {
    const rows = [
      en,
      lang("fr", { position: 1, fallback: '["es"]' }),
      lang("es", { position: 2 }),
    ];

    expect(
      refusal(() =>
        planLanguageChange(rows, {
          kind: "update",
          code: "es",
          fallback: ["fr"],
        })
      )
    ).toMatch(/loop/);
  });

  it("marks a removed language inactive, keeps its row, and brings it back when added again", () => {
    const removed = planLanguageChange([en, fr], {
      kind: "remove",
      code: "fr",
    });
    expect(removed.find(r => r.code === "fr")?.active).toBe(false);
    expect(codesOf(removed)).toEqual(["en"]);

    const back = planLanguageChange(removed, {
      kind: "add",
      code: "fr",
      label: "French",
    });
    expect(codesOf(back)).toEqual(["en", "fr"]);
    expect(back.filter(r => r.code === "fr")).toHaveLength(1);
  });

  it("refuses to remove the default, naming the way to do it", () => {
    expect(
      refusal(() =>
        planLanguageChange([en, fr], { kind: "remove", code: "en" })
      )
    ).toMatch(/default/);
  });

  // A reorder names every active language, and a request names at most `MAX_ACTIVE_LANGUAGES`, so a
  // list longer than that could never be reordered again.
  it("adds languages up to the most a reorder can name, and refuses the next", () => {
    const active = (count: number) => [
      en,
      ...Array.from({ length: count - 1 }, (_, i) =>
        lang(`en-${100 + i}`, { position: i + 1 })
      ),
    ];

    expect(
      codesOf(
        planLanguageChange(active(MAX_ACTIVE_LANGUAGES - 1), {
          kind: "add",
          code: "fr",
          label: "French",
        })
      )
    ).toHaveLength(MAX_ACTIVE_LANGUAGES);
    expect(
      refusal(() =>
        planLanguageChange(active(MAX_ACTIVE_LANGUAGES), {
          kind: "add",
          code: "fr",
          label: "French",
        })
      )
    ).toContain("too_many_languages");
  });

  it("reorders the active languages", () => {
    const next = planLanguageChange([en, fr], {
      kind: "reorder",
      codes: ["fr", "en"],
    });

    expect(codesOf(next)).toEqual(["fr", "en"]);
  });

  it("makes another active language the default, and only an active one", () => {
    const next = planLanguageChange([en, fr], {
      kind: "setDefault",
      code: "fr",
    });
    expect(next.find(r => r.isDefault)?.code).toBe("fr");
    expect(next.filter(r => r.isDefault)).toHaveLength(1);

    const removed = planLanguageChange([en, fr], {
      kind: "remove",
      code: "fr",
    });
    expect(
      refusal(() =>
        planLanguageChange(removed, { kind: "setDefault", code: "fr" })
      )
    ).toMatch(/not one of/);
  });

  it("raises the revision of each row it changes, and only those", () => {
    const next = planLanguageChange([en, fr], {
      kind: "update",
      code: "fr",
      label: "Français",
    });

    expect(next.find(r => r.code === "fr")?.revision).toBe(2);
    expect(next.find(r => r.code === "en")?.revision).toBe(1);
  });
});
