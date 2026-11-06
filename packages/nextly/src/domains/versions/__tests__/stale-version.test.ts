import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../../../errors";
import { NextlyError } from "../../../errors/nextly-error";
import {
  judgedLanguage,
  lastChangerOf,
  type PartState,
  releaseRunExemptFor,
  runAsReleaseRun,
  staleParts,
  versionCheckFor,
} from "../stale-version";

const person = (id: string) => ({ kind: "person", id, principalKind: null });
const part = (
  name: string,
  counter: number,
  changer: PartState["changer"],
  at: string | null
): PartState => ({
  part: name,
  counter,
  changer,
  at: at ? new Date(at) : null,
});

describe("versionCheckFor", () => {
  it("judges a version a read returned, in each spelling a read gives", () => {
    expect(versionCheckFor({ _rev: "7" }, { exempt: false })).toEqual({
      kind: "judge",
      raw: "7",
      given: { main: 7, languages: {} },
    });
    expect(
      versionCheckFor({ _rev: "7.en:2,es:0" }, { exempt: false })
    ).toMatchObject({
      kind: "judge",
      given: { main: 7, languages: { en: 2, es: 0 } },
    });
    expect(
      versionCheckFor({ _rev: "3.pt-BR:1" }, { exempt: false })
    ).toMatchObject({
      given: { languages: { "pt-BR": 1 } },
    });
    expect(
      versionCheckFor({ _rev: "3.zh_Hant:1" }, { exempt: false })
    ).toMatchObject({ given: { languages: { zh_Hant: 1 } } });
    // A code that is also an object's inherited property is an ordinary code.
    expect(
      versionCheckFor({ _rev: "3.constructor:1" }, { exempt: false })
    ).toMatchObject({ kind: "judge", given: { main: 3 } });
    const check = versionCheckFor({ _rev: "3.en:1" }, { exempt: false });
    expect(
      check.kind === "judge" && Object.hasOwn(check.given.languages, "toString")
    ).toBe(false);
    // Nor does a save in such a language find one the version never named.
    expect(() =>
      judgedLanguage(
        check.kind === "judge" ? check.given : undefined,
        "toString"
      )
    ).toThrow();
  });

  it("leaves a write that gives no version unjudged", () => {
    expect(versionCheckFor({ title: "a" }, { exempt: false })).toEqual({
      kind: "unjudged",
    });
    expect(versionCheckFor({ _rev: undefined }, { exempt: false })).toEqual({
      kind: "unjudged",
    });
  });

  it("refuses as a validation error anything that is not a version, exempt or not", () => {
    for (const rev of [
      "",
      "x",
      "0",
      "7.",
      "7.es",
      "7.es:1,es:2",
      "-1",
      "1.5",
      7,
      null,
      {},
    ]) {
      for (const exempt of [false, true]) {
        let thrown: unknown;
        try {
          versionCheckFor({ _rev: rev }, { exempt });
        } catch (error) {
          thrown = error;
        }
        expect(NextlyError.is(thrown) && thrown.code, JSON.stringify(rev)).toBe(
          "VALIDATION_ERROR"
        );
      }
    }
  });

  it("leaves an exempt write unjudged whatever version it gives", () => {
    expect(versionCheckFor({ _rev: "1" }, { exempt: true })).toEqual({
      kind: "unjudged",
    });
  });
});

