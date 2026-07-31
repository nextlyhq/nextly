/**
 * The record has to be trustworthy, because everything downstream stops
 * guessing only if it can rely on what is stored.
 *
 * Two properties carry the weight. A marker that exists but cannot be read must
 * refuse rather than read as absent, since absence means "no copy has run" and
 * acting on that wrongly either duplicates a copy or labels content with a
 * language nobody recorded. And the recorded source locale must be immovable,
 * because relabelling existing values is the data loss this exists to prevent.
 *
 * No database: the store is the two `nextly_meta` methods, so the state machine
 * is exercised directly.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { MetaEntry } from "../../meta/services/meta-service";

import {
  I18N_TRANSITION_MARKER_VERSION,
  beginI18nTransition,
  forgetI18nTransition,
  readI18nTransitionState,
  recordI18nRestore,
  settleI18nTransition,
  type TransitionStateStore,
} from "./transition-state";

/** In-memory `nextly_meta`, distinguishing an absent row from one holding null. */
function fakeStore(seed: Record<string, unknown> = {}): TransitionStateStore & {
  rows: Map<string, unknown>;
} {
  const rows = new Map<string, unknown>(Object.entries(seed));
  return {
    rows,
    getEntry<T>(key: string): Promise<MetaEntry<T>> {
      if (!rows.has(key)) return Promise.resolve({ present: false });
      return Promise.resolve({ present: true, value: rows.get(key) as T });
    },
    set(key: string, value: unknown): Promise<void> {
      rows.set(key, value);
      return Promise.resolve();
    },
    // Refuses to overwrite, exactly as the conflict clause does. A fake that just wrote would
    // certify a claim the database does not actually make, which is the whole property under test.
    insertIfAbsent(key: string, value: unknown): Promise<void> {
      if (!rows.has(key)) rows.set(key, value);
      return Promise.resolve();
    },
    // Compares the serialised form, exactly as the database does in its WHERE clause. A fake that
    // compared by reference would report a match the real store never makes.
    compareAndSet(
      key: string,
      expected: unknown,
      next: unknown
    ): Promise<boolean> {
      if (!rows.has(key)) return Promise.resolve(false);
      if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) {
        return Promise.resolve(false);
      }
      rows.set(key, next);
      return Promise.resolve(true);
    },
    delete(key: string): Promise<void> {
      rows.delete(key);
      return Promise.resolve();
    },
  };
}

const validMarker = (over: Record<string, unknown> = {}) => ({
  version: I18N_TRANSITION_MARKER_VERSION,
  status: "enabling",
  sourceLocale: "en",
  ...over,
});

describe("readI18nTransitionState", () => {
  it("reports an absent row as untracked", async () => {
    const store = fakeStore();

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toEqual({ status: "untracked" });
  });

  it("keeps a collection and a single with the same slug apart", async () => {
    // Both kinds may legitimately use one slug, and only one of them may have
    // transitioned. Sharing a record would seed or skip the wrong entity.
    const store = fakeStore();
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "about",
      sourceLocale: "en",
    });

    await expect(
      readI18nTransitionState(store, "single", "about")
    ).resolves.toEqual({ status: "untracked" });
  });

  it("refuses a row that exists but holds null", async () => {
    // Written by us and no longer readable. Reading it as absent would re-owe a
    // copy that may already have run.
    const store = fakeStore({ "i18n.transition.collection.posts": null });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).rejects.toThrow(NextlyError);
  });

  it("refuses a marker from an unsupported version", async () => {
    const store = fakeStore({
      "i18n.transition.collection.posts": validMarker({ version: 99 }),
    });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).rejects.toThrow(NextlyError);
  });

  it("refuses a marker with no source locale", async () => {
    // The locale is the record's reason for existing: without it the copy is
    // back to guessing which language the main columns hold.
    const store = fakeStore({
      "i18n.transition.collection.posts": validMarker({ sourceLocale: "" }),
    });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).rejects.toThrow(NextlyError);
  });

  it("refuses a marker with an unknown status", async () => {
    const store = fakeStore({
      "i18n.transition.collection.posts": validMarker({ status: "halfway" }),
    });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).rejects.toThrow(NextlyError);
  });
});

