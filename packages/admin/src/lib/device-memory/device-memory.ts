/**
 * What the admin keeps on this device between visits, and the one module that
 * reads, writes and forgets it.
 *
 * A fresh tab otherwise starts from nothing, so it can draw no menu until the
 * server answers. The admin keeps a small map of the site on the device so the
 * next fresh tab can draw its rail and Content panel at once, then replaces
 * them with what the server sends. It keeps an ALLOWED LIST, never a cache of
 * responses:
 *
 * - **`menu`**: the navigation as this person saw it (the rail's entries and
 *   the Content panel's collections and Singles, names and links only);
 * - **`schema`**: the schema of a collection, Single or field group the server
 *   answered this person, with the tag (`ETag`) it was answered with, so a
 *   later read can ask "has it changed?" instead of being sent it again;
 * - **`branding`**: the site's public branding (logo, name, favicon), which
 *   the sign-in page already shows to anyone;
 * - interface preferences (a folded panel, pinned items), under their own keys;
 * - the record that someone signed in here, which picks the first screen.
 *
 * Never an entry, a media item, a user record, a form's values, a session
 * token or a permission list: {@link remember} refuses every kind not listed,
 * and a schema whose address is not a schema read.
 *
 * **Labels.** The menu and the schemas describe what one person may see at one
 * moment, so each is kept with the labels it was true under: the person, this
 * admin build, the schema version and the permission version. Before the
 * server answers only the build can be checked; once it answers
 * ({@link confirmLabels}) anything kept under other labels is discarded, and
 * from then on only an exact match is read. What is learnt before that answer
 * is held in memory and written under the labels the answer gives.
 *
 * **Forgetting.** Signing out, or the server saying the session ended, removes
 * everything about the person in every tab ({@link forgetPerson}, announced
 * to the other tabs with {@link announceSignedOut}). The public branding stays,
 * so the sign-in screen keeps the site's own look.
 *
 * **The off switch.** A site can turn remembering off. The server says so with
 * every startup answer ({@link applyRememberingSwitch}); the admin then removes
 * everything it kept, the branding too, and writes nothing more on this page.
 *
 * Storage can be unavailable (a private window, blocked site data, a full
 * quota), so every access is guarded: what cannot be read is not remembered,
 * and what cannot be written is simply not kept.
 *
 * @module lib/device-memory/device-memory
 */
import { z } from "zod";

import { adminVersion } from "@admin/lib/admin-version";

/** Where the record that someone signed in here is kept. */
export const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";

/** The prefix every remembered entry is kept under. */
export const DEVICE_MEMORY_PREFIX = "nextly:admin:memory:";

/** Where the site's public branding is kept: the one entry a sign-out keeps. */
export const REMEMBERED_BRANDING_KEY = `${DEVICE_MEMORY_PREFIX}branding`;

/** The channel a tab tells the others on that the person signed out. */
const SIGN_OUT_CHANNEL = "nextly:admin:device-memory";

/**
 * The admin's own keys in this browser's storage: everything it writes is
 * under one of these. Read by the forgetting, so a key written by an older
 * admin version, by a hook that keeps an interface preference, or by an
 * editor a plugin mounts in the admin, is forgotten with the rest, whether or
 * not anything on this page registered it. Every spelling of the name is
 * read, `nextly:`, `nextly-` and `nextly.`, as each is in use.
 */
const ADMIN_KEY_PREFIXES = ["nextly:", "nextly-", "nextly."] as const;
const ADMIN_KEYS = new Set(["builder.showSystemInternals"]);

/**
 * Keys outside the admin's own spelling that hold an interface preference
 * all the same, registered by whatever keeps one there (the theme, under the
 * key its host chose), so forgetting the person and the off switch reach
 * them too.
 */
const registeredKeys = new Set<string>();

/** Treat `key` as one of the admin's own interface preferences. */
export function registerPreferenceKey(key: string): void {
  registeredKeys.add(key);
}

/** Whether `key` is one of the admin's own storage keys. */
function isAdminStorageKey(key: string): boolean {
  return (
    ADMIN_KEYS.has(key) ||
    registeredKeys.has(key) ||
    ADMIN_KEY_PREFIXES.some(prefix => key.startsWith(prefix))
  );
}

/** What a remembered entry is kept under, besides its data. */
interface MemoryLabels {
  /** The person the entry describes the site for: their user id. */
  user: string;
  /** The admin build that wrote it, whose shapes it is in. */
  build: string;
  /** The stored schema version the server served when it was written. */
  schemaVersion: string;
  /** The permission version the server served when it was written. */
  permissionVersion: string;
}