describe("versionCheckFor and _overwrite", () => {
  const codeOf = (body: Record<string, unknown>) => {
    try {
      versionCheckFor(body, { exempt: false });
    } catch (error) {
      return NextlyError.is(error)
        ? { code: error.code, path: JSON.stringify(error.publicData) }
        : error;
    }
    return undefined;
  };

  it("overwrites with or without a version, and still decodes the version given", () => {
    expect(versionCheckFor({ _overwrite: true }, { exempt: false })).toEqual({
      kind: "overwrite",
    });
    expect(
      versionCheckFor({ _overwrite: true, _rev: "4.es:2" }, { exempt: false })
    ).toEqual({
      kind: "overwrite",
      given: { main: 4, languages: { es: 2 } },
    });
    expect(codeOf({ _overwrite: true, _rev: "four" })).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("judges as before when _overwrite is false or absent", () => {
    expect(
      versionCheckFor({ _overwrite: false, _rev: "4" }, { exempt: false })
    ).toMatchObject({ kind: "judge" });
    expect(versionCheckFor({ _overwrite: false }, { exempt: false })).toEqual({
      kind: "unjudged",
    });
  });

  it("refuses any other _overwrite, naming it", () => {
    for (const value of ["yes", "true", 1, 0, null, {}]) {
      const refused = codeOf({ _overwrite: value, _rev: "4" });
      expect(refused, JSON.stringify(value)).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect((refused as { path: string }).path).toContain("_overwrite");
    }
  });

  it("leaves an exempt overwrite unjudged", () => {
    expect(
      versionCheckFor({ _overwrite: true, _rev: "4" }, { exempt: true })
    ).toEqual({ kind: "unjudged" });
  });
});

describe("the release run's mark", () => {
  const entry = {
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId: "a",
  };

  it("exempts only the document it was pinned for, and only while it runs", () => {
    expect(releaseRunExemptFor(entry)).toBe(false);
    runAsReleaseRun(entry, () => {
      expect(releaseRunExemptFor(entry)).toBe(true);
      expect(releaseRunExemptFor({ ...entry, entryId: "b" })).toBe(false);
      expect(releaseRunExemptFor({ ...entry, scopeSlug: "pages" })).toBe(false);
      expect(
        releaseRunExemptFor({ scopeKind: "single", scopeSlug: "posts" })
      ).toBe(false);
    });
    expect(releaseRunExemptFor(entry)).toBe(false);
  });

  it("matches a Single on its slug alone", () => {
    runAsReleaseRun({ scopeKind: "single", scopeSlug: "home" }, () => {
      expect(
        releaseRunExemptFor({ scopeKind: "single", scopeSlug: "home" })
      ).toBe(true);
    });
  });
});

describe("staleParts", () => {
  const given = { main: 7, languages: { es: 3 } };
  const main = (counter: number) => part("main", counter, person("u"), null);

  it("finds the main row stale when its counter differs", () => {
    expect(staleParts(given, { main: main(7) })).toEqual([]);
    expect(staleParts(given, { main: main(8) })).toEqual(["main"]);
  });
});

describe("staleParts over several languages", () => {
  it("names each language row that moved from the version given, a missing one as 0", () => {
    const given = { main: 7, languages: { en: 2, es: 3 } };
    const row = (name: string, counter: number) =>
      part(name, counter, person("u"), null);
    expect(
      staleParts(given, {
        main: row("main", 7),
        languages: [row("en", 2), row("es", 3)],
      })
    ).toEqual([]);
    expect(
      staleParts(given, {
        main: row("main", 8),
        languages: [row("en", 2), row("es", 4), row("fr", 1)],
      })
    ).toEqual(["main", "es", "fr"]);
    expect(staleParts(given, { languages: [row("fr", 0)] })).toEqual([]);
  });
});

describe("lastChangerOf", () => {
  const given = { main: 7, languages: { en: 2, es: 3, fr: 1 } };

  it("names who moved the main row when only it moved", () => {
    const changer = lastChangerOf(
      [
        part("main", 8, person("ana"), "2026-11-04T10:00:00Z"),
        part("es", 3, person("ben"), "2026-11-04T11:00:00Z"),
      ],
      given
    );
    expect(changer).toMatchObject({ kind: "person", id: "ana", part: "main" });
  });

  it("names who moved the language when only it moved, though the main row is newer", () => {
    const changer = lastChangerOf(
      [
        part("main", 7, person("ana"), "2026-11-04T12:00:00Z"),
        part("es", 4, person("ben"), "2026-11-04T11:00:00Z"),
      ],
      given
    );
    expect(changer).toMatchObject({ id: "ben", part: "es" });
  });

  it("names the later of two parts that both moved", () => {
    const changer = lastChangerOf(
      [
        part("main", 8, person("ana"), "2026-11-04T10:00:00Z"),
        part("es", 4, person("ben"), "2026-11-04T11:00:00Z"),
      ],
      given
    );
    expect(changer).toMatchObject({ id: "ben" });
  });

  it("takes the latest of several language rows, the middle one here", () => {
    const changer = lastChangerOf(
      [
        part("main", 8, person("ana"), "2026-11-04T09:00:00Z"),
        part("en", 3, person("cleo"), "2026-11-04T10:00:00Z"),
        part("es", 4, person("ben"), "2026-11-04T12:00:00Z"),
        part("fr", 2, person("dan"), "2026-11-04T11:00:00Z"),
      ],
      given
    );
    expect(changer).toMatchObject({ id: "ben", part: "es" });
  });

  it("with no version given, takes the latest of every part", () => {
    const changer = lastChangerOf([
      part("main", 7, person("ana"), "2026-11-04T12:00:00Z"),
      part("es", 3, person("ben"), "2026-11-04T11:00:00Z"),
    ]);
    expect(changer).toMatchObject({ id: "ana", part: "main" });
  });

  it("orders equal times main first, then by language code, and a missing time oldest", () => {
    const same = "2026-11-04T10:00:00Z";
    expect(
      lastChangerOf(
        [
          part("fr", 2, person("dan"), same),
          part("es", 4, person("ben"), same),
          part("main", 8, person("ana"), same),
        ],
        given
      )
    ).toMatchObject({ id: "ana" });
    expect(
      lastChangerOf(
        [
          part("fr", 2, person("dan"), same),
          part("es", 4, person("ben"), same),
        ],
        given
      )
    ).toMatchObject({ id: "ben" });
    expect(
      lastChangerOf(
        [
          part("main", 8, person("ana"), null),
          part("es", 4, person("ben"), same),
        ],
        given
      )
    ).toMatchObject({ id: "ben" });
  });

  it("keeps a plugin-defined person by kind, with no id", () => {
    const changer = lastChangerOf(
      [
        part(
          "main",
          8,
          { kind: "principal", id: null, principalKind: "member" },
          "2026-11-04T10:00:00Z"
        ),
      ],
      given
    );
    expect(changer).toEqual({
      kind: "principal",
      id: null,
      principalKind: "member",
      at: new Date("2026-11-04T10:00:00Z"),
      part: "main",
    });
  });

  it("names nobody for a row unwritten since its changer was first recorded, or when nothing moved", () => {
    const nobody = { kind: null, id: null, principalKind: null };
    expect(lastChangerOf([part("main", 8, nobody, null)], given)).toBeNull();
    expect(
      lastChangerOf([part("main", 7, person("ana"), null)], given)
    ).toBeNull();
  });
});

describe("STALE_VERSION", () => {
  it("is a 409 of its own, never the lock's or history's CONFLICT", () => {
    const error = NextlyError.staleVersion({ data: { currentVersion: "8" } });
    expect(error.code).toBe("STALE_VERSION");
    expect(error.statusCode).toBe(409);
    expect(error.code).not.toBe("CONFLICT");
    expect(error.name).not.toBe("VersionConflictError");
    expect(NEXTLY_ERROR_STATUS.STALE_VERSION).toBe(409);
    expect(error.toResponseJSON("req-1")).toMatchObject({
      code: "STALE_VERSION",
      data: { currentVersion: "8" },
    });
  });
});
