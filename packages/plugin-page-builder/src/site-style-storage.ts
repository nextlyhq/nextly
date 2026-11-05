/**
 * Where a site's style edits persist: the plugin-owned Site Style single.
 *
 * One global document — versioned, access-controlled, written through the
 * ordinary single write path — holding the stored tier of the site style that
 * `site-style.ts` layers over the config-supplied defaults. The arrangement is
 * WordPress's theme.json + global-styles pairing: the code states a baseline,
 * the stored document carries what admins changed, and one merge point
 * resolves them.
 *
 * The section checkers live in `site-style-record`, which reads a stored
 * document with the same rules these validators write by; this module is the
 * server half — the single's schema, its fail-closed write validation, and
 * the per-request loader a published route calls.
 *
 * Node-safe: no React, no admin imports. The single's validators run
 * server-side on every write.
 *
 * @module @nextlyhq/plugin-page-builder/site-style-storage
 */
import { isPlainRecord, type SpacingMode } from "@nextlyhq/blocks-engine";
import { defineSingle, json, type SingleConfig } from "nextly/config";
import { NextlyError } from "nextly/errors";

import {
  openRemovalFor,
  type OpenRemovalReader,
} from "./breakpoint-removal/lock-acceptance";
import { stripClass } from "./breakpoint-removal/strip";
import { documentVersionOf } from "./document-version";
import type { StoredSiteStyle } from "./library-contract";
import { resolveSiteStyle, type SiteStyleData } from "./site-style";
import {
  checkStoredBreakpoints,
  checkStoredClasses,
  checkStoredFonts,
  checkStoredTokens,
  readSiteStyleRecord,
  type SectionCheck,
  type SectionPolicy,
} from "./site-style-record";
import {
  spacingModeReaderOf,
  type SpacingModeReader,
} from "./spacing-mode-reader";
import { readStoredJson } from "./stored-json";

/** The single the stored tier lives in. One document per site, by design. */
export const SITE_STYLE_SLUG = "site-style";

/**
 * A field `validate` that fails closed over one section checker.
 *
 * Any issue refuses the write — including the entries the shape check had to
 * exclude, which each carry an issue of their own — so nothing that would be
 * silently narrowed on read can be stored in the first place. An absent value
 * is an empty section, exactly as for every other optional field.
 */
const refusing =
  (check: (raw: unknown) => SectionCheck<unknown>) =>
  (value: unknown): string | true => {
    if (value === null || value === undefined) return true;
    const { issues } = check(value);
    return issues.length === 0 ? true : issues.join(" ");
  };

/** The mark the Settings route puts on its own write. */
const SITE_SETTINGS_WRITE = "pageBuilder.siteSettingsWrite";

/**
 * The context the Settings route writes the site's breakpoints with: the one
 * write {@link refuseBreakpointsOutsideSettings} lets change them.
 */
export const SITE_SETTINGS_WRITE_CONTEXT: Readonly<Record<string, unknown>> = {
  [SITE_SETTINGS_WRITE]: true,
};

/** What any other write that changes the site's breakpoints is told. */
export const BREAKPOINTS_OUTSIDE_SETTINGS =
  "The site's breakpoints are changed in the page builder's Settings.";

/**
 * A JSON value with every object's keys in one order, so two values holding
 * the same thing compare equal however they were stored: Postgres `jsonb`
 * reorders keys, and an unchanged set sent back by a form must not read as a
 * change.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/** Whether two stored values hold the same thing, whatever their key order. */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(canonical(a ?? null)) ===
    JSON.stringify(canonical(b ?? null))
  );
}

/**
 * Refuse a write to this Single that changes its breakpoints, unless the
 * Settings route made it.
 *
 * The breakpoints have one door: redefining the site's devices needs the site
 * permission, which the route asks for. This hook could not ask it itself,
 * since core answers a permission here only for the content verbs, and two
 * places judging who may change them would be two answers that drift.
 *
 * A write that names the breakpoints without changing them passes, as does
 * server code acting as nobody (the Direct API, an import), which is trusted
 * to say what the site is.
 */
