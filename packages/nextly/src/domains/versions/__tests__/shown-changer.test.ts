/**
 * The one rule a changer is named by, wherever a reader of the document is
 * told who changed it: a person by the name their account gives now and
 * never by email, nobody once the account is gone, and anything else by its
 * kind; a kind this version does not know is not named at all, so the date
 * stands alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { people } = vi.hoisted(() => ({
  people: new Map<string, { kind: "person"; id: string; name: string }>(),
}));
vi.mock("../author-hydration", () => ({
  peopleById: vi.fn(async (ids: readonly (string | null | undefined)[]) => {
    const found = new Map<
      string,
      { kind: "person"; id: string; name: string }
    >();
    for (const id of ids) {
      if (id && people.has(id)) found.set(id, people.get(id)!);
    }
    return found;
  }),
}));

import { shownChanger } from "../stale-version";

beforeEach(() => {
  people.clear();
  people.set("u-ana", { kind: "person", id: "u-ana", name: "Ana Ruiz" });
});

const of = (
  kind: string,
  id: string | null = null,
  principalKind: string | null = null
) => ({
  kind,
  id,
  principalKind,
});

describe("shownChanger", () => {
  it("names a person by the name their account gives now, and nothing else", async () => {
    const shown = await shownChanger(of("person", "u-ana"), true);
    expect(shown).toEqual({ kind: "person", name: "Ana Ruiz" });
    expect(JSON.stringify(shown)).not.toContain("u-ana");
  });

  it("names nobody once the account is gone", async () => {
    expect(await shownChanger(of("person", "u-gone"), true)).toEqual({
      kind: "person",
      name: null,
    });
  });

  it("names an API key, a release, an agent and the system by their kind", async () => {
    for (const kind of ["apiKey", "release", "agent", "system"]) {
      expect(await shownChanger(of(kind, "k-1"), true)).toEqual({
        kind,
        name: null,
      });
    }
  });

  it("names a plugin's person by their kind alone", async () => {
    expect(await shownChanger(of("principal", null, "member"), true)).toEqual({
      kind: "principal",
      name: null,
      principalKind: "member",
    });
  });

  it("names nothing it does not know, so the date stands alone", async () => {
    expect(await shownChanger(of("plugin", "seo"), true)).toBeUndefined();
  });
});
