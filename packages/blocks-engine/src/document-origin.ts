/**
 * Where a block came from: the provenance record a pattern's or component's
 * blocks carry, read as a whole or not at all, and the renames a trusted record
 * says were applied.
 *
 * @module document-origin
 */
import { isPlainRecord } from "./plain-record";
import { ownKeys } from "./safe-record";

/**
 * Where a copied subtree came from.
 *
 * Inert: no renderer reads it, no validator requires it, and a document
 * without one is complete. It exists to be read LATER, by a surface asking
 * whether an upstream source has moved on.
 */
export type BlockOrigin =
  | {
      /** Copied from a pattern, which keeps no link back. */
      readonly from: "pattern";
      /** The pattern entry's id. */
      readonly id: string;
      /**
       * A digest of the pattern's content when this copy was taken.
       *
       * Content rather than a version number, because the engine is handed a
       * document and not an entry row — it can hash what it was given and
       * cannot see what the store calls it. A digest also answers the question
       * more precisely than a version does: a re-save that changed nothing
       * bumps a version and leaves a digest alone.
       */
      readonly digest: string;
      /**
       * The DOM ids this copy had to rename, as the source spells them → as
       * this copy does.
       *
       * An insert renames an id only because the page already held that name,
       * so the replacement is a fact about the destination rather than anything
       * the author wrote. Recording it is what lets a copy saved back out of the
       * page be stored under the names the source uses — without it, the
       * pattern's own fingerprint moves on a save that changed nothing, every
       * other copy reports itself stale, and the id grows another suffix on each
       * insert-save cycle.
       *
       * Recorded rather than derived, because the original cannot be recovered
       * from the current value: a minted id is the authored one plus a suffix
       * taken from a node id, and content from a script or an import may name
       * anchors that way on purpose. That was measured — an authored
       * `hero-12345678` on node `12345678-…` was silently rewritten to `hero`.
       *
       * ABSENT means nothing to put back, which is also what a record written
       * before this field existed says. The two are the same answer for every
       * reader — restore nothing — so an older document needs no migration and
       * behaves exactly as it does today.
       */
      readonly renamed?: Readonly<Record<string, string>>;
      /**
       * Which of this copy's nodes each rename was applied to, keyed as
       * `renamed` is: the source's spelling → the ids of the nodes carrying the
       * replacement.
       *
       * `renamed` says what an id became and not where, and the value cannot
       * say where. A node the author adds later and gives the same id is
       * indistinguishable from the one the insert renamed, so restoring by value
       * stores a name that node never had. With the node ids, a save puts an id
       * back only on a node listed here that still occurs once in the document
       * and still carries the replacement: the namesake of a deleted node, a
       * node whose id was edited away, and a copy given the id again all keep
       * what they carry.
       *
       * Node ids on the record rather than a marker on each renamed node,
       * because a duplicate clones a node's own fields — a marker would travel
       * onto a copy nothing renamed.
       *
       * ABSENT on a record written before this field existed, and such a record
       * is read exactly as before: every node in its scope carrying a
       * replacement is restored. Which node it meant is not recoverable from
       * what it stores, so it is not guessed. Present, it names exactly the
       * entries of `renamed`, each with a list of node ids.
       */
      readonly renamedNodes?: Readonly<Record<string, readonly string[]>>;
    }
  | {
      /** Detached from a component, severing the link deliberately. */
      readonly from: "component";
      /** The component definition's id. */
      readonly id: string;
    };

/**
 * What a stored provenance record turned out to be.
 *
 * Four answers because a caller-supplied record can fail in three different
 * ways, and the validator owes each a different response:
 *
 * - `whole` — every field the guard needs, present and well formed.
 * - `malformed` — read cleanly, and not a record this engine would trust.
 * - `computed` — a field the guard consults is an accessor rather than stored
 *   data. The record may be perfectly well formed; what is certain is that the
 *   document holding it is one `surveyDocument` refuses to measure and already
 *   reports `document-unreadable`, so a second verdict naming this one field
 *   would send an author to repair something that may not be broken.
 * - `unreadable` — REFLECTION itself failed. A Proxy may throw from
 *   `getOwnPropertyDescriptor`, `ownKeys` or `getPrototypeOf`, and unlike an
 *   accessor that is not something the survey is guaranteed to have met: it
 *   walks the keys a record HAS, so a trap that fires only for an absent field
 *   like `renamed` leaves the survey reporting the document perfectly readable.
 *   Deferring here then let `{ from: "pattern", id: "" }` through with no issue
 *   at all. Nothing can establish such a record is whole, so it is not trusted.
 */
