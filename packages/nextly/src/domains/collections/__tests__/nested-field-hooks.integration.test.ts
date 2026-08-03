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
const BADGES = "nestedhook_badges";

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
      // A related collection whose display label comes from a CONDITIONAL field:
      // `caption` is visible only while `hidden` is not "on". A parent hook can seal
      // a badge after it was labelled, flipping the label field to denied — the
      // reapply pass must then rebuild the label so it cannot carry the denied value.
      defineCollection({
        slug: BADGES,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({
            name: "caption",
            access: {
              read: ({ data }) =>
                (data as { hidden?: unknown } | undefined)?.hidden !== "on",
            },
          }),
          text({ name: "hidden" }),
        ],
      }),
      defineCollection({
        slug: ORGS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "name" }),
          // The org's OWN relationship. Expansion honours the depth left when it
          // reaches a row, so this is populated for an org reached one hop from the
          // document and a bare id for the same org reached two hops in.
          relationship({ name: "steward", relationTo: AUTHORS }),
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
              // A denied field on the repeater ROW, and an INVERSE sibling visible
              // only while `grade` is NOT "restricted". A restricted division
              // strips both. A hook that deep-clones the org and REORDERS this
              // repeater must not let the restricted row inherit a public row's
              // evidence by array position and fall open: repeater rows are matched
              // by id, not index, and an unmatchable clone row fails closed.
              text({ name: "grade", access: { read: () => false } }),
              text({
                name: "openTag",
                access: {
                  read: ({ data }) =>
                    (data as { grade?: unknown } | undefined)?.grade !==
                    "restricted",
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
            fields: [
              text({ name: "sealed", access: { read: () => false } }),
              // A NESTED inverse conditional: visible only while the denied nested
              // `sealed` is NOT "locked". A locked charter strips both; a deep-clone
              // drops the nested `sealed`, so a pass judging the clone without
              // transferring the SUBTREE evidence reads `undefined !== "locked"` and
              // falls open on the nested field — the root-only id bridge is not
              // enough.
              text({
                name: "openSeal",
                access: {
                  read: ({ data }) =>
                    (data as { sealed?: unknown } | undefined)?.sealed !==
                    "locked",
                },
              }),
            ],
          }),
          text({
            name: "emblem",
            access: {
              read: ({ data }) =>
                (data as { charter?: { sealed?: unknown } } | undefined)
                  ?.charter?.sealed === "yes",
            },
          }),
          // INVERSE conditional: visible only while the denied `classification` is
          // NOT "private". A private row strips both; a hook cloning it drops
          // `classification`, so a pass that judged the clone without restoring the
          // original evidence would read `undefined !== "private"` and fall OPEN.
          text({
            name: "openInfo",
            access: {
              read: ({ data }) =>
                (data as { classification?: unknown } | undefined)
                  ?.classification !== "private",
            },
          }),
          // A ROOT field whose INVERSE rule inspects a NESTED group value: visible
          // only while the denied `charter.sealed` is NOT "locked". The root access
          // snapshot can read the nested group, so a hook that replaces the charter
          // group (dropping `sealed`) would let the root rule read the sibling as
          // absent and fall open — which is why a reshaped subtree fails the ROOT
          // closed too, not just the replaced nested row.
          text({
            name: "orgCrest",
            access: {
              read: ({ data }) =>
                (data as { charter?: { sealed?: unknown } } | undefined)
                  ?.charter?.sealed !== "locked",
            },
          }),
          // A ROOT field whose INVERSE rule inspects the divisions REPEATER: visible
          // only while NO division is "restricted". A hook that REMOVES the
          // restricted division (a topology change the pristine check must catch)
          // and reintroduces this field would otherwise let it fall open.
          text({
            name: "orgRoster",
            access: {
              read: ({ data }) => {
                const divs = (data as { divisions?: unknown }).divisions;
                const arr = Array.isArray(divs) ? divs : [];
                return !arr.some(
                  d => (d as { grade?: unknown } | null)?.grade === "restricted"
                );
              },
            },
          }),
          // A self-relationship used to build a three-deep related chain
          // (author -> org -> sibling org) for the existing-child re-sanitization
          // test.
          relationship({ name: "sibling", relationTo: ORGS }),
          // A badge whose label is conditional; `sealBadge` flips it to denied.
          relationship({ name: "badge", relationTo: BADGES }),
          text({
            name: "sealBadge",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const badge = (data as { badge?: unknown }).badge;
                  if (badge && typeof badge === "object") {
                    (badge as Record<string, unknown>).hidden = "on";
                  }
                  return value;
                },
              ],
            },
          }),
          // Reintroduces the sibling org's denied `classification` IN PLACE during
          // THIS org's field-hook phase. The sibling is an already-sanitized,
          // already-visited child, so the post-hook re-descent skips it; its access
          // must be re-applied before this org unwinds to its parent's hooks.
          text({
            name: "reintroduceSibling",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const sibling = (data as { sibling?: unknown }).sibling;
                  if (sibling && typeof sibling === "object") {
                    (sibling as Record<string, unknown>).classification =
                      "reintroduced";
                  }
                  return value;
                },
              ],
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
          // Copies the row's OWN denied `dossier` onto an allowed field of the
          // same row. A direct read applies field access BEFORE the field hooks,
          // so this hook is handed a row without `dossier` and copies nothing;
          // reaching the row through a relationship must not be looser.
          text({
            name: "harvestOwn",
            hooks: {
              afterRead: [
                ({ data }) =>
                  ((data as Record<string, unknown>).dossier as
                    | string
                    | undefined) ?? null,
              ],
            },
          }),
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
          // Copies the org's BADGE's derived `label` (a grandchild of the author)
          // onto an allowed key, during the author's field-hook phase. If the org's
          // `sealBadge` hook flipped the badge's label field to denied and the reapply
          // did not rebuild the label, this would exfiltrate the denied caption.
          text({
            name: "harvestBadgeLabel",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const badge =
                    org && typeof org === "object"
                      ? (org as { badge?: unknown }).badge
                      : undefined;
                  (data as Record<string, unknown>).badgeLabel =
                    badge && typeof badge === "object"
                      ? (badge as { label?: unknown }).label
                      : undefined;
                  return value;
                },
              ],
            },
          }),
          // Copies the org's SIBLING's denied `classification` (a grandchild of the
          // author) onto an allowed key, during the author's field-hook phase —
          // which runs after the org's own hooks reintroduced it. Only re-applying
          // the sibling's access before the org unwinds keeps this from copying.
          text({
            name: "harvestSibling",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const org = (data as { organization?: unknown }).organization;
                  const sibling =
                    org && typeof org === "object"
                      ? (org as { sibling?: unknown }).sibling
                      : undefined;
                  (data as Record<string, unknown>).harvested =
                    sibling && typeof sibling === "object"
                      ? (sibling as { classification?: unknown }).classification
                      : undefined;
                  return value;
                },
              ],
            },
          }),
          // A target-collection FIELD hook that REPLACES this author's own
          // `organization` relationship with a freshly populated org carrying a
          // denied field, AFTER the walk already descended the original. The new
          // child missed that descent, so unless the walk descends again the source
          // collection's hooks could read its denied field and copy it out.
          text({
            name: "swapOrg",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  (data as Record<string, unknown>).organization = {
                    id: "swapped-org",
                    name: "swapped",
                    classification: "SECRET",
                  };
                  return value;
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
          // Declared BEFORE `author`, so the walk reaches this org one hop in and
          // the SAME org two hops in (via `author.organization`) afterwards.
          relationship({ name: "patronOrg", relationTo: ORGS }),
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
          // A field-level (last-phase) hook that copies the related author's
          // denied `dossier` onto an allowed source key. A code or stored hook
          // that reintroduces `dossier` on the author must be re-sanitized before
          // this phase runs, or the copy escapes the field-access system.
          text({
            name: "harvest",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  if (value !== "on") return value;
                  const author = (data as { author?: { dossier?: unknown } })
                    .author;
                  (data as Record<string, unknown>).leaked = author?.dossier;
                  return value;
                },
              ],
            },
          }),
          // A DENIED source field, and a source field hook that tries to copy it
          // onto its own allowed value. Access is applied before the field hooks, so
          // the hook cannot read `classified` even when selection would keep only
          // `exfil` — the denied sibling is not exposed to the hook.
          text({ name: "classified", access: { read: () => false } }),
          text({
            name: "exfil",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  const c = (data as { classified?: unknown }).classified;
                  return typeof c === "string" ? c : value;
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
          // A hasMany relationship: populated + serialized it is a JSON ARRAY
          // string, which a hook can hand back. The walk must decode that string
          // before it can reach the denied fields on the rows inside.
          relationship({
            name: "contributors",
            relationTo: AUTHORS,
            hasMany: true,
          }),
          // A relationship declaring its target as a ONE-ELEMENT ARRAY. It stores
          // and expands as the discriminated `{ relationTo, value }` pair, exactly
          // as a multi-target field does, so anything deciding that shape from the
          // NUMBER of declared targets reads this one as a bare row.
          relationship({ name: "sponsor", relationTo: [ORGS] }),
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

  it("re-derives a related row a hook clones, keeping an inverse rule closed", async () => {
    // `openInfo` is visible only while the denied `classification` is NOT
    // "private". A private org strips both. A source hook returns a CLONE of the
    // sanitized org (a new object) carrying `openInfo` but no `classification`.
    // The clone is discarded for the sanitized version, so the reintroduced field
    // is gone; judging the clone instead would read `undefined !== "private"` and
    // fall OPEN.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private" },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      if (author && org) {
        author.organization = { ...org, openInfo: "LEAKED" };
      }
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
    // Re-derived: the reintroduced inverse field is gone with the clone.
    expect(org!.openInfo).toBeUndefined();
    // And the sanitized row came back whole — re-derivation restores the org's
    // readable fields rather than denying the subtree on suspicion.
    expect(org!.name).toBe("acme");
  });

  it("discards a source hook's edit to a related row's allowed field", async () => {
    // A related row's presentation is its OWN collection's authority. The
    // response's related rows are rebuilt from the sanitized versions the walk
    // produced, so a source hook's write to one is discarded even when the field
    // it targets is perfectly readable — the same mechanism that discards a
    // reintroduced denied field, seen from the allowed side.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "ada" } });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      if (author) author.name = "HACKED";
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author.name).toBe("ada");
  });

  it("decodes a container a hook returns as a JSON string and sanitizes inside it", async () => {
    // A source hook returns `credits` as the JSON string SQLite stores it as, with
    // a populated editor it invented, carrying a denied field. Left a string there
    // is no relationship value to rebuild and the whole payload — `dossier`
    // included — reaches the response verbatim. Decoded, the invented row has no
    // sanitized version to restore (the read never expanded it), so it is reduced
    // to the bare reference it names and carries no fields at all.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "ed" } });
    const editorId = await onlyId(t, AUTHORS);
    await t.nextly.create({ collection: POSTS, data: { title: "p" } });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      entry.credits = JSON.stringify({
        editor: { id: editorId, name: "ed", dossier: "LEAKED" },
      });
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const credits = expanded.data!.credits as
      | Record<string, unknown>
      | undefined;
    expect(credits).toBeTruthy();
    // Reduced to the bare reference: an invented related row is never returned
    // populated, so nothing it carried can reach the caller.
    expect(credits!.editor).toBe(editorId);
    expect(JSON.stringify(credits)).not.toContain("LEAKED");
  });

  it("re-strips a password a source hook reintroduces under overrideAccess", async () => {
    // Password removal is unconditional, trusted reads included. A source hook
    // writes a password back onto a related row after the walk; under override the
    // authoritative pass was skipped, leaving it in the response.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      if (author) author.passwordHash = "$2yLEAKED";
      return entry;
    });

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

  it("re-strips a system-entity secret column a hook reintroduces", async () => {
    // A `users` target has no field registry, so the registry-based password strip
    // never sees its secret columns; they are stripped by name. A source hook can
    // reintroduce `passwordHash`, so the walk must re-strip it by column name.
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
      owner: { id: "u1", email: "owner@example.test", passwordHash: "$2yHASH" },
    };

    await service.applyNestedFieldHooks(doc, POSTS, {
      enforceFieldAccess: true,
    });

    const owner = doc.owner as Record<string, unknown>;
    expect(owner.passwordHash).toBeUndefined();
  });

  it("re-derives a deep-cloned relation, keeping a nested inverse rule closed", async () => {
    // `charter.openSeal` is visible only while the denied nested `charter.sealed`
    // is NOT "locked". A locked charter strips both. A source hook DEEP-clones the
    // org (charter included) and reintroduces openSeal. The clone is discarded for
    // the sanitized version, nested group included; judging the clone instead would
    // read `undefined !== "locked"` and fall OPEN at depth.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        charter: { sealed: "locked", openSeal: "visible" },
      },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      if (author && org) {
        const charter = (org.charter ?? {}) as Record<string, unknown>;
        author.organization = {
          ...org,
          charter: { ...charter, openSeal: "LEAKED" },
        };
      }
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const charter = org?.charter as Record<string, unknown> | undefined;
    expect(charter).toBeTruthy();
    // Re-derived: the reintroduced nested inverse field is gone with the clone.
    expect(charter!.openSeal).toBeUndefined();
    expect(org!.name).toBe("acme");
  });

  it("walks a relationship a target field hook swaps in before source hooks read it", async () => {
    // The author's `swapOrg` field hook REPLACES its organization with a fresh org
    // carrying denied `classification`, after the walk already descended the
    // original. A source POSTS hook then copies `author.organization.classification`
    // onto an allowed key. Only re-descending after the target field hooks strips
    // the swapped org before the source hook can read it.
    const t = await boot();
    await t.nextly.create({ collection: ORGS, data: { name: "acme" } });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, swapOrg: "on" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      entry.leaked = org?.classification;
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    // The swapped org's denied classification was stripped before the source hook
    // ran, so it copied nothing.
    expect(expanded.data!.leaked).toBeUndefined();
  });

  it("decodes a hasMany relationship a hook returns as a JSON string and sanitizes its rows", async () => {
    // A populated hasMany relationship serializes to a JSON array string, which a
    // hook can hand back. Left a string there is no relationship value to rebuild
    // and the denied `dossier` on each row reaches the response verbatim; decoded,
    // each invented row is reduced to the bare reference it names.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "c" } });
    const contributorId = await onlyId(t, AUTHORS);
    await t.nextly.create({ collection: POSTS, data: { title: "p" } });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      entry.contributors = JSON.stringify([
        { id: contributorId, name: "c", dossier: "LEAKED" },
      ]);
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    expect(expanded.data!.contributors).toEqual([contributorId]);
    expect(JSON.stringify(expanded.data!.contributors)).not.toContain("LEAKED");
  });

  it("hides a related row's denied field from its own field hooks", async () => {
    // A target collection's field hook runs against the row it belongs to. Given
    // the row unredacted, a hook on an ALLOWED field can read the DENIED one and
    // return it as its own value; the access pass afterwards removes the denied
    // field but not the copy, which then rides out on a field no rule protects.
    // A direct read of the same collection applies access before the hooks, so
    // expansion has to as well — it may be stricter than the target's own
    // endpoint, never looser.
    const t = await boot();
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", dossier: "SECRET" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    // The target's own endpoint: the hook never sees `dossier`.
    const direct = await handlerOf(t).getEntry({
      collectionName: AUTHORS,
      entryId: authorId,
      depth: 2,
    });
    expect(direct.data!.dossier).toBeUndefined();
    expect(direct.data!.harvestOwn).not.toBe("SECRET");

    // The same row reached through a relationship must match.
    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });
    const author = expanded.data!.author as Record<string, unknown>;
    expect(author.dossier).toBeUndefined();
    expect(author.harvestOwn).not.toBe("SECRET");
  });

  it("keeps the deeper occurrence of a row from flattening a shallower one", async () => {
    // The same org is reached one hop in (`patronOrg`) and two hops in
    // (`author.organization`). Expansion gives the one-hop occurrence its own
    // populated `steward` and leaves the two-hop occurrence a bare id, so the two
    // are the same row with different population shapes. Recording them under one
    // key lets the deeper, shallower-populated occurrence stand in for the direct
    // one, which would strip a level of expansion no hook ever touched.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "steward" } });
    const stewardId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", steward: stewardId },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId },
    });
    const listed = await handlerOf(t).listEntries({
      collectionName: AUTHORS,
      overrideAccess: true,
    });
    const authorId = String(listed.data!.docs.find(d => d.name === "ada")!.id);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", patronOrg: orgId, author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const patron = expanded.data!.patronOrg as Record<string, unknown>;
    expect(patron.id).toBe(orgId);
    // The one-hop occupant keeps the expansion its own depth earned.
    expect(typeof patron.steward).toBe("object");
    expect((patron.steward as Record<string, unknown>).id).toBe(stewardId);
  });

  it("keeps a one-target polymorphic relationship populated through re-derivation", async () => {
    // `relationTo: [ORGS]` declares a single target as an ARRAY, so the value is
    // stored and expanded as the discriminated pair. Reading that shape as a bare
    // row finds no id on the wrapper and drops the whole relationship, so the
    // response loses a value no hook ever touched.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", sponsor: { relationTo: ORGS, value: orgId } },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const sponsor = expanded.data!.sponsor as Record<string, unknown> | null;
    expect(sponsor).not.toBeNull();
    expect(sponsor!.relationTo).toBe(ORGS);
    const row = sponsor!.value as Record<string, unknown>;
    expect(row.id).toBe(orgId);
    expect(row.name).toBe("acme");
  });

  it("applies the target's field access inside a one-target polymorphic wrapper", async () => {
    // The row lives under `value`, so a walk that treats the wrapper as the row
    // evaluates the target's rules against an object holding only `relationTo`
    // and `value` — matching nothing, stripping nothing, and returning the
    // denied `classification` inside.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", sponsor: { relationTo: ORGS, value: orgId } },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const sponsor = expanded.data!.sponsor as Record<string, unknown>;
    const row = sponsor.value as Record<string, unknown>;
    expect(row.classification).toBeUndefined();
  });

  it("drops an unidentifiable row from a hasMany rather than leaving a gap", async () => {
    // A hook appends a populated contributor with no readable id to a hasMany
    // relationship. There is no reference to keep and no sanitized version to
    // restore, so the entry is dropped — the response must not carry a null
    // between the entries that did resolve, which no consumer of a relationship
    // list expects.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "c" } });
    const contributorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", contributors: [contributorId] },
    });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const contributors = entry.contributors as unknown[] | undefined;
      if (Array.isArray(contributors)) {
        contributors.push({ name: "ghost", dossier: "LEAKED" });
      }
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const contributors = expanded.data!.contributors as Record<
      string,
      unknown
    >[];
    expect(Array.isArray(contributors)).toBe(true);
    expect(contributors).toHaveLength(1);
    expect(contributors.every(row => row !== null && row !== undefined)).toBe(
      true
    );
    expect(contributors[0].id).toBe(contributorId);
    expect(JSON.stringify(contributors)).not.toContain("LEAKED");
  });

  it("re-derives a reordered cloned repeater, keeping an inverse rule closed", async () => {
    // `openTag` on a division is visible only while the denied `grade` is NOT
    // "restricted". A restricted division strips both. A source hook DEEP-clones
    // the org and REVERSES its divisions, reintroducing `openTag` on the restricted
    // row now sitting where a public row was. The clone is discarded for the
    // sanitized version, so no positional or id guess can hand the restricted row
    // the public row's evidence and let `openTag` fall open.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [
          { label: "pub", grade: "open" },
          { label: "sec", grade: "restricted", openTag: "topsecret" },
        ],
      },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      const divisions = org?.divisions as Record<string, unknown>[] | undefined;
      if (author && org && Array.isArray(divisions)) {
        const reordered = [...divisions].reverse().map(d => ({ ...d }));
        const restricted = reordered.find(d => d.label === "sec");
        if (restricted) restricted.openTag = "LEAKED";
        author.organization = { ...org, divisions: reordered };
      }
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    const restricted = divisions.find(d => d.label === "sec");
    expect(restricted).toBeTruthy();
    // Re-derived: the reintroduced `openTag` is gone with the reshaped clone.
    expect(restricted!.openTag).toBeUndefined();
    // The rows came back in the order the collection stored them, not the order
    // the hook left behind — the reordering did not survive either.
    expect(divisions.map(d => d.label)).toEqual(["pub", "sec"]);
  });

  it("re-derives a related-row clone that omits its id", async () => {
    // `openInfo` is visible only while the denied `classification` is NOT
    // "private". A private org strips both. A source hook returns a CLONE of the
    // sanitized org that carries `openInfo` but DROPS its id. The org is reached
    // through the author, whose own sanitized version is restored whole — so the
    // unidentifiable clone is discarded with everything else the hook left on it.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", classification: "private" },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      if (author && org) {
        const clone: Record<string, unknown> = { ...org, openInfo: "LEAKED" };
        delete clone.id;
        author.organization = clone;
      }
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
    // Re-derived: the reintroduced `openInfo` is gone with the clone, and the
    // identity the clone dropped is back.
    expect(org!.openInfo).toBeUndefined();
    expect(org!.id).toBe(orgId);
    expect(org!.name).toBe("acme");
  });

  it("decodes a relationship a hook returns as JSON with leading whitespace", async () => {
    // A populated relationship serialized to JSON can arrive with leading
    // whitespace (a pretty-printed hook return). The guard detects it by the first
    // non-whitespace character; otherwise the value stays a string and the denied
    // `dossier` inside reaches the response verbatim.
    const t = await boot();
    await t.nextly.create({ collection: AUTHORS, data: { name: "c" } });
    const contributorId = await onlyId(t, AUTHORS);
    await t.nextly.create({ collection: POSTS, data: { title: "p" } });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      entry.contributors =
        "\n  " +
        JSON.stringify([{ id: contributorId, name: "c", dossier: "LEAKED" }]);
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    expect(expanded.data!.contributors).toEqual([contributorId]);
    expect(JSON.stringify(expanded.data!.contributors)).not.toContain("LEAKED");
  });

  it("re-derives a nested row a hook replaces in place under an unchanged root", async () => {
    // A source hook keeps the related root object identical but REPLACES a row
    // inside its repeater, reintroducing an inverse-conditional field on the new
    // row. Keeping the root object identical does not preserve the replaced row:
    // the whole related row is re-derived, so the replacement never reaches the
    // response and the inverse field is not judged against a row that dropped its
    // denied sibling.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [{ label: "d", grade: "restricted", openTag: "topsecret" }],
      },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      const divisions = org?.divisions as Record<string, unknown>[] | undefined;
      if (Array.isArray(divisions) && divisions.length > 0) {
        // Same org object, same divisions array — only the row is swapped.
        divisions[0] = { label: "d", openTag: "LEAKED" };
      }
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    const divisions = (org?.divisions ?? []) as Record<string, unknown>[];
    expect(divisions[0]?.label).toBe("d");
    // Re-derived: the replacement row is gone, so the reintroduced inverse field
    // is too.
    expect(divisions[0]?.openTag).toBeUndefined();
  });

  it("re-sanitizes a related row a code hook reshapes before a later field hook reads it", async () => {
    // A code (entity-level) afterRead hook reintroduces a denied field on a
    // related row; a LATER field-level hook copies it onto an allowed source key.
    // The authoritative pass runs after EACH source phase, so the denied field is
    // stripped after the code hook and before the field hook can read it.
    const t = await boot();
    await t.nextly.create({ collection: ORGS, data: { name: "acme" } });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, dossier: "SECRET" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId, harvest: "on" },
    });
    const postId = await onlyId(t, POSTS);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      if (author) author.dossier = "SECRET";
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    // The field hook was handed a sanitized author, so it copied nothing.
    expect(expanded.data!.leaked).toBeUndefined();
    const author = expanded.data!.author as Record<string, unknown>;
    expect(author.dossier).toBeUndefined();
  });

  it("re-derives the root when a hook replaces a nested group a root rule inspects", async () => {
    // `orgCrest` (a ROOT field) is visible only while the denied `charter.sealed`
    // is NOT "locked"; the root's access snapshot can read the nested group. A
    // source hook keeps the org root in place but REPLACES its `charter` group with
    // a new object that drops `sealed` and reintroduces both protected fields. The
    // whole related row is re-derived, so the swapped group never reaches the
    // response and the root snapshot is never judged against a group that dropped
    // its denied sibling.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        charter: { sealed: "locked", openSeal: "visible" },
        orgCrest: "crest",
      },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      if (org) {
        // Same org object; only the charter GROUP is swapped for a new one that
        // drops `sealed` and reintroduces both protected fields.
        org.charter = { openSeal: "LEAKED" };
        org.orgCrest = "LEAKED";
      }
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    const org = author.organization as Record<string, unknown> | undefined;
    // The sanitized org denied both — `charter.sealed` is "locked" there — and it
    // is that version the response carries, not the hook's.
    expect(org!.orgCrest).toBeUndefined();
    const charter = org!.charter as Record<string, unknown> | undefined;
    if (charter) expect(charter.openSeal).toBeUndefined();
    expect(org!.name).toBe("acme");
  });

  it("re-sanitizes an existing grandchild a field hook reintroduces before an ancestor copies it", async () => {
    // Three-level related chain: author -> org -> sibling org. The org's
    // `reintroduceSibling` field hook mutates the already-sanitized sibling's denied
    // `classification` IN PLACE. The post-hook re-descent skips the sibling because
    // it is already visited, so without re-applying its access the value stays
    // visible while the org unwinds to the AUTHOR, whose `harvestSibling` hook copies
    // it onto an allowed key the later pass no longer looks at.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "sib", classification: "private" },
    });
    const siblingId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", sibling: siblingId, reintroduceSibling: "on" },
    });
    const orgId = (
      await handlerOf(t).listEntries({
        collectionName: ORGS,
        overrideAccess: true,
      })
    ).data!.docs.find(d => (d as { name?: string }).name === "acme")!
      .id as string;
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, harvestSibling: "on" },
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
      depth: 3,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    // The reintroduced grandchild field was re-stripped before the author's hook
    // ran, so it copied nothing.
    expect(author.harvested).toBeUndefined();
  });

  it("re-derives when a hook removes a nested row a root rule inspects", async () => {
    // `orgRoster` (a ROOT field) is visible only while NO division is "restricted".
    // Originally a restricted division denies it. A source hook keeps the org root
    // in place but REMOVES the restricted division from the repeater and reintroduces
    // `orgRoster`. Judging the hook's version would see no restricted division and
    // allow the reintroduced value — but the related row is re-derived, so the
    // removal never reaches the response.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: {
        name: "acme",
        divisions: [
          { label: "pub", grade: "open" },
          { label: "sec", grade: "restricted" },
        ],
      },
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

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      const org = author?.organization as Record<string, unknown> | undefined;
      const divisions = org?.divisions as Record<string, unknown>[] | undefined;
      if (org && Array.isArray(divisions)) {
        // Same org object; drop the restricted division and reintroduce the field.
        org.divisions = divisions.filter(d => d.label !== "sec");
        org.orgRoster = "LEAKED";
      }
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
    // Re-derived: the reintroduced `orgRoster` is gone, and the division the hook
    // removed is back — the sanitized row's topology is what the response carries.
    expect(org!.orgRoster).toBeUndefined();
    const divisions = (org!.divisions ?? []) as Record<string, unknown>[];
    expect(divisions.map(d => d.label)).toEqual(["pub", "sec"]);
  });

  it("rebuilds an existing child's label after reapplying access so an ancestor cannot copy it", async () => {
    // Three-level chain: author -> org -> badge. The badge's label comes from its
    // conditional `caption`. The org's `sealBadge` field hook flips the badge's
    // `hidden` so `caption` becomes denied AFTER the badge was labelled. The reapply
    // pass strips `caption`; unless it also rebuilds the label, the synthetic
    // `badge.label` still carries the denied caption, and the author's
    // `harvestBadgeLabel` hook copies it onto an allowed key.
    const t = await boot();
    await t.nextly.create({
      collection: BADGES,
      data: { caption: "TOPSECRET" },
    });
    const badgeId = await onlyId(t, BADGES);
    await t.nextly.create({
      collection: ORGS,
      data: { name: "acme", badge: badgeId, sealBadge: "on" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "ada", organization: orgId, harvestBadgeLabel: "on" },
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
      depth: 3,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    // The badge's label was rebuilt after its caption was denied, so the copy is
    // not the secret caption.
    expect(author.badgeLabel).not.toBe("TOPSECRET");
  });

  it("hides a denied source field from field hooks so a selection cannot expose it", async () => {
    // A denied SOURCE field `classified`, with a source field hook on the allowed
    // `exfil` that copies it. Selection keeps only `exfil`. Field access is applied
    // before the hooks, so the hook cannot read `classified` and copy it — the leak
    // that arose once selection moved to run after the field hooks.
    const t = await boot();
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", classified: "TOPSECRET", exfil: "safe" },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      select: { exfil: true },
    });

    // The hook could not read the denied `classified`, so `exfil` kept its own value.
    expect(expanded.data!.exfil).toBe("safe");
    // The denied field itself is absent.
    expect(expanded.data!.classified).toBeUndefined();
  });
});