export function refuseBreakpointsOutsideSettings(hook: {
  data?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
  user?: { id: string };
  principal?: unknown;
  context?: Record<string, unknown>;
}): void {
  if (hook.context?.[SITE_SETTINGS_WRITE] === true) return;
  const data = hook.data;
  if (data === undefined || !Object.hasOwn(data, "breakpoints")) return;
  if (sameStoredValue(data.breakpoints, hook.originalData?.breakpoints)) return;
  if (hook.user === undefined && hook.principal === undefined) return;
  throw new NextlyError({
    code: "FORBIDDEN",
    publicMessage: BREAKPOINTS_OUTSIDE_SETTINGS,
    logContext: { reason: "site-breakpoints-outside-settings" },
  });
}

/** The mark the shared-style lock route puts on its own write. */
const SHARED_STYLE_LOCK_WRITE = "pageBuilder.sharedStyleLockWrite";

/**
 * The context the lock route writes with: the one write that may lock or
 * unlock a shared style.
 */
export const SHARED_STYLE_LOCK_WRITE_CONTEXT: Readonly<
  Record<string, unknown>
> = { [SHARED_STYLE_LOCK_WRITE]: true };

/** What a write that moves a lock outside the lock route is told. */
const LOCK_OUTSIDE_ITS_ROUTE =
  "A shared style is locked and unlocked with its own action, which needs the permission to lock shared styles.";

/** A stored or sent class list, by id: only entries that carry one. */
function classEntriesById(raw: unknown): Map<string, Record<string, unknown>> {
  const entries = new Map<string, Record<string, unknown>>();
  // SQLite hands a JSON column back as text; the other dialects as values.
  const list = readStoredJson(raw);
  if (!Array.isArray(list)) return entries;
  for (const entry of list) {
    if (!isPlainRecord(entry) || typeof entry.id !== "string") continue;
    // The first entry with an id is the one the compiler applies, so it is
    // the one a lock holds.
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }
  return entries;
}

/** The name a refusal calls a shared style by: its name, else its slug. */
export function sharedStyleName(entry: Record<string, unknown>): string {
  if (typeof entry.label === "string" && entry.label.trim() !== "") {
    return entry.label;
  }
  return typeof entry.slug === "string" ? entry.slug : "This shared style";
}

function refusedOnClasses(message: string, reason: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "classes", code: "INVALID_VALUE", message }],
    logContext: { reason },
  });
}

function lockOutsideItsRoute(): NextlyError {
  return refusedOnClasses(
    LOCK_OUTSIDE_ITS_ROUTE,
    "shared-style-lock-outside-route"
  );
}

/**
 * Whether a write changes a locked entry. Still locked after the write, the
 * entry must come back as it was; an unlock through the lock route is the one
 * change a locked entry takes. While a breakpoint removal is open, the
 * settings write may bring it back with exactly the removed breakpoints'
 * values stripped (`removed`), and no other way.
 */
function lockedEntryChanged(
  was: Record<string, unknown>,
  now: Record<string, unknown> | undefined,
  removed: ReadonlySet<string> | undefined
): boolean {
  if (now === undefined) return true;
  if (now.locked !== true || sameStoredValue(was, now)) return false;
  return (
    removed === undefined || !sameStoredValue(stripClass(was, removed), now)
  );
}

/**
 * Refuse what a write does to one stored entry: a locked one changed or
 * removed by anyone, or a lock moved outside the lock route. `now` is the
 * entry as written, absent if removed.
 *
 * An unlocked entry may be removed by a whole-list write: undoing the making
 * of a style writes the section back without it. Checking that nothing uses a
 * style before it goes needs a usage index that has counted every page, which
 * a site holding blocks in Singles does not have yet; the remove route makes
 * that check, and refuses while the index is not whole.
 */
function refuseStoredEntryChange(
  id: string,
  was: Record<string, unknown>,
  now: Record<string, unknown> | undefined,
  lockRoute: boolean,
  removed: ReadonlySet<string> | undefined
): void {
  const wasLocked = was.locked === true;
  if (wasLocked && lockedEntryChanged(was, now, removed)) {
    throw NextlyError.conflict({
      reason: "state",
      message: `${sharedStyleName(was)} is locked, so it can't be changed, renamed or removed. Unlock it first.`,
      logContext: { classId: id },
    });
  }
  if (now === undefined) return;
  if (wasLocked !== (now.locked === true) && !lockRoute) {
    throw lockOutsideItsRoute();
  }
}

