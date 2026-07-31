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
    ).resolves.toEqual({ status: "enabling", sourceLocale: "de" });
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
    await expect(beginI18nTransition(store, args)).resolves.toBeUndefined();
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
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, { kind: "collection", slug: "posts" });

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

    await expect(winner).resolves.toBeUndefined();
    await expect(loser).rejects.toThrow(NextlyError);
    // The claim stands, so the copy and the record agree on one language.
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toEqual({ status: "enabling", sourceLocale: "de" });
  });

  it("lets a concurrent claim naming the same locale through", async () => {
    // Losing the race is only a problem when the winner recorded something else. Two callers
    // reading the same configured default agree about the language, so failing the second would
    // turn an ordinary two-process dev setup into a hard error.
    const store = fakeStore();

    await Promise.all([
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

    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toEqual({ status: "enabling", sourceLocale: "en" });
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
    await beginI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      sourceLocale: "de",
    });

    await settleI18nTransition(store, { kind: "single", slug: "homepage" });

    await expect(
      readI18nTransitionState(store, "single", "homepage")
    ).resolves.toEqual({ status: "seeded", sourceLocale: "de" });
  });

  it("refuses to settle a transition that never began", async () => {
    const store = fakeStore();

    await expect(
      settleI18nTransition(store, { kind: "collection", slug: "posts" })
    ).rejects.toThrow(NextlyError);
  });

  it("is idempotent", async () => {
    const store = fakeStore();
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "posts",
      sourceLocale: "en",
    });

    await settleI18nTransition(store, { kind: "collection", slug: "posts" });
    await expect(
      settleI18nTransition(store, { kind: "collection", slug: "posts" })
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
    await expect(
      readI18nTransitionState(store, "collection", "posts")
    ).resolves.toEqual({ status: "enabling", sourceLocale: "fr" });
  });

  it("releases a settled entity too, so disabling does not block re-enabling", async () => {
    // After a disable there is no companion and the values are back on main. The transition the
    // record describes no longer exists, and keeping it blocks the next legitimate one.
    const store = fakeStore();
    await beginI18nTransition(store, {
      kind: "single",
      slug: "homepage",
      sourceLocale: "en",
    });
    await settleI18nTransition(store, { kind: "single", slug: "homepage" });

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