export type OriginReading = "whole" | "malformed" | "computed" | "unreadable";

/**
 * Read a stored provenance record, saying which of the four it is.
 *
 * The richer question, from which {@link isBlockOrigin} is derived rather than
 * computed alongside. The validator needs to tell `computed` from `malformed`,
 * and answering that separately meant naming the guard's fields a second time —
 * two lists to keep in step, synchronised by a test that can only observe the
 * fixtures it runs. Here the guard's own reads ARE the definition: a field it
 * consults is one this notices, and a field it stops consulting stops
 * mattering, with nothing to keep in step.
 */
export function readBlockOrigin(value: unknown): OriginReading {
  return readOrigin(value).reading;
}

/** One record's reading, with what a whole pattern record turned out to say. */
interface OriginRead {
  readonly reading: OriginReading;
  /** The rename map of a whole PATTERN record, and nothing for every other. */
  readonly renamed?: ReadonlyMap<string, string>;
  /** The nodes each rename was applied to, where the record says. */
  readonly renamedNodes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The one reading of a stored provenance record.
 *
 * Both published questions come from here rather than asking the record twice.
 * A reader that validated a record and then went back for its contents ran the
 * record's own reflection a second time — measured, a `renamed` Proxy that
 * permits one `ownKeys` and throws on the next crashed a planner AFTER the
 * guard had passed it — and it also spelled the extraction rules a second time,
 * beside the validator that already knows them.
 *
 * So validating and reading are one pass: what a record is, and what it holds
 * if it is anything, cannot disagree because there is nowhere for them to.
 */
function readOrigin(value: unknown): OriginRead {
  try {
    if (!isPlainRecord(value)) return { reading: "malformed" };
    const reader = storedReader(value);
    const whole = wholeOrigin(reader.read);
    if (reader.computed()) return { reading: "computed" };
    if (whole === undefined) return { reading: "malformed" };
    return { reading: "whole", ...whole };
  } catch {
    return { reading: "unreadable" };
  }
}

/**
 * What a whole PATTERN record says was renamed, or nothing when it says none.
 *
 * Beside the validator, and derived from the same read, because "may I trust
 * this record" and "what does this record say" are one question asked at two
 * moments. A caller holding the second half of it independently is the drift
 * this repository has a rule about: the planner's copy accepted a `renamed`
 * whose property was non-enumerable — a field `JSON.stringify`, an object
 * spread and `structuredClone` all drop — and restored an id from metadata the
 * saved document would not carry.
 *
 * Nothing for a component record, which renames nothing, and nothing for a
 * record this would not trust. A caller that must tell those apart is asking
 * {@link readBlockOrigin}, which answers in four.
 */
export function patternRenames(
  origin: unknown
): ReadonlyMap<string, string> | undefined {
  return readOrigin(origin).renamed;
}

/** What a whole PATTERN record says it renamed, and where. */
export interface PatternRenameRecord {
  /** The source's spelling → the copy's. Empty when nothing was renamed. */
  readonly renamed: ReadonlyMap<string, string>;
  /**
   * The source's spelling → the ids of the nodes each rename was applied to.
   *
   * Absent for a record written before node ids were recorded, which a restore
   * reads by value exactly as it always did — kept apart from an empty list,
   * which names no node.
   */
  readonly renamedNodes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * A whole PATTERN record's renames and the nodes they were applied to, from ONE
 * reading of it — or nothing for every record {@link patternRenames} answers
 * nothing for.
 *
 * Both halves in one answer because a caller acting on them needs them to
 * agree. Two published questions asked one after the other read a stored record
 * twice, and a Proxy record can answer the second differently: trusted for its
 * renames, then read otherwise for where they apply.
 */
export function patternRenameRecord(
  origin: unknown
): PatternRenameRecord | undefined {
  const read = readOrigin(origin);
  if (read.renamed === undefined) return undefined;
  return read.renamedNodes === undefined
    ? { renamed: read.renamed }
    : { renamed: read.renamed, renamedNodes: read.renamedNodes };
}

/**
 * Whether a stored value is a whole provenance record.
 *
 * Derived from {@link readBlockOrigin} rather than asking again: `whole` is
 * the one reading this admits, and every other — malformed, computed, or a
 * record reflection could not finish — is the same `false` to a caller that
 * only needs to know whether it may trust the record.
 *
 * Beside the type rather than beside either caller, because a document reaches
 * storage by more than one road: an op through the edit vocabulary, and a field
 * write through the document validator. A record that one road admits and the
 * other refuses is a record that exists in the database and cannot be edited,
 * so both ask this.
 *
 * Whole means every field the arm needs. A pattern origin without a digest
 * cannot answer whether its source moved, which is the only question it exists
 * for — storing one would leave a later reader with a record it must special
 * case rather than trust.
 */
export function isBlockOrigin(value: unknown): value is BlockOrigin {
  return readBlockOrigin(value) === "whole";
}

/**
 * A reader of one record's STORED fields, remembering whether any was computed.
 *
 * The DESCRIPTOR, never an ordinary read. Every field of a provenance record is
 * data a caller supplied — an import, a script, an in-process edit — and
 * reading one runs that caller's code inside the guard deciding whether to
 * trust it. A throwing getter escaped as a native error rather than the answer
 * the guard promises, and a side-effecting one executed on the way past.
 * Measured, all four fields did that.
 *
 * `"value" in descriptor` rather than asking whether there is a getter: an
 * accessor descriptor carries no `value` key at all, and a set-only accessor
 * has no getter either — so asking about the getter alone calls one stored
 * value and one computed one the same thing.
 *
 * A computed field reads back as ABSENT and sets the flag. Absent is a refusal
 * on its own for `id`, `from` and `digest`, none of which may be missing;
 * `renamed` MAY be, and the flag is what keeps those two apart.
 */
function storedReader(record: object): {
  read: (key: string) => unknown;
  computed: () => boolean;
} {
  let computed = false;
  return {
    read(key: string): unknown {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (descriptor === undefined) return undefined;
      if (!("value" in descriptor)) {
        computed = true;
        return undefined;
      }
      // NON-ENUMERABLE reads as absent, which is what it will be. Every road a
      // record travels to storage — `JSON.stringify`, an object spread,
      // `structuredClone` — drops it, so a guard that admits one passes a
      // record whose persisted form is a different record, and a reader acting
      // on its contents restores from metadata no later reader can see.
      //
      // Not `computed`: nothing was executed and nothing is uncertain. The
      // field is stored data that will not be stored, which is the same answer
      // as a field that is not there.
      if (descriptor.enumerable !== true) return undefined;
      return descriptor.value;
    },
    computed: () => computed,
  };
}

/** What a whole record holds, or nothing when it is not one. */
interface WholeOrigin {
  /** A pattern record's renames. Absent on a component, which renames none. */
  readonly renamed?: ReadonlyMap<string, string>;
  /** Where those renames were applied. Absent on a record that predates it. */
  readonly renamedNodes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The fields a provenance record must carry, read once and handed back.
 *
 * The map rather than a verdict about it, so the caller that needs the renames
 * does not re-enumerate a record this already walked entry by entry.
 */
function wholeOrigin(read: (key: string) => unknown): WholeOrigin | undefined {
  const id = read("id");
  if (typeof id !== "string" || id === "") return undefined;
  const from = read("from");
  if (from === "component") return {};
  if (from !== "pattern") return undefined;
  const digest = read("digest");
  if (typeof digest !== "string" || digest === "") return undefined;
  return patternRenamesIn(read);
}

/**
 * What a pattern record says it renamed and where, or nothing when either half
 * is not something a restore could trust.
 *
 * Read after the fields every record needs, in the same pass and through the
 * same reader, so a computed field anywhere in the record is still noticed.
 */
function patternRenamesIn(
  read: (key: string) => unknown
): WholeOrigin | undefined {
  const renamed = readRenameRecord(read("renamed"));
  if (renamed === undefined) return undefined;
  const renamedNodes = readRenamedNodes(read("renamedNodes"), renamed);
  if (renamedNodes === null) return undefined;
  return renamedNodes === undefined ? { renamed } : { renamed, renamedNodes };
}

/**
 * The node lists a record keeps beside its renames: nothing when it keeps
 * none, and `null` when what it keeps is not something a restore could trust.
 *
 * Absent is valid, because it is how every record written before node ids
 * were recorded reads. Present, the lists name EXACTLY the entries of the
 * rename map. A list for an id nothing renamed, or a rename with no list, is a
 * half-record — and reading one would decide by node for some ids and by value
 * for others, on the strength of a record that is wrong about at least one.
 */
function readRenamedNodes(
  value: unknown,
  renamed: ReadonlyMap<string, string>
): ReadonlyMap<string, ReadonlySet<string>> | null | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) return null;
  // The same stored-data reader as every other field of the record, so an
  // accessor or a non-enumerable list reads as absent and refuses the record.
  const { read } = storedReader(value);
  const lists = new Map<string, ReadonlySet<string>>();
  for (const name of ownKeys(value)) {
    if (!renamed.has(name)) return null;
    const nodes = nodeIdList(read(name));
    if (nodes === undefined) return null;
    lists.set(name, nodes);
  }
  return lists.size === renamed.size ? lists : null;
}

/**
 * A stored list of node ids, or nothing when it is not one.
 *
 * Every member through the descriptor, as every other stored field is read,
 * and every one a non-empty string: an empty id names no node, and a list that
 * held one would be trusted to mean something it cannot.
 */
function nodeIdList(value: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  // `length` is non-enumerable on every array, so it is read from its own
  // descriptor rather than through the reader that treats that as absent.
  const length: unknown = Object.getOwnPropertyDescriptor(
    value,
    "length"
  )?.value;
  if (typeof length !== "number") return undefined;
  const { read } = storedReader(value);
  const nodes = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const id = read(String(index));
    if (typeof id !== "string" || id === "") return undefined;
    nodes.add(id);
  }
  return nodes;
}