/** The labels the server's answer gives; the build is this page's own. */
export type ServerLabels = Omit<MemoryLabels, "build">;

/** This admin build's label: its release, or `source` for a source build. */
export function buildLabel(): string {
  return adminVersion() ?? "source";
}

// ---------------------------------------------------------------------------
// The kinds the store keeps
// ---------------------------------------------------------------------------

/** A short text kept in an entry: a name, a slug, an icon's name. */
const name = z.string().min(1).max(200);
/** A link within the admin: an absolute path on this origin, or none. */
const adminLink = z
  .string()
  .max(500)
  .refine(
    href => href === "#" || (href.startsWith("/") && !href.startsWith("//"))
  );

const railEntrySchema = z.object({
  id: name,
  label: name,
  href: adminLink,
  /** The icon's name, for an entry the admin does not draw an icon for itself. */
  icon: name.optional(),
});

const contentItemSchema = z.object({
  slug: name,
  label: name,
  icon: name.optional(),
});

/**
 * The navigation as one person saw it: names and links, nothing a screen
 * reads as data. Parsed on the way in and out, so nothing beyond these fields
 * is ever kept.
 */
const rememberedMenuSchema = z.object({
  rail: z.array(railEntrySchema).max(64),
  /** Which parts the Content panel offers, so its switch is drawn from memory. */
  parts: z.object({ collections: z.boolean(), singles: z.boolean() }),
  collections: z.array(contentItemSchema).max(1000),
  singles: z.array(contentItemSchema).max(1000),
});

export type RememberedMenu = z.infer<typeof rememberedMenuSchema>;
export type RememberedRailEntry = z.infer<typeof railEntrySchema>;
export type RememberedContentItem = z.infer<typeof contentItemSchema>;

/** A schema as the server answered it, with the tag it carried. */
const rememberedSchemaSchema = z.object({
  etag: z.string().min(1).max(200),
  body: z.record(z.string(), z.unknown()),
});

export type RememberedSchema = z.infer<typeof rememberedSchemaSchema>;

const setText = z.string().trim().min(1).max(2048).optional().catch(undefined);

/** The site's public branding: what the sign-in page shows anyone. */
const rememberedBrandingSchema = z.object({
  logoUrl: setText,
  logoUrlLight: setText,
  logoUrlDark: setText,
  logoText: setText,
  favicon: setText,
});

export type RememberedBranding = z.infer<typeof rememberedBrandingSchema>;

/**
 * The schema reads whose answers may be kept: one collection's, one Single's
 * or one field group's schema, by the address the admin reads it at. Never a
 * list, an entry or anything under one.
 */
