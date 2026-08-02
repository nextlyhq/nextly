// A target collection's field `afterRead` hooks reach rows read through a
// relationship, and see those rows fully assembled.
//
// Expansion may be stricter than a target's own endpoint, never looser. A field
// masked when the collection is read directly has to stay masked when the same
// row arrives nested inside another document.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  group,
  relationship,
  password,
  repeater,
  text,
  upload,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const ORGS = "nestedhook_orgs";
const AUTHORS = "nestedhook_authors";
const POSTS = "nestedhook_posts";
const VAULTS = "nestedhook_vaults";

// How many times the target's token hook ran, for the selection test.
let tokenHookRuns = 0;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type ReadHandler = {
  listEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { docs: Record<string, unknown>[] } | null;
  }>;
  getEntry: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: Record<string, unknown> | null;
  }>;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as ReadHandler;
}

async function onlyId(t: TestNextly, collection: string): Promise<string> {
  const listed = await handlerOf(t).listEntries({
    collectionName: collection,
    overrideAccess: true,
  });
  return String(listed.data!.docs[0].id);
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      // Its only text field is denied, so the auto-selected display label is
      // built from a value the caller may not see — the setup for the label-copy
      // exfiltration test.
      defineCollection({
        slug: VAULTS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "codename", access: { read: () => false } })],
      }),
      defineCollection({
        slug: ORGS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "name" }),
          // Denied to everyone, and the evidence the author's `clearance` rule
          // masks on. Applying field rules at fetch removed it before that rule
          // could read it.
          text({
            name: "classification",
            access: { read: () => false },
          }),
          // Allowed ONLY while `classification` is present as evidence. Its rule
          // reads the row as `data`, so a later pass judging it against the
          // already-stripped row (where classification is gone) would wrongly deny
          // it — which is why each pass first RESTORES the values a prior pass
          // removed as evidence, then re-runs the rule against that restored row.
          text({
            name: "region",
            access: {
              read: ({ data }) =>
                (data as { classification?: unknown } | undefined)
                  ?.classification === "private",
            },
          }),
          // A repeater whose `code` is visible only for a public division. A
          // parent hook can append, or replace, a row here after the child's
          // first access pass; the row it introduces has no recorded verdict (it
          // is a new object), so the pass after the hooks must judge it fresh
          // rather than inherit the previous occupant's.
          repeater({
            name: "divisions",
            fields: [
              text({ name: "label" }),
              text({ name: "tier" }),
              text({
                name: "code",
                access: {
                  read: ({ data }) =>
                    (data as { tier?: unknown } | undefined)?.tier === "public",
                },
              }),
            ],
          }),
          // A group holding a denied field, beside a top-level sibling whose
          // visibility depends on that nested value. The nested read judges each
          // row twice — before and after the parent's hooks — and the second pass
          // snapshots the org row before descending to restore the group's
          // evidence, so re-judging `emblem` against the already-stripped group
          // would wrongly drop it. A direct read judges `emblem` once with the
          // group intact and keeps it; restoring the whole subtree's evidence
          // before the ancestor snapshot is what keeps the two reads in step.
          group({
            name: "charter",
            fields: [text({ name: "sealed", access: { read: () => false } })],
          }),
          text({
            name: "emblem",
            access: {
              read: ({ data }) =>
                (data as { charter?: { sealed?: unknown } } | undefined)
                  ?.charter?.sealed === "yes",
            },
          }),
        ],
      }),
      defineCollection({
        slug: AUTHORS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "name" }),
          relationship({ name: "organization", relationTo: ORGS }),
          // Masks based on the author's OWN relationship. At fetch time that
          // is still a raw id, so a hook run then reads `undefined` and lets
          // the secret through; only a fully assembled row masks correctly.
          // Masks unconditionally, so it is testable on the list path too --
          // batch expansion does not recurse into a related row's OWN
          // relationships, so a hook needing that evidence cannot mask there.
          password({ name: "passwordHash" }),
          // Denied to everyone. Unlike the org's `classification`, this sits on
          // the author itself, which a list read walks (a related row's own
          // relations are not expanded on a list), so it is the field a
          // source-hook re-contamination test uses on the list path.
          text({ name: "dossier", access: { read: () => false } }),
          // Writes a secret back after the fetch stripped it. Only a second
          // strip AFTER the hooks keeps it out of the response.
          text({
            name: "sneaky",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  (data as Record<string, unknown>).passwordHash = "$2yLEAKED";
                  return value;
                },
              ],
            },
          }),
          text({
            name: "token",
            hooks: {
              afterRead: [
                ({ value }) => {
                  tokenHookRuns++;
                  return typeof value === "string" && value.startsWith("HIDDEN")
                    ? `${value}HIDDEN`
                    : "HIDDEN";
                },
              ],
            },
          }),
          text({
            name: "secret",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  const org = (data as { organization?: unknown }).organization;
                  const classification =
                    typeof org === "object" && org !== null
                      ? (org as { classification?: unknown }).classification
                      : undefined;
                  return classification === "private" ? "REDACTED" : value;
                },
              ],
            },
          }),
          // Copies the org's denied `classification` value onto an allowed field
          // of its own. Only reachable when the parent's hook is handed the child
          // with that field still present, so it is the exfiltration a nested
          // read must not allow.
          text({
            name: "stolen",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  const org = (data as { organization?: unknown }).organization;
                  const classification =
                    typeof org === "object" && org !== null
                      ? (org as { classification?: unknown }).classification
                      : undefined;
                  return typeof classification === "string"
                    ? classification
                    : value;
                },
              ],
            },
          }),
          // Writes a denied field back ONTO the child after the child's access
          // pass has already removed it. Fires only when the field is present, so
          // a test opts in per row; a second access pass after all hooks must
          // strip what it reintroduced.
          text({
            name: "reintroducer",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  if (org && typeof org === "object") {
                    (org as Record<string, unknown>).classification =
                      "reintroduced";
                  }
                  return value;
                },
              ],
            },
          }),
          // Appends a NEW row to the nested org's `divisions` repeater after that
          // child's first access pass, so the appended row's denied `code` has no
          // recorded verdict and must be judged fresh by the pass after the hooks.
          text({
            name: "appender",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const divisions =
                    org && typeof org === "object"
                      ? (org as { divisions?: unknown }).divisions
                      : undefined;
                  if (Array.isArray(divisions)) {
                    divisions.push({ label: "added", code: "SNEAKED" });
                  }
                  return value;
                },
              ],
            },
          }),
          // REPLACES the org's first division with a private one carrying `code`
          // after the child's first pass. The replacement is a new object, so it
          // must not inherit the public original's "allowed" verdict by index.
          text({
            name: "replacer",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const divisions =
                    org && typeof org === "object"
                      ? (org as { divisions?: unknown }).divisions
                      : undefined;
                  if (Array.isArray(divisions) && divisions.length > 0) {
                    divisions[0] = {
                      label: "swapped",
                      tier: "private",
                      code: "SNEAKED",
                    };
                  }
                  return value;
                },
              ],
            },
          }),
          // MUTATES the org's first division IN PLACE (same object): flips it to
          // private and writes a fresh `code`. Object identity is unchanged, so a
          // cached verdict would let the new `code` through — only re-judging the
          // current content strips it.
          text({
            name: "mutator",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const divisions =
                    org && typeof org === "object"
                      ? (org as { divisions?: unknown }).divisions
                      : undefined;
                  const first =
                    Array.isArray(divisions) && divisions[0]
                      ? (divisions[0] as Record<string, unknown>)
                      : undefined;
                  if (first) {
                    first.tier = "private";
                    first.code = "MUTATED";
                  }
                  return value;
                },
              ],
            },
          }),
          // Flips the org's first division to public WITHOUT setting `code`. The
          // first pass removed `code` for the private division; the second pass
          // restores it only as evidence to re-judge the row, so the restored
          // value must not ride out in the response just because the flipped
          // condition now allows the field — the hook never supplied `code`.
          text({
            name: "tierflip",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const divisions =
                    org && typeof org === "object"
                      ? (org as { divisions?: unknown }).divisions
                      : undefined;
                  const first =
                    Array.isArray(divisions) && divisions[0]
                      ? (divisions[0] as Record<string, unknown>)
                      : undefined;
                  if (first) first.tier = "public";
                  return value;
                },
              ],
            },
          }),
          // A relationship whose target's only text field — and so its derived
          // display label — is DENIED. Expansion builds the label from the raw
          // value, then the access pass strips the field but the label lingers, so
          // a parent hook reading `data.vault.label` can copy the denied value
          // unless the label is rebuilt right after that access pass.
          relationship({ name: "vault", relationTo: VAULTS }),
          // Copies the nested vault's `label` onto an allowed field of its own,
          // the exfiltration the label rebuild must close.
          text({
            name: "vaultLabelCopy",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const vault = (data as { vault?: { label?: unknown } }).vault;
                  return typeof vault?.label === "string" ? vault.label : value;
                },
              ],
            },
          }),
        ],
      }),
      defineCollection({
        slug: POSTS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: AUTHORS }),
          // A source field-level afterRead hook that writes a denied field back
          // onto a related row. It runs after the related-row sanitization the
          // earlier rounds added, so only a pass after the field hooks strips it.
          text({
            name: "annotate",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const author = (data as { author?: unknown }).author;
                  if (author && typeof author === "object") {
                    (author as Record<string, unknown>).dossier = "LEAKED";
                  }
                  return value;
                },
              ],
            },
          }),
          // The blog template's shape: a relationship to the built-in users
          // entity, which has no dynamic-collection record.
          relationship({ name: "owner", relationTo: "users" }),
          // An upload: its `media` target is a built-in too, but not one
          // `isSystemEntity` knows about.
          upload({ name: "cover", relationTo: "media" }),
          // A relationship inside a container. Expansion populates it, so the
          // walk has to descend through the container to reach it.
          group({
            name: "credits",
            fields: [relationship({ name: "editor", relationTo: AUTHORS })],
          }),
        ],
      }),
    ],
  });
  return current;
}

