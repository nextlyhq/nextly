import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../../../errors";
import { NextlyError } from "../../../errors/nextly-error";
import {
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

  it("judges a language after this save's write: the given counter plus its own", () => {
    const after = (counter: number) => ({
      locale: "es",
      state: part("es", counter, person("u"), null),
      bumped: true,
    });
    expect(staleParts(given, { languageAfterWrite: after(4) })).toEqual([]);
    expect(staleParts(given, { languageAfterWrite: after(5) })).toEqual(["es"]);
    // A first translation: the version gave 0, and this save's insert made 1.
    expect(
      staleParts(
        { main: 7, languages: { es: 0 } },
        {
          languageAfterWrite: {
            locale: "es",
            state: part("es", 1, person("u"), null),
            bumped: true,
          },
        }
      )
    ).toEqual([]);
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