/**
 * Refuse a write to this Single that changes or removes a locked shared style,
 * or moves a lock outside the lock route.
 *
 * A locked style holds for everyone, whatever they may otherwise change: its
 * styles, name and slug stay as they are, and it is not removed, until someone
 * allowed to lock shared styles unlocks it through the route that asks for
 * that permission. The lock is a fact about the style rather than about the
 * caller, so the refusal is a conflict naming the style, not a permission
 * error.
 *
 * An unlocked style may still be removed by a whole-list write, which is how
 * an undo of making one is written. The remove route is the editor's delete:
 * it checks, just before it writes, that the usage index is whole and that
 * nothing uses the style.
 *
 * Applying a style to a block, detaching it and overriding it on one block are
 * page writes, which never reach this Single, so a lock does not stop them.
 *
 * Server code acting as nobody (the Direct API, an import) is trusted, as for
 * the breakpoints.
 */
export function refuseSharedStyleChangesOutsideTheirRoutes(
  hook: {
    data?: Record<string, unknown>;
    originalData?: Record<string, unknown>;
    user?: { id: string };
    principal?: unknown;
    context?: Record<string, unknown>;
  },
  /**
   * The breakpoints an open removal is stripping, for the settings write that
   * strips them; absent for every other write, and where none is open.
   */
  removed?: ReadonlySet<string>,
  /**
   * The code's classes, which that write may store a stripped override of: a
   * locked one comes in as a new stored entry already locked.
   */
  supplied?: ReadonlyMap<string, unknown>
): void {
  const data = hook.data;
  if (data === undefined || !Object.hasOwn(data, "classes")) return;
  if (hook.user === undefined && hook.principal === undefined) return;
  const lockRoute = hook.context?.[SHARED_STYLE_LOCK_WRITE] === true;
  const before = classEntriesById(hook.originalData?.classes);
  const after = classEntriesById(data.classes);
  for (const [id, was] of before) {
    refuseStoredEntryChange(id, was, after.get(id), lockRoute, removed);
  }
  for (const [id, now] of after) {
    // A style written already locked is a lock moved outside its route,
    // except the removal's override of a locked code class: exactly that
    // class with the removed breakpoints' values stripped.
    if (!before.has(id) && now.locked === true && !lockRoute) {
      const code = supplied?.get(id);
      const stripped =
        removed !== undefined &&
        code !== undefined &&
        sameStoredValue(stripClass(code, removed), now);
      if (!stripped) throw lockOutsideItsRoute();
    }
  }
}

/**
 * The shared-style guard as the Single runs it. The settings write, and only
 * it, is judged with the open breakpoint removal's ids, read from the
 * plugin's own table: a locked style may come back stripped of exactly those.
 * Where the removal cannot be read, nothing extra is accepted.
 */
function sharedStyleGuard(
  openRemoval: OpenRemovalReader | undefined,
  supplied: SiteStyleData["classes"]
): (
  hook: Parameters<typeof refuseSharedStyleChangesOutsideTheirRoutes>[0]
) => Promise<void> {
  return async hook => {
    const settingsWrite = hook.context?.[SITE_SETTINGS_WRITE] === true;
    const touchesClasses =
      hook.data !== undefined && Object.hasOwn(hook.data, "classes");
    // The settings route writes the Single on its own, never inside a
    // transaction, so its write may read the removal on the pool.
    const removal =
      settingsWrite && touchesClasses
        ? await openRemovalFor(openRemoval, { inTransaction: false })
        : null;
    refuseSharedStyleChangesOutsideTheirRoutes(
      hook,
      removal?.ids,
      new Map((supplied ?? []).map(entry => [entry.id, entry]))
    );
  };
}

/**
 * The Site Style single: the one global, versioned, access-controlled
 * document a site's stored style edits live in.
 *
 * - `versions: true`, because a site's whole look changes in one write and a
 *   restorable history is the difference between an experiment and an
 *   accident.
 * - NO code-defined access block, so read and update alike fall through to the
 *   `read-site-style` / `update-site-style` permissions seeded with the single.
 *   A published render is unaffected: it reads through the Direct API, whose
 *   `overrideAccess` default returns before any rule is consulted.
 * - Plain `json` fields rather than structured ones, because the shapes are
 *   the ENGINE's contracts and the style studios that will edit them write
 *   whole sections at a time; a field-per-property schema here would be a
 *   third statement of shapes two packages already agree on.
 */