async function seed(t: TestNextly): Promise<string> {
  await t.nextly.create({
    collection: ORGS,
    data: { name: "acme", classification: "private" },
  });
  const orgId = await onlyId(t, ORGS);
  await t.nextly.create({
    collection: AUTHORS,
    data: {
      name: "ada",
      organization: orgId,
      secret: "TOP_SECRET",
      token: "RAW_TOKEN",
    },
  });
  const authorId = await onlyId(t, AUTHORS);
  await t.nextly.create({
    collection: POSTS,
    data: { title: "p", author: authorId },
  });
  return await onlyId(t, POSTS);
}

describe("a target's field hooks apply to rows reached through a relationship", () => {
  it("masks on the target's own endpoint", async () => {
    // The control. Without it, a masked value through a relationship could
    // just as well mean the hook masks unconditionally.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);

    const direct = await handlerOf(t).getEntry({
      collectionName: AUTHORS,
      entryId: authorId,
      overrideAccess: true,
      depth: 1,
    });

    expect(direct.data!.secret).toBe("REDACTED");
  });

  it("masks the same row when it arrives nested in another document", async () => {
    const t = await boot();
    const postId = await seed(t);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The hook masked on the author's OWN relationship, which means it was
    // handed the row after that relationship had been expanded.
    expect(author.secret).toBe("REDACTED");
  });

  it("applies the target's field hooks to nested rows on a list too", async () => {
    // Asserted on a field whose hook needs no further expansion: the batch path
    // skips relationship fields when it recurses, so a related row's own
    // relations are never expanded on a list at any depth. What this pins is
    // that the walk reaches nested rows on the list path at all.
    const t = await boot();
    await seed(t);

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });

    const author = listed.data!.docs[0].author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.token).toBe("HIDDEN");
  });

  it("leaves the value alone when the nested evidence does not call for masking", async () => {
    // The mirror: the hook is reading real data, not masking everything it
    // touches. Without this the fix could be a hook that always redacts.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "open", classification: "public" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "bob", organization: orgId, secret: "VISIBLE" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "open post", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author.secret).toBe("VISIBLE");
  });

  it("reaches a relationship nested inside a container", async () => {
    // The walk reads a collection's fields; a `group` has no `relationTo` of
    // its own, so a walk that only looked at top-level relationship fields left
    // everything inside a container unmasked.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "credited", credits: { editor: authorId } },
    });

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });
    const withCredits = listed.data!.docs.find(
      d => (d as { title?: string }).title === "credited"
    ) as Record<string, unknown>;
    const credits = withCredits.credits as Record<string, unknown>;
    const editor = credits.editor as Record<string, unknown>;

    expect(editor).toBeTruthy();
    expect(editor.token).toBe("HIDDEN");
  });

  it("transforms a row shared by several parents exactly once", async () => {
    // Batch expansion hands the SAME object to every parent referencing it. A
    // per-entry traversal runs its hooks once per reference, so a transform
    // that is not idempotent compounds with the reference count and every
    // parent sees the compounded value.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "second", author: authorId },
    });

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });

    expect(listed.data!.docs.length).toBeGreaterThan(1);
    for (const doc of listed.data!.docs) {
      const author = (doc as { author?: unknown }).author as Record<
        string,
        unknown
      >;
      // "HIDDEN", not "HIDDENHIDDEN" -- the marker of a second pass.
      expect(author.token).toBe("HIDDEN");
    }
  });

  it("walks a populated system-entity target without failing the read", async () => {
    // `users` has no dynamic-collection record, so the schema lookup finds
    // nothing. Reading that as an untrustworthy lookup and refusing turned an
    // ordinary expansion -- the blog template's `author -> users` -- into an
    // internal error. A system entity registers no field hooks, so there is
    // nothing to fail closed over.
    //
    // Driven through the walk directly with an already-expanded document: that
    // is the state the failure occurs in, and `users` cannot be seeded through
    // the collections API.
    const t = await boot();
    const service = t.getService("relationshipService") as unknown as {
      applyNestedFieldHooks: (
        entry: Record<string, unknown>,
        collection: string,
        access: Record<string, unknown>
      ) => Promise<void>;
    };

    const doc = {
      title: "owned",
      owner: { id: "u1", email: "owner@example.test" },
    };

    await expect(
      service.applyNestedFieldHooks(doc, POSTS, { enforceFieldAccess: true })
    ).resolves.toBeUndefined();
  });
  it("does not look up or log an upload's built-in target", async () => {
    // `media` is not a registered collection, so resolving it costs a metadata
    // query per row only to fail, and logs the failure -- on reads that are
    // otherwise fine. Uploads are close to universal, so that is a query and an
    // error line on most reads in production.
    const t = await boot();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = t.getService("relationshipService") as unknown as {
      applyNestedFieldHooks: (
        entry: Record<string, unknown>,
        collection: string,
        access: Record<string, unknown>
      ) => Promise<void>;
    };

    const doc = {
      title: "illustrated",
      cover: { id: "m1", filename: "cover.png" },
    };

    await expect(
      service.applyNestedFieldHooks(doc, POSTS, { enforceFieldAccess: true })
    ).resolves.toBeUndefined();
    // The read succeeding is not enough: it succeeded before this too, after
    // paying for the lookup and shouting about it.
    expect(logged).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
  it("strips a secret a hook wrote back onto a related row", async () => {
    // The fetch strips a target's password before the hooks run, and a hook on
    // a sibling field can put one back. The response-level defenses sanitize
    // only the ROOT row, using the SOURCE collection's schema, so they never
    // look at this row -- the strip has to happen here.
    const t = await boot();
    await seed(t);
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.passwordHash).toBeUndefined();
  });

  it("runs a target's hooks even for a relationship the projection drops", async () => {
    // Skipping those rows would leave them on the document unmasked while the
    // source collection's own hooks run, which is the leak the placement above
    // exists to close. It could not be skipped coherently in any case: batch
    // expansion shares one row object between parents, so a row reachable
    // through both a kept and a dropped relationship would come out masked or
    // not depending on which reference the traversal met first.
    const t = await boot();
    await seed(t);

    tokenHookRuns = 0;
    await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
      select: { title: true },
    });

    expect(tokenHookRuns).toBeGreaterThan(0);
  });

  it("hands a parent's hooks a nested child with its denied fields already removed", async () => {
    // `classification` denies read. A parent hook that reads it — to copy it out
    // (`stolen`) or to mask a sibling on it (`secret`) — must be handed the child
    // with that field already gone, or the copy leaks it under an allowed key and
    // outlives the child's own redaction. Applying each child's field access
    // before its parent's hooks is what a direct read does; the nested walk now
    // matches it.
    //
    // The deliberate trade-off: a hook can no longer mask on a caller-denied
    // field, because it can no longer see one. A value that must stay hidden
    // needs an access rule keyed on the caller, not a hook reading data the
    // caller cannot see.
    //
    // Read WITHOUT overrideAccess: field rules are skipped for a trusted read, so
    // an overriding caller is handed the complete row either way.
    const t = await boot();
    const postId = await seed(t);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The exfiltration is closed: the copy hook was handed a child whose denied
    // field had already been removed, so it copied nothing.
    expect(author.stolen).not.toBe("private");
    // The denied field is absent from the response itself.
    const org = author.organization as Record<string, unknown> | undefined;
    if (org) expect(org.classification).toBeUndefined();
    // Same cause, visible from the other hook: it could not read the classification
    // either, so it did not mask — the value it tried to guard on that basis is
    // returned unchanged. Masking must not depend on data the caller cannot see.
    expect(author.secret).toBe("TOP_SECRET");
  });

  it("re-strips a denied child field a parent hook reintroduces after the first pass", async () => {
    // The first access pass (during the walk) removes the child's denied field
    // before the parent's hooks run. A parent hook can still write it back onto
    // the child afterward — to mask or derive a value — so a second access pass
    // after every hook is what keeps that reintroduced field out of the response.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      // `reintroducer` present, so its hook fires and reassigns the org's denied
      // `classification` after the first pass stripped it.
      data: { name: "ada", organization: orgId, reintroducer: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    // The second pass removed the value the hook wrote back — not "reintroduced".
    if (org) expect(org.classification).toBeUndefined();
  });

  it("keeps a field whose access depended on a denied sibling, evidence restored", async () => {
    // `region` is allowed only while `classification` is present; `classification`
    // is denied. The first pass judges `region` against the complete row (keeps
    // it) and removes `classification`. Every later pass must RESTORE the removed
    // `classification` as evidence and re-run the rule against the restored row,
    // not re-judge `region` against the stripped row — that would wrongly deny it,
    // unlike a direct read where the sibling is still present.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private", region: "emea" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    expect(org).toBeTruthy();
    // Kept: every pass re-ran the rule with its evidence restored.
    expect(org!.region).toBe("emea");
    // The denied sibling is still withheld.
    expect(org!.classification).toBeUndefined();
  });

  it("keeps an outer field whose access reads a denied value nested in a group", async () => {
    // `emblem` is allowed only while the group's denied `sealed` is present as
    // evidence; `sealed` denies read. A direct read judges `emblem` once, with
    // the group intact, and keeps it. The nested read judges twice — before and
    // after the parent's hooks — and the second pass snapshots the org row before
    // descending to restore the group, so unless the whole subtree's evidence is
    // restored FIRST it sees the stripped group and wrongly drops `emblem`.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", charter: { sealed: "yes" }, emblem: "crest" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    expect(org).toBeTruthy();
    // Kept: judged with the group's evidence intact, as a direct read would.
    expect(org!.emblem).toBe("crest");
    // The denied nested field is still withheld from the response.
    const charter = org!.charter as Record<string, unknown> | undefined;
    if (charter) expect(charter.sealed).toBeUndefined();
  });

  it("judges a repeater row a parent hook appends after the first pass", async () => {
    // The first pass strips the denied `code` from the existing division. A
    // parent hook then appends a NEW division carrying its own `code`. That row
    // has no removed-evidence recorded against it, so the pass after the hooks
    // judges it against its own content and strips its `code` — nothing about the
    // existing rows lets the appended one inherit an "allowed" outcome.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [{ label: "core", code: "ORIGINAL" }],
      },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      // `appender` present, so its hook fires and pushes a division onto the org.
      data: { name: "ada", organization: orgId, appender: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    // The hook's row landed...
    expect(divisions.some(d => d.label === "added")).toBe(true);
    // ...and NO division exposes `code`, including the appended one.
    for (const division of divisions) {
      expect(division.code).toBeUndefined();
    }
  });

  it("re-judges a repeater row a parent hook replaces with a stricter one", async () => {
    // The original division is public, so its `code` is allowed on the first
    // pass. A parent hook then REPLACES it with a private division carrying
    // `code`. Keying the verdict by array index would hand the replacement the
    // original's "allowed" result and leak it; keyed by object identity, the
    // replacement (a new object) is judged fresh and its `code` is stripped.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [{ label: "public-div", tier: "public", code: "OK" }],
      },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, replacer: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    // The replacement landed...
    expect(divisions[0]?.label).toBe("swapped");
    // ...and its `code`, denied for a private division, did not ride in on the
    // public original's verdict.
    expect(divisions[0]?.code).toBeUndefined();
  });

  it("re-judges a row a parent hook mutates in place", async () => {
    // The division is public, so its `code` is allowed on the first pass. A hook
    // then flips the SAME object to private and rewrites `code`. Object identity
    // is unchanged, so reusing the earlier "allowed" verdict would leak the new
    // code; only re-judging the current content denies it.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [{ label: "d", tier: "public", code: "OK" }],
      },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, mutator: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    // The mutation landed (now private)...
    expect(divisions[0]?.tier).toBe("private");
    // ...and the `code` the hook wrote is denied for a private division.
    expect(divisions[0]?.code).toBeUndefined();
  });

  it("withholds a denied field a hook only unlocks by flipping its condition", async () => {
    // The first pass removes the private division's denied `code`. A parent hook
    // then flips only `tier` to public, never supplying `code`. The second pass
    // restores `code` so it can re-judge the row against the same evidence a
    // direct read would, but that restored value is the one the caller was denied
    // and the hook never reintroduced — it must be withheld again rather than
    // returned just because the flipped condition now allows the field.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [{ label: "d", tier: "private", code: "SECRET" }],
      },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, tierflip: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    // The hook's flip landed...
    expect(divisions[0]?.tier).toBe("public");
    // ...but the denied `code`, restored only as evidence and never supplied by
    // the hook, does not ride out in the response.
    expect(divisions[0]?.code).toBeUndefined();
  });

  it("masks a dropped relationship before a source hook can copy out of it", async () => {
    // The projection removes `author` from the response, but the row is still
    // on the document while the source collection's hooks run. One of them can
    // read the target's raw value and write it to a field that IS projected,
    // which no later masking looks at.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      entry.summary = author?.token;
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
      select: { summary: true },
    });

    expect(expanded.data!.author).toBeUndefined();
    expect(expanded.data!.summary).toBe("HIDDEN");
  });

  it("judges a masking rule on the whole target row, not the projected slice", async () => {
    // Field selection rebuilds each related row as a fresh object holding only
    // the projected paths. A rule masking on a sibling -- here the author's
    // organization -- handed that slice reads `undefined` for its evidence and
    // returns the value unmasked, so asking for exactly the protected field is
    // what gets it.
    const t = await boot();
    const postId = await seed(t);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
      select: { "author.secret": true },
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.secret).toBe("REDACTED");
  });

  it("masks a related row before the source collection's own hooks see it", async () => {
    // A source hook can copy a related row's value onto a root property of its
    // own. The traversal masks the nested field it walked, never the copy, so a
    // source hook handed an unmasked target publishes it under a key nothing
    // downstream sanitizes.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      entry.leaked = author?.token;
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    // The masked value, not the stored "RAW_TOKEN": the hook was handed a row
    // the target's own protections had already run on.
    expect(expanded.data!.leaked).toBe("HIDDEN");
  });

  it("re-sanitizes a related row a source collection hook re-contaminates", async () => {
    // The related-row field-access pass runs BEFORE the source collection's own
    // code/stored afterRead hooks. One of those hooks can write a denied field
    // straight back onto an already-sanitized related row
    // (`entry.author.organization.classification`), and the root field-access
    // pass knows only the SOURCE collection's schema, so it never descends into
    // the related row to strip it. A field-access pass AFTER the source hooks
    // re-sanitizes the related rows and keeps the denied value out.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      if (org) org.classification = "LEAKED";
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    expect(org).toBeTruthy();
    // The source hook's write-back was stripped by the pass after the hooks.
    expect(org!.classification).toBeUndefined();
  });

  it("re-sanitizes a related row a source hook re-contaminates on a list read", async () => {
    // The same re-contamination on the list path, whose source hooks run after
    // its own finalize pass at a different call site than the detail path's. A
    // list read walks the immediate `author` but not the author's OWN relations,
    // so the denied field lives on the author itself here.
    const t = await boot();
    await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const rows = (Array.isArray(ctx.data) ? ctx.data : [ctx.data]) as Record<
        string,
        unknown
      >[];
      for (const entry of rows) {
        const author = entry.author as Record<string, unknown> | undefined;
        if (author) author.dossier = "LEAKED";
      }
      return ctx.data;
    });

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      depth: 2,
    });

    const author = listed.data!.docs[0].author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The source hook's write-back onto the related author was stripped by the
    // pass after the hooks.
    expect(author.dossier).toBeUndefined();
  });

  it("re-sanitizes related rows a source hook returns in a reshaped document", async () => {
    // A source afterRead hook may RETURN a new document (the hook registry
    // supports reshaping the response), so the response can hold related rows that
    // are new objects the walk never queued. Sanitizing only the queued rows would
    // miss them; the authoritative pass re-walks the ACTUAL response.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      // A RESHAPED clone whose author is a NEW object carrying a denied field.
      return { ...entry, author: { ...(author ?? {}), dossier: "LEAKED" } };
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The denied field on the hook's replacement object was stripped too.
    expect(author.dossier).toBeUndefined();
  });

  it("re-sanitizes a related row a source field hook writes to", async () => {
    // A source collection FIELD-level afterRead hook runs after the related-row
    // sanitization the earlier rounds added; it too can write a denied target
    // field onto a related row, so the authoritative pass must run after the field
    // hooks, not only after the code and stored hooks.
    const t = await boot();
    await t.nextly.create({ collection: ORGS, data: { name: "acme" } });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      // `annotate` present, so its field hook fires and writes the denied field.
      data: { title: "p", author: authorId, annotate: "on" },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.dossier).toBeUndefined();
  });

  it("rebuilds a related row's label before a parent hook can copy it", async () => {
    // `vault`'s only text field — and so its derived label — is DENIED. Expansion
    // builds the label from the raw value; the access pass strips the field but
    // the derived label lingers. A parent hook copying `data.vault.label` would
    // exfiltrate the denied value unless the label is rebuilt right after that
    // access pass, before the parent's hooks run.
    const t = await boot();
    await t.nextly.create({
      collection: VAULTS,
      data: { codename: "TOPSECRET" },
    });
    const vaultId = await onlyId(t, VAULTS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", vault: vaultId, vaultLabelCopy: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The copied label is not the denied `codename` value.
    expect(author.vaultLabelCopy).not.toBe("TOPSECRET");
    // And the nested vault's own label was rebuilt off a value the caller may see.
    const vault = author.vault as Record<string, unknown> | undefined;
    if (vault) expect(vault.label).not.toBe("TOPSECRET");
  });
});