const SCHEMA_READS: readonly RegExp[] = [
  /^\/collections\/schema\/[^/?#]+$/,
  /^\/collections\/(?!schema$)[^/?#]+$/,
  /^\/singles\/[^/?#]+\/schema$/,
  /^\/field-groups\/(?!schema$)[^/?#]+$/,
];

/** Whether a GET of `path` reads a schema the store may keep. */
export function isRememberedSchemaPath(path: string): boolean {
  return SCHEMA_READS.some(pattern => pattern.test(path));
}

/** How each kind is checked on the way in, and whether it carries labels. */
const KINDS = {
  menu: { schema: rememberedMenuSchema, labelled: true },
  schema: { schema: rememberedSchemaSchema, labelled: true },
  branding: { schema: rememberedBrandingSchema, labelled: false },
} as const;

type MemoryKind = keyof typeof KINDS;

function isMemoryKind(kind: string): kind is MemoryKind {
  return Object.hasOwn(KINDS, kind);
}

/** The storage key of one entry. */
function entryKey(kind: MemoryKind, id: string): string {
  return id === ""
    ? `${DEVICE_MEMORY_PREFIX}${kind}`
    : `${DEVICE_MEMORY_PREFIX}${kind}:${id}`;
}

/** An entry as it is stored. */
const storedEntrySchema = z.object({
  labels: z.object({
    build: z.string(),
    user: z.string().optional(),
    schemaVersion: z.string().optional(),
    permissionVersion: z.string().optional(),
  }),
  data: z.unknown(),
});

type StoredEntry = z.infer<typeof storedEntrySchema>;

// ---------------------------------------------------------------------------
// This page's state
// ---------------------------------------------------------------------------

/** What this page knows of the server's answer and of the switch. */
interface PageState {
  /** Whether the site lets the admin remember: unknown until the server says. */
  remembering: "unknown" | "on" | "off";
  /** The labels the server's answer gave, once it has. */
  labels: ServerLabels | null;
  /** Labelled entries learnt before the server answered, by storage key. */
  pending: Map<string, { kind: MemoryKind; id: string; data: unknown }>;
  /**
   * Set once the person is forgotten on this page: what is still drawn for
   * them must not write them back, so labelled entries are refused until a
   * new session's answer gives new labels.
   */
  forgotten: boolean;
  /**
   * Whether this tab has seen the server confirm a session since it last
   * forgot the person. Kept in memory, not storage, so a tab knows it was
   * signed in where the site keeps nothing on the device or storage refuses
   * it, and can still tell the other tabs when that session ends.
   */
  confirmedHere: boolean;
  /**
   * Preferences held in memory alone: where the site turned remembering off,
   * or storage refused them. They last as long as the page, as this tab's own
   * choices, until the person is forgotten.
   */
  tabMemory: Map<string, string>;
  /**
   * Which of the person's sessions this page is in, counted up each time the
   * person is forgotten. An answer, or a schema read, that was asked for in
   * an earlier one is about someone who has left, and labels or keeps
   * nothing.
   */
  session: number;
  /** Counted up whenever the labels or the person change, for subscribers. */
  revision: number;
}

const state: PageState = {
  remembering: "unknown",
  labels: null,
  pending: new Map(),
  forgotten: false,
  confirmedHere: false,
  tabMemory: new Map(),
  session: 0,
  revision: 0,
};

/** Whoever draws from the device memory and must hear that it changed. */
const changeListeners = new Set<() => void>();

/**
 * Tell every subscriber the device memory changed: its labels moved, so what
 * was kept under the old ones is gone and should be kept again, or the person
 * was forgotten, so what is drawn from their preferences returns to the
 * defaults. Storage's own event reaches only the other tabs.
 */
function announceChange(): void {
  state.revision += 1;
  for (const listener of [...changeListeners]) listener();
}

/**
 * Call `listener` whenever the device memory changes in this tab: its labels
 * move, or the person is forgotten. Returns the unsubscribe. With
 * {@link deviceMemoryRevision}, the pair `useSyncExternalStore` takes.
 */
export function onDeviceMemoryChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** A number that changes whenever {@link onDeviceMemoryChange} is called. */
export function deviceMemoryRevision(): number {
  return state.revision;
}

/**
 * Which of the person's sessions this page is in. Read when asking the
 * server something whose answer is labelled or kept, and handed back with
 * the answer, so an answer that arrives after the person was forgotten is
 * known to be about someone who has left.
 */
export function deviceMemorySession(): number {
  return state.session;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readEntry(key: string): StoredEntry | undefined {
  let text: string | null = null;
  try {
    text = storage()?.getItem(key) ?? null;
  } catch {
    return undefined;
  }
  if (text === null) return undefined;
  try {
    const parsed = storedEntrySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(key, value);
    return true;
  } catch {
    // Refused (a private window, a full quota): the entry is simply not kept.
    return false;
  }
}

function removeRaw(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Refused: nothing could have been kept there either.
  }
}

/** The keys of `store` that `keep` holds, read before any is removed. */
function keysOf(
  store: Storage | null,
  keep: (key: string) => boolean
): string[] {
  if (store === null) return [];
  const keys: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null && keep(key)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

/** Whether an entry's labels say it is still true now. */
function labelsMatch(kind: MemoryKind, labels: StoredEntry["labels"]): boolean {
  if (labels.build !== buildLabel()) return false;
  if (!KINDS[kind].labelled) return true;
  // Before the server answers only the build can be compared.
  const now = state.labels;
  if (now === null) return true;
  return (
    labels.user === now.user &&
    labels.schemaVersion === now.schemaVersion &&
    labels.permissionVersion === now.permissionVersion
  );
}

// ---------------------------------------------------------------------------
// Remembering and recalling
// ---------------------------------------------------------------------------

/**
 * Keep `data` as an entry of `kind` (one of the allowed list), under `id`
 * (the schema's address for a schema, empty otherwise). Returns whether it
 * was accepted: refused for any other kind, a schema address that is not a
 * schema read, data not of the kind's shape, or remembering turned off.
 *
 * A labelled entry learnt before the server's answer is held in memory and
 * written once the answer gives its labels. One learnt in an earlier
 * `session` (see {@link deviceMemorySession}) is about a person since
 * forgotten and is refused; by default it is learnt in this one.
 */
export function remember(
  kind: string,
  id: string,
  data: unknown,
  session: number = state.session
): boolean {
  if (!isMemoryKind(kind)) return false;
  if (kind === "schema" ? !isRememberedSchemaPath(id) : id !== "") return false;
  if (state.remembering === "off") return false;
  if (KINDS[kind].labelled && (state.forgotten || session !== state.session)) {
    return false;
  }
  const parsed = KINDS[kind].schema.safeParse(data);
  if (!parsed.success) return false;
  const key = entryKey(kind, id);
  if (KINDS[kind].labelled && state.labels === null) {
    state.pending.set(key, { kind, id, data: parsed.data });
    return true;
  }
  return writeEntry(kind, key, parsed.data);
}

function writeEntry(kind: MemoryKind, key: string, data: unknown): boolean {
  const labels: StoredEntry["labels"] =
    KINDS[kind].labelled && state.labels !== null
      ? { build: buildLabel(), ...state.labels }
      : { build: buildLabel() };
  return writeRaw(key, JSON.stringify({ labels, data } satisfies StoredEntry));
}

/**
 * The entry of `kind` under `id`, while its labels still hold; one that no
 * longer holds is removed rather than returned.
 */
function recall(kind: MemoryKind, id: string): unknown {
  const key = entryKey(kind, id);
  const pending = state.pending.get(key);
  if (pending !== undefined) return pending.data;
  const entry = readEntry(key);
  if (entry === undefined) return undefined;
  const parsed = KINDS[kind].schema.safeParse(entry.data);
  if (!parsed.success || !labelsMatch(kind, entry.labels)) {
    removeRaw(key);
    return undefined;
  }
  return parsed.data;
}

/** The remembered navigation, or undefined. */
export function recallMenu(): RememberedMenu | undefined {
  return recall("menu", "") as RememberedMenu | undefined;
}

/** Keep the navigation as this person sees it now. */
export function rememberMenu(menu: RememberedMenu): boolean {
  return remember("menu", "", menu);
}

/** The remembered answer to the schema read at `path`, or undefined. */
export function recallSchema(path: string): RememberedSchema | undefined {
  if (!isRememberedSchemaPath(path)) return undefined;
  return recall("schema", path) as RememberedSchema | undefined;
}

/**
 * Keep the answer to the schema read at `path`, with the tag it carried. A
 * read sent in an earlier `session` is not kept: its answer is about a
 * person since forgotten.
 */
export function rememberSchema(
  path: string,
  etag: string,
  body: unknown,
  session: number = state.session
): boolean {
  return remember("schema", path, { etag, body }, session);
}

/** The remembered public branding; empty when none is kept. */
export function recallBranding(): RememberedBranding {
  const kept = recall("branding", "") as RememberedBranding | undefined;
  if (kept === undefined) return {};
  // Only the keys set, so a merge over other branding adds nothing empty.
  return Object.fromEntries(
    Object.entries(kept).filter(([, value]) => value !== undefined)
  );
}

/** Keep the site's public branding, from any object carrying it. */
export function rememberBranding(branding: Record<string, unknown>): boolean {
  const parsed = rememberedBrandingSchema.safeParse(branding);
  return parsed.success && remember("branding", "", parsed.data);
}

// ---------------------------------------------------------------------------
// The record that someone signed in here
// ---------------------------------------------------------------------------

/** Whether this browser has a record of a sign-in to this admin. */
export function hasSignedInHere(): boolean {
  try {
    return storage()?.getItem(SIGNED_IN_HERE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Record that the server confirmed a session in this browser, unless the site
 * turned remembering off. It grants nothing: it only picks the first screen,
 * the frame for a browser that signed in here and the sign-in form otherwise.
 */
export function rememberSignedInHere(): void {
  // Known to this tab whatever storage does: it is what says the other tabs
  // must hear when this session ends.
  state.confirmedHere = true;
  if (state.remembering === "off") return;
  writeRaw(SIGNED_IN_HERE_KEY, "1");
}

// ---------------------------------------------------------------------------
// Interface preferences
// ---------------------------------------------------------------------------

/** Whether `key` may hold an interface preference: an admin key, not an entry's. */
function isPreferenceKey(key: string): boolean {
  return (
    isAdminStorageKey(key) &&
    key !== SIGNED_IN_HERE_KEY &&
    !key.startsWith(DEVICE_MEMORY_PREFIX)
  );
}

/** The interface preference kept under `key`, or null. */
export function recallPreference(key: string): string | null {
  if (!isPreferenceKey(key)) return null;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Keep an interface preference under `key`, one of the admin's own keys.
 * Returns whether it was kept: not when remembering is off, or storage
 * refused it.
 */
export function rememberPreference(key: string, value: string): boolean {
  if (!isPreferenceKey(key) || state.remembering === "off") return false;
  return writeRaw(key, value);
}

/**
 * The preference this tab keeps under `key`, one of the admin's own keys:
 * what this page holds in memory, else the tab's session storage, read only
 * while the site lets the admin remember.
 */
export function recallTabPreference(key: string): string | null {
  if (!isPreferenceKey(key)) return null;
  const held = state.tabMemory.get(key);
  if (held !== undefined) return held;
  if (state.remembering === "off") return null;
  try {
    return sessionStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Keep a preference for this tab alone under `key`: in the tab's session
 * storage, or, where the site turned remembering off or the storage refuses
 * it, in this page's memory, so it still holds while the page does.
 */
export function rememberTabPreference(key: string, value: string): void {
  if (!isPreferenceKey(key)) return;
  if (state.remembering === "off") {
    state.tabMemory.set(key, value);
    return;
  }
  let kept = false;
  try {
    const store = sessionStore();
    store?.setItem(key, value);
    kept = store !== null;
  } catch {
    // Refused (a private window, a full quota): held in memory below.
  }
  if (!kept) state.tabMemory.set(key, value);
}

/** Remove the preference this tab keeps under `key`, wherever it is kept. */
export function forgetTabPreference(key: string): void {
  if (!isPreferenceKey(key)) return;
  state.tabMemory.delete(key);
  try {
    sessionStore()?.removeItem(key);
  } catch {
    // Refused: nothing could have been kept there either.
  }
}

/**
 * The preference under `key`, one of the admin's own keys or a registered
 * one: what this page holds in memory (where the device keeps nothing), else
 * what this browser's storage keeps.
 */
export function recallHeldPreference(key: string): string | null {
  if (!isPreferenceKey(key)) return null;
  return state.tabMemory.get(key) ?? recallPreference(key);
}

/**
 * Keep the preference under `key` in this browser's storage, or, where the
 * site turned remembering off or storage refuses it, in this page's memory,
 * so it holds while the page does, until the person is forgotten.
 */
export function keepHeldPreference(key: string, value: string): void {
  if (!isPreferenceKey(key)) return;
  if (rememberPreference(key, value)) state.tabMemory.delete(key);
  else state.tabMemory.set(key, value);
}

/** Remove the preference under `key`, from storage and this page's memory. */
export function forgetHeldPreference(key: string): void {
  if (!isPreferenceKey(key)) return;
  state.tabMemory.delete(key);
  removeRaw(key);
}

// ---------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------

/**
 * The server's answer has given the labels: discard everything kept under
 * other ones, write what was learnt before it, and from now on read only what
 * matches them exactly.
 */
export function confirmLabels(labels: ServerLabels): void {
  if (state.remembering === "off") return;
  state.forgotten = false;
  state.labels = { ...labels };
  sweep();
  const pending = [...state.pending.entries()];
  state.pending.clear();
  for (const [key, entry] of pending) writeEntry(entry.kind, key, entry.data);
  announceChange();
}

/**
 * The server's answer gave no permission version (it could not vouch for
 * one): nothing can say whether the person's access changed since the menu
 * and the schemas were kept, so they are discarded, and nothing labelled is
 * kept on this page.
 */
export function discardLabelledMemory(): void {
  state.labels = null;
  state.pending.clear();
  state.forgotten = true;
  for (const key of keysOf(storage(), k =>
    k.startsWith(DEVICE_MEMORY_PREFIX)
  )) {
    const kind = key.slice(DEVICE_MEMORY_PREFIX.length).split(":")[0];
    if (!isMemoryKind(kind) || KINDS[kind].labelled) removeRaw(key);
  }
}

/**
 * The schema version moved while this page is open (another tab, or a
 * code-first change, saved the schema): what was kept under the old version
 * is discarded, and what is written next carries the new one.
 */
export function noteRememberedSchemaVersion(schemaVersion: string): void {
  if (state.labels === null || state.labels.schemaVersion === schemaVersion) {
    return;
  }
  state.labels = { ...state.labels, schemaVersion };
  sweep();
  // What was kept under the old version is gone, the menu included, though
  // the menu as drawn may not have changed at all: told, whoever keeps it
  // keeps it again under the new one.
  announceChange();
}

/** Remove every kept entry whose labels no longer hold. */
function sweep(): void {
  for (const key of keysOf(storage(), k =>
    k.startsWith(DEVICE_MEMORY_PREFIX)
  )) {
    const kind = key.slice(DEVICE_MEMORY_PREFIX.length).split(":")[0];
    const entry = readEntry(key);
    if (
      !isMemoryKind(kind) ||
      entry === undefined ||
      !labelsMatch(kind, entry.labels)
    ) {
      removeRaw(key);
    }
  }
}

/**
 * The site's switch, as the server's answer gives it: off removes everything
 * the admin kept on this device, the public branding too, and nothing more is
 * written on this page.
 */
export function applyRememberingSwitch(on: boolean): void {
  state.remembering = on ? "on" : "off";
  if (!on) forgetEverything();
}

// ---------------------------------------------------------------------------
// Forgetting
// ---------------------------------------------------------------------------

/**
 * Remove everything about the person: the menu, the schemas, the interface
 * preferences and the signed-in record, in this browser's storage and this
 * tab's session storage. The public branding stays. Labelled entries are not
 * written again until the next session's answer gives new labels.
 *
 * Returns whether there was anyone to forget: this browser kept a record of
 * a sign-in, or this tab saw the server confirm a session. The second holds
 * where nothing is kept on the device, so the caller tells the other tabs of
 * a session that ended either way.
 */
export function forgetPerson(): boolean {
  const knewSomeone = hasSignedInHere() || state.confirmedHere;
  // Only forgetting the person ends what this tab knew of their session, and
  // its choices held in memory: the off switch removes what is stored, and
  // the session goes on.
  state.confirmedHere = false;
  state.tabMemory.clear();
  // A new session begins: an answer still on its way for the one that ended
  // labels nothing, and a read sent in it keeps nothing.
  state.session += 1;
  forget(key => key !== REMEMBERED_BRANDING_KEY);
  // What this tab still draws from the person's preferences (the theme
  // among them) returns to the defaults now, not on the next visit.
  announceChange();
  return knewSomeone;
}

/** Remove everything the admin kept on this device. */
function forgetEverything(): void {
  forget(() => true);
}

function forget(include: (key: string) => boolean): void {
  state.labels = null;
  state.pending.clear();
  state.forgotten = true;
  const local = storage();
  for (const key of keysOf(local, k => isAdminStorageKey(k) && include(k))) {
    removeRaw(key);
  }
  const session = sessionStore();
  for (const key of keysOf(session, k => isAdminStorageKey(k) && include(k))) {
    try {
      session?.removeItem(key);
    } catch {
      // Refused: nothing could have been kept there either.
    }
  }
}

// ---------------------------------------------------------------------------
// Every open tab
// ---------------------------------------------------------------------------

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(SIGN_OUT_CHANNEL);
  } catch {
    return null;
  }
}

/** Tell every other open tab of this admin that the person signed out. */
export function announceSignedOut(): void {
  const sender = channel();
  if (sender === null) return;
  try {
    sender.postMessage({ type: "signed-out" });
  } finally {
    sender.close();
  }
}

/**
 * Call `listener` when another tab says the person signed out, after this
 * tab's own memory of them is dropped so nothing it is still drawing writes it
 * back. Returns the unsubscribe.
 */
export function onSignedOutElsewhere(listener: () => void): () => void {
  const receiver = channel();
  if (receiver === null) return () => {};
  receiver.onmessage = (event: MessageEvent<unknown>) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type !== "signed-out") return;
    // Forgotten here as in the tab that signed out, this tab's own session
    // storage and memory included, which no other tab can reach. Not told
    // on: the tab that signed out already told every tab.
    forgetPerson();
    listener();
  };
  return () => receiver.close();
}

/**
 * Forget this page's knowledge of the server's answer. For tests, which load
 * the admin many times in one process.
 *
 * @internal
 */
export function resetDeviceMemoryForTests(): void {
  state.remembering = "unknown";
  state.labels = null;
  state.pending.clear();
  state.forgotten = false;
  state.confirmedHere = false;
  state.tabMemory.clear();
  state.session = 0;
  state.revision = 0;
}