describe("beginI18nTransition", () => {
  it("records the source locale so a later default cannot relabel content", async () => {
    const store = fakeStore();

    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
    });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", sourceLocale: "de" });
  });

  it("writes a marker its own reader accepts", async () => {
    // A writer that can persist something the reader refuses strands the entity
    // with no way forward, so the round trip is the assertion.
    const store = fakeStore();

    await beginI18nTransition(store, {
      kind: "fieldGroup",
      slug: "hero",
      sourceLocale: "en",
    });

    await expect(
      readI18nTransitionState(store, "fieldGroup", "hero")
    ).resolves.toMatchObject({ status: "enabling" });
  });

  it("is idempotent for a retry with the same source locale", async () => {
    // A transition that failed partway is expected to be retried, and the
    // language the main values are in has not changed between attempts.
    const store = fakeStore();
    const args = {
      kind: "collection" as const,
      slug: "posts",
      sourceLocale: "en",
    };

    await beginI18nTransition(store, args);
    // The token identifies the claim, so a retry that takes the transition over gets its own.
    await expect(beginI18nTransition(store, args)).resolves.toEqual(
      expect.any(String)
    );
  });

  it("refuses a retry that names a different source locale", async () => {
    const store = fakeStore();
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await expect(
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "fr",
      })
    ).rejects.toThrow(NextlyError);
  });

  it("refuses to re-owe a copy that already finished", async () => {
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token,
    });

    await expect(
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "en",
      })
    ).rejects.toThrow(NextlyError);
  });

  it("refuses an empty source locale", async () => {
    const store = fakeStore();

    await expect(
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "",
      })
    ).rejects.toThrow(NextlyError);
  });

  it("claims the first record instead of writing over a concurrent one", async () => {
    // Two processes provisioning the same entity — a `db:sync` and a dev server, or two dev
    // servers — both read `untracked` before either writes. A plain write would let the one that
    // loses the companion CREATE still record the language, so the record would name a locale the
    // seed never used. The claim is refused instead, and the caller learns it did not win.
    const store = fakeStore();
    const winner = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
    });
    // Interleaved deliberately: `loser` reads before `winner` has written, which is the window.
    const loser = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await expect(winner).resolves.toEqual(expect.any(String));
    await expect(loser).rejects.toThrow(NextlyError);
    // The claim stands, so the copy and the record agree on one language.
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", sourceLocale: "de" });
  });

  it("refuses a concurrent claim that agrees about the locale", async () => {
    // Two callers reading one configuration necessarily agree about the language, so agreement
    // says nothing about who holds the transition. Accepting it lets both run the work — and for
    // a re-enable that work is a destructive refresh, whose second pass lands after the winner
    // has settled and copies stale main-table values over translations written since.
    const store = fakeStore();

    const outcomes = await Promise.allSettled([
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "en",
      }),
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "en",
      }),
    ]);

    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(o => o.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(NextlyError);
    // One holder, and the record names it.
    const held = await readI18nTransitionState(store, "collection", "posts");
    expect(held).toMatchObject({ status: "enabling", sourceLocale: "en" });
    expect(held.status === "untracked" ? undefined : held.owner).toEqual(
      expect.any(String)
    );
  });

  it("claims a restored entity too, rather than writing over a concurrent re-enable", async () => {
    // A default-locale rollout is when this bites: two processes both read `restored` and both
    // re-enable. An unconditional write would let each proceed under its own locale, labelling one
    // main table's content as two languages while the marker records whichever landed last.
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token,
    });
    await recordI18nRestore(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    // Interleaved deliberately: both read `restored` before either writes.
    const winner = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
    });
    const loser = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "fr",
    });

    await expect(winner).resolves.toEqual(expect.any(String));
    await expect(loser).rejects.toThrow(NextlyError);
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", sourceLocale: "de" });
  });

  it("refuses a same-locale re-enable that lost the race for a restored entity", async () => {
    // The destructive case. A companion that outlived a disable holds stale rows, so re-enabling
    // overwrites them from main — and two processes doing that from one configuration agree about
    // the locale, which is all the loser used to check. It would then run the overwrite a second
    // time, after the winner had settled and a translator had edited what it seeded.
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token,
    });
    await recordI18nRestore(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    // Interleaved deliberately: both read `restored` before either writes, and both name the
    // configured default.
    const first = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    const second = beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(o => o.status === "rejected")?.reason).toBeInstanceOf(
      NextlyError
    );
  });

  it("claims a marker written before claims carried a token", async () => {
    // Markers already in `nextly_meta` have no owner. Refusing to take one over would strand every
    // entity mid-transition at the moment this build ships, so an absent token means unheld — the
    // conditional write decides, as it always did.
    const store = fakeStore({
      "i18n.transition.collection.posts": {
        version: I18N_TRANSITION_MARKER_VERSION,
        status: "restored",
        sourceLocale: "en",
      },
    });

    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
    });

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", sourceLocale: "de" });
  });

  it("remembers that a claim owes a destructive refresh", async () => {
    // The fact that a re-enable must OVERWRITE the surviving companion rows lives in the state it
    // claims FROM — `restored` — and claiming replaces that state with `enabling`. A run that
    // crashes in between would otherwise leave a marker indistinguishable from an ordinary
    // unfinished seed, and the retry would do the guarded insert, skip the stale rows, and settle
    // over them.
    const store = fakeStore();
    const first = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token: first,
    });
    await recordI18nRestore(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
      refresh: true,
    });
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", refresh: true });

    // And a takeover recovering that abandoned claim keeps the debt rather than downgrading it.
    const recovering = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "de",
    });
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", refresh: true });

    // Settling clears it: the work it described has been done.
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token: recovering,
    });
    const settled = await readI18nTransitionState(store, "collection", "posts");
    expect(
      settled.status === "untracked" ? undefined : settled.refresh
    ).toBeUndefined();
  });

  it("refuses a slug containing a dot", async () => {
    // The key joins its parts with dots, so a dotted slug could collide with a
    // different kind-and-slug pair and put two entities on one record.
    const store = fakeStore();

    await expect(
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts.en",
        sourceLocale: "en",
      })
    ).rejects.toThrow(NextlyError);
  });
});