export function siteStyleSingle(
  policy: SectionPolicy = {},
  /** The open breakpoint removal, which a locked shared style may be stripped by. */
  openRemoval?: OpenRemovalReader
): SingleConfig {
  return defineSingle({
    slug: SITE_STYLE_SLUG,
    label: { singular: "Site Style" },
    versions: true,
    // A precondition, so before validation: a refused write learns where the
    // change is made rather than what is wrong with a value it may not set.
    hooks: {
      beforeValidate: [
        refuseBreakpointsOutsideSettings,
        sharedStyleGuard(openRemoval, policy.defaults?.classes),
      ],
    },
    // No `access` block, deliberately: read and update both fall through to
    // the `read-site-style` / `update-site-style` permissions seeded with the
    // single and granted to super_admin, so a role reaches this document only
    // by being given one.
    //
    // A code-defined read rule cannot serve the anonymous render it would be
    // written for. A signed-in check refuses an absent user before consulting
    // any rule, singles are not public endpoints, and the published page does not
    // use the route at all — `loadSiteStyle` reads through the Direct API,
    // whose `overrideAccess` default returns from `checkSingleAccess` before
    // the rule is reached. What such a rule DOES reach is every authenticated
    // principal, returning ahead of the permission lookup, and the `read`
    // action spans more than the published document: the version list, a
    // version, a version diff and the autosave recovery point all resolve to
    // `read` on this slug. None of those is emitted into a public page.
    admin: {
      icon: "Palette",
      description:
        "Site-wide design tokens, fonts, classes and breakpoints for pages built from blocks.",
    },
    fields: [
      json({
        name: "tokens",
        label: "Design tokens",
        validate: refusing(raw => checkStoredTokens(raw, policy)),
        admin: {
          description:
            'A token set: { tokens: [{ id?, name, label?, kind, values: { light, dark? } }], prefix?, darkMode? }. Values are per mode; "light" is what a reader with no mode set resolves. `id` is the token\'s stable identity — set it once and a later rename of `name` leaves every page that references the token working; omit it and the name is the identity.',
        },
      }),
      json({
        name: "fonts",
        label: "Font faces",
        validate: refusing(checkStoredFonts),
        admin: {
          description:
            "Self-hosted @font-face definitions: [{ family, src: [{ url, format? }], weight?, style? }]. Files must live on this site.",
        },
      }),
      json({
        name: "classes",
        label: "Named classes",
        // The one section whose gate is given the site's host policy: a class
        // is emitted verbatim into every public page's sheet, so a `url()`
        // stored here is fetched by every visitor. Tokens reach the page as a
        // `var()` substitution, which is why their own gate is the last place
        // a URL can be stopped and this one is the last place a class's can.
        validate: refusing(raw => checkStoredClasses(raw, policy)),
        admin: {
          description:
            "Reusable style presets: [{ id, slug, label?, orderIndex, styles, locked? }]. Documents reference a class by id; a later orderIndex overrides an earlier one. `label` is the name authors see; `locked: true` holds the class as it is until it is unlocked.",
        },
      }),
      json({
        name: "breakpoints",
        label: "Breakpoints",
        validate: refusing(checkStoredBreakpoints),
        admin: {
          description:
            "The site's breakpoints: { viewport: [{ id, label, maxWidth? }], container: [...] }. Ids must be unique across both axes; the base breakpoint has no maxWidth.",
        },
      }),
    ],
  });
}

/**
 * The one read a route needs: the stored single. Structural rather than the
 * generated reader type, because the generated single-slug union is the HOST
 * app's — it may not exist yet when this plugin is being wired, and this
 * document's slug is the plugin's to know.
 */