/**
 * A rename record a later reader could act on, or nothing when it is not one.
 *
 * The MAP and not a verdict about it, because the reader that restores ids and
 * the guard that admits the record are asking one question one pass can answer.
 * Handing back a boolean sent the restore back to enumerate the same record
 * again — a second run of a stored Proxy's traps, and a second spelling of what
 * counts as an entry.
 *
 * Absent is valid and means nothing was renamed. Present and malformed is not:
 * a half-record would be read as "these are the originals" and put an id back
 * that was never there, which is worse than having no record — the same reason
 * {@link isBlockOrigin} refuses a pattern origin without a digest.
 *
 * Own entries only, and every one a non-empty string on both sides. An empty id
 * is not an id, and an entry mapping to one would erase the id it restores.
 */
function readRenameRecord(
  value: unknown
): ReadonlyMap<string, string> | undefined {
  // A FRESH map, not a shared empty one. `patternRenames` hands this to
  // consumers, and a `ReadonlyMap` is only readonly to TypeScript — `.set` is
  // still there at runtime. One caller adding an entry to a module-wide
  // singleton would make every later origin that renamed NOTHING claim that
  // rename, and silently rewrite ids on a save that had nothing to restore.
  if (value === undefined) return new Map();
  if (!isPlainRecord(value)) return undefined;
  // The CURRENT ids, to reject a map that cannot be inverted. The record reads
  // source → copy, and restoring reads it the other way — so two sources
  // claiming one current id give the reverse two answers, and whichever the
  // reader keeps depends on property order. A record that restores an arbitrary
  // one of them is worse than none: it puts back an id the author never had
  // there, silently, and the digest comparison built on it then reports a
  // change nobody made.
  const current = new Set<string>();
  // ONE reader for the whole map, so an entry is read by the same rule the
  // record's own fields are and nothing allocates per entry.
  const { read } = storedReader(value);
  const renamed = new Map<string, string>();
  for (const name of ownKeys(value)) {
    const now = renameEntry(read, name, current);
    if (now === undefined) return undefined;
    renamed.set(name, now);
  }
  return renamed;
}

/**
 * One entry of a rename map — stored data, non-empty on both sides, and naming
 * a current id no other entry claims — or nothing when it is none of those.
 *
 * The DESCRIPTOR, before the value. An entry can be an accessor, and reading one
 * runs the document's own code inside a published guard — where a throwing
 * getter escapes as a native error rather than the refusal this promises. A
 * computed entry is not stored data, which is the same answer the document and
 * node guards give it.
 *
 * `current` is threaded rather than gathered afterwards so one pass answers
 * both questions, and it is mutated here for the same reason: a second walk to
 * find duplicates would read every entry twice.
 */
function renameEntry(
  read: (key: string) => unknown,
  name: string,
  current: Set<string>
): string | undefined {
  if (name === "") return undefined;
  const now = read(name);
  if (typeof now !== "string" || now === "") return undefined;
  if (current.has(now)) return undefined;
  current.add(now);
  return now;
}