describe("settleI18nTransition", () => {
  it("keeps the source locale recorded at the start", async () => {
    // Settling must not re-derive the locale: the copy labelled rows with what
    // `begin` recorded, and the record has to keep describing what happened.
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      sourceLocale: "de",
    });

    await settleI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      token,
    });

    await expect(
      readI18nTransitionState(store, "single", "homepage")
    ).resolves.toMatchObject({ status: "seeded", sourceLocale: "de" });
  });

  it("ignores a settlement from a claim that was taken over", async () => {
    // Taking an `enabling` transition over is how a crashed run gets finished, and nothing in the
    // row can tell an abandoned claim from an active one. What makes that safe is this: the holder
    // that was displaced finishes its own copy and tries to settle, and its settlement names a
    // claim that no longer exists. Honouring it would tell the next enable that a copy nobody
    // supervised had completed, and the taker's own work would never be recorded.
    const store = fakeStore();
    const displaced = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    const holder = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    expect(holder).not.toEqual(displaced);

    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token: displaced,
    });

    // Still owed, and still the taker's.
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", owner: holder });

    // And the holder can still settle its own.
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token: holder,
    });
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "seeded" });
  });

  it("refuses to settle a transition that never began", async () => {
    const store = fakeStore();

    await expect(
      settleI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        // No claim to name, because nothing ever began one.
        token: undefined,
      })
    ).rejects.toThrow(NextlyError);
  });

  it("is idempotent", async () => {
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token,
    });
    // Reports success the second time, not a takeover: the marker keeps the owner across the move,
    // so a settlement can tell its own finished work from someone else's claim.
    await expect(
      settleI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        token,
      })
    ).resolves.toBe(true);
  });

  it("reports a settlement whose claim was taken over", async () => {
    // The seed-side twin of the restore case. A run told nothing here goes on to report success,
    // and the schema apply that follows may drop the main-table columns whose values the new
    // claimant has not copied anywhere yet.
    const store = fakeStore();
    const displaced = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await expect(
      settleI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        token: displaced,
      })
    ).resolves.toBe(false);
  });
});

describe("recordI18nRestore", () => {
  it("reports a settlement that lost, rather than swallowing it", async () => {
    // The copy has ALREADY written main by the time this runs. If another transition established
    // something while it ran, the conditional write matches nothing — and a caller told nothing
    // would go on to publish a non-localized configuration over a record that disagrees, leaving
    // the next enable to trust a companion that no longer describes the main table.
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      token,
    });

    // Based on what the copy saw before it ran, which is no longer what the row holds.
    await expect(
      recordI18nRestore(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "en",
        expect: { status: "enabling", sourceLocale: "en", owner: token },
      })
    ).resolves.toBe(false);

    // And reports success when it does win.
    await expect(
      recordI18nRestore(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "en",
        expect: { status: "seeded", sourceLocale: "en", owner: token },
      })
    ).resolves.toBe(true);
  });
});

describe("forgetI18nTransition", () => {
  it("lets a recreated slug record its own source locale", async () => {
    // The key is kind plus slug, which a later entity can reuse. Without forgetting, a new entity
    // inherits its predecessor's locale and `begin` refuses the real one — after the new
    // companion has already been created and seeded.
    const store = fakeStore();
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await forgetI18nTransition(store, "collection", "posts");

    await expect(
      beginI18nTransition(store, {
        kind: "collection",
        slug: "posts",
        sourceLocale: "fr",
      })
    ).resolves.toEqual(expect.any(String));
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toMatchObject({ status: "enabling", sourceLocale: "fr" });
  });

  it("releases a settled entity too, so disabling does not block re-enabling", async () => {
    // After a disable there is no companion and the values are back on main. The transition the
    // record describes no longer exists, and keeping it blocks the next legitimate one.
    const store = fakeStore();
    const token = await beginI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      token,
    });

    await forgetI18nTransition(store, "single", "homepage");

    await expect(
      readI18nTransitionState(store, "single", "homepage")
    ).resolves.toEqual({ status: "untracked" });
  });

  it("is not an error when there was no record", async () => {
    // Absent is the state it produces, so producing it twice is not a failure.
    const store = fakeStore();

    await expect(
      forgetI18nTransition(store, "fieldGroup", "never_localized")
    ).resolves.toBeUndefined();
  });
});