export interface SiteStyleReader {
  findSingle(args: {
    slug: string;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  /**
   * The plugin services the Direct API offers, where the site's spacing model
   * is read (it lives in the plugin's own table, not in the Single). Optional:
   * a reader without it reads no model, and the engine's default applies.
   */
  readonly plugins?: Readonly<
    Record<string, Readonly<Record<string, unknown>> | undefined>
  >;
}

/**
 * The stored document's four sections exactly as stored, each `null` where
 * nothing is stored, and nothing else the row carries (its id, timestamps or
 * any field a host added), with the site's recorded spacing model beside them.
 */
function storedSiteStyleOf(
  doc: unknown,
  spacingMode: SpacingMode | null
): StoredSiteStyle {
  const record =
    typeof doc === "object" && doc !== null
      ? (doc as Record<string, unknown>)
      : {};
  return {
    tokens: record.tokens ?? null,
    fonts: record.fonts ?? null,
    classes: record.classes ?? null,
    breakpoints: record.breakpoints ?? null,
    spacingMode,
  };
}

/**
 * The stored site style: the one server-side read of the document, which the
 * published render layers over the defaults ({@link loadSiteStyle}) and the
 * editor's route answers as it is.
 *
 * Read with whatever access posture the reader has, unless `overrideAccess` is
 * set. Only the editor's route sets it, after deciding who may ask: every
 * published page compiles these sections into the CSS a visitor is served.
 * The published render does not, so a host handing it a reader that enforces
 * access keeps that enforcement.
 */
export async function readStoredSiteStyle(args: {
  nextly: SiteStyleReader;
  /** The Single's RESOLVED slug, where a host renamed it. */
  slug?: string;
  /** Read past the Single's own read permission. */
  overrideAccess?: true;
  /**
   * Where to read the model when `nextly` offers no plugin services: a server
   * path hands the booted instance's reader (`spacing-mode-booted`). Handed in
   * rather than imported, so this module stays safe for a browser entry.
   */
  bootedReader?: () => Promise<SpacingModeReader | undefined>;
}): Promise<StoredSiteStyle> {
  return (await readStoredSiteStyleVersioned(args)).stored;
}

/**
 * The stored site style, and the Single's version as the same read gave it,
 * for a write made from that read to send back.
 */
export async function readStoredSiteStyleVersioned(
  args: Parameters<typeof readStoredSiteStyle>[0]
): Promise<{ stored: StoredSiteStyle; rev: string | undefined }> {
  // Read beside the Single, so every reader of the stored style, the
  // published render and the editor's route alike, compiles under the model
  // the site recorded.
  const readDoc = () =>
    args.nextly.findSingle({
      slug: args.slug ?? SITE_STYLE_SLUG,
      ...(args.overrideAccess === true ? { overrideAccess: true } : {}),
    });
  const own = spacingModeReaderOf(args.nextly);
  if (own !== undefined) {
    const [doc, spacingMode] = await Promise.all([readDoc(), own.read()]);
    return {
      stored: storedSiteStyleOf(doc, spacingMode),
      rev: documentVersionOf(doc),
    };
  }
  // The booted instance only AFTER the document read: a lazy reader boots
  // the instance on its first read, and asked before that there is none, so
  // the page would render with no model.
  const doc = await readDoc();
  const booted = await args.bootedReader?.();
  return {
    stored: storedSiteStyleOf(
      doc,
      booted === undefined ? null : await booted.read()
    ),
    rev: documentVersionOf(doc),
  };
}

/**
 * The site style a published route serves: config defaults with the stored
 * document layered on top, ready to hand to a route helper's `siteStyles`.
 *
 * Called per request (route helpers accept it as an async provider), so an
 * admin's saved edit reaches the next page view rather than the next deploy.
 * A site that has never stored anything gets its defaults back: a single with
 * no row reads as a default document whose sections are all absent.
 *
 * Errors propagate. A read that cannot reach the database will fail the page
 * render anyway; catching here would serve an unstyled page that looks like a
 * content decision instead of an outage.
 */
export async function loadSiteStyle(args: {
  nextly: SiteStyleReader;
  defaults?: SiteStyleData;
  /** The Single's RESOLVED slug, where a host renamed it. */
  slug?: string;
  /** As {@link readStoredSiteStyle} takes it. */
  bootedReader?: () => Promise<SpacingModeReader | undefined>;
}): Promise<SiteStyleData> {
  return (await loadSiteStyleVersioned(args)).style;
}

/**
 * The site style as {@link loadSiteStyle} gives it, and the Single's version
 * as that read gave it, for a write made from the style to send back.
 */
export async function loadSiteStyleVersioned(
  args: Parameters<typeof loadSiteStyle>[0]
): Promise<{ style: SiteStyleData; rev: string | undefined }> {
  // The slug alone, never an access override: this is published, and its
  // read keeps the posture of the reader it was handed.
  const { stored, rev } = await readStoredSiteStyleVersioned({
    nextly: args.nextly,
    ...(args.slug === undefined ? {} : { slug: args.slug }),
    ...(args.bootedReader === undefined
      ? {}
      : { bootedReader: args.bootedReader }),
  });
  return {
    style: resolveSiteStyle(args.defaults, readSiteStyleRecord(stored)),
    rev,
  };
}
