/**
 * The class surface: the site's shared styles as the editor holds them, and
 * every write to them (add, change a style's styles, rename) through one
 * queue, each refused while a style undo or redo settles.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-class-surface
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import {
  sharedStyleNameTaken,
  type ClassRenameOutcome,
  type SharedStyleChange,
} from "@nextlyhq/builder/shell";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { classOverrideOf, resolveSiteStyle } from "../../site-style";
import { readSiteStyleRecord } from "../../site-style-record";
import { useSaveSiteStyle, type SiteStyleReplayed } from "../site-style-client";

import { rebasedOnCode } from "./class-override-rebase";
import { toastSaveConflicts } from "./conflict-toast";
import { StyleRevisionContext } from "./site-style-history";

/**
 * A stored class section as the class surface holds it: read as the editor
 * reads the document, over the site's config classes.
 */
function classesFromStored(
  configured: readonly NamedClass[] | undefined,
  stored: unknown
): readonly NamedClass[] {
  return (
    resolveSiteStyle(
      configured === undefined ? {} : { classes: configured },
      readSiteStyleRecord({ classes: stored })
    ).classes ?? NO_CLASSES
  );
}

/**
 * The class list a stored save leaves: the merge as stored, when the save
 * was merged onto a newer copy, else the list composed for it.
 */
function classesAfterSave(
  result: { readonly stored?: unknown },
  composed: readonly NamedClass[],
  configured: readonly NamedClass[] | undefined
): readonly NamedClass[] {
  return result.stored === undefined
    ? composed
    : classesFromStored(configured, result.stored);
}

/**
 * One serialised writer for every whole-section class write.
 *
 * Every write here is read-modify-write over the WHOLE section: the payload is
 * the complete class list, because that is what `saveSection` stores. So the
 * list a write composes from decides what survives it, and the rendered
 * `library` is stale for as long as a save takes to come back through the
 * cache.
 *
 * Two things follow, and each was a separate defect.
 *
 * **Composition must happen inside the queue, not before it.** Serialising
 * only TRANSMISSION is not enough: both callers compose their payload, then
 * queue, so the second was already built without the first. `run` therefore
 * takes a FUNCTION and calls it after the previous write settles, so every
 * payload is composed against the result of the one before it.
 *
 * **One base, shared.** Creating and renaming are the same read-modify-write
 * over the same list. Two independent bases meant a rename that had not yet
 * refreshed was invisible to a creation, which then wrote a list carrying the
 * old slug — and in the other order, dropped the new class.
 *
 * A completed write ADVANCES the base; a fresh read from the host REPLACES it,
 * because the server's answer is authoritative the moment it arrives.
 */
interface ClassWrites {
  /**
   * Run one whole-section write, composed against the freshest list.
   *
   * The callback receives the base and answers with the payload it composed
   * plus its own result. Returning `next` separately is what lets this advance
   * the base ONLY when the write succeeded — a refused write changed nothing,
   * and building the following edit on it would persist something the server
   * rejected.
   */
  run: <T>(
    write: (existing: readonly NamedClass[] | undefined) => Promise<{
      result: T;
      next?: readonly NamedClass[];
    }>
  ) => Promise<T>;
}

function useClassWrites(
  library: readonly NamedClass[] | undefined
): ClassWrites {
  const held = useRef(library);
  /*
   * The host's answer supersedes anything composed locally. This runs only
   * when `library` changes identity, which is exactly when a re-read has
   * landed — during a save's window the identity is unchanged and the base
   * keeps whatever the writes advanced it to.
   */
  useEffect(() => {
    held.current = library;
  }, [library]);

  // The chain every write joins. Held as a ref so it survives re-renders: a
  // queue recreated on render would let two writes run concurrently again.
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T>(
      write: (existing: readonly NamedClass[] | undefined) => Promise<{
        result: T;
        next?: readonly NamedClass[];
      }>
    ): Promise<T> => {
      const started = tail.current.then(async () => {
        const answered = await write(held.current);
        if (answered.next !== undefined) held.current = answered.next;
        return answered.result;
      });
      // The chain must not break on a rejection, or every later write is
      // rejected with an error belonging to an edit the author has forgotten.
      tail.current = started.then(
        () => undefined,
        () => undefined
      );
      return started;
    },
    []
  );

  return { run };
}

/**
 * Whether a read has FAILED rather than merely not finished yet.
 *
 * A separate function because "not arrived" and "will never arrive" are
 * different states with different wording, and reading them from one
 * expression inside the hook made the hook answer two questions at once.
 */
function classReadFailed(pending: boolean, error: unknown): boolean {
  return !pending && error !== null && error !== undefined;
}

/**
 * The empty library, as ONE value rather than a fresh array each time.
 *
 * `?? []` builds a new array on every render, and `useClassWrites` reads a
 * changed identity as "the host has re-read" — so a site whose stored style
 * declares no classes looked like it was re-reading continuously, and any
 * render during an in-flight save reset the write base to the stale list. The
 * next queued write then composed from it and discarded the edit before it,
 * while reporting success.
 */
const NO_CLASSES: readonly NamedClass[] = Object.freeze([]);

/**
 * The library to show, or `undefined` while it is not known.
 *
 * `undefined` while the read is in flight, and the resolved list once it is
 * not — including an empty one. `useSiteStyle` names `pending` as a real third
 * state for exactly this reason: the defaults alone are a legitimate answer, so
 * a surface cannot tell "nothing is stored" from "the read has not come back"
 * by looking at the value.
 */
function readableClassLibrary(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  failed: boolean
): readonly NamedClass[] | undefined {
  if (pending || failed) return undefined;
  // `undefined` above and `NO_CLASSES` here stay distinct: the first is a read
  // that has not answered, the second is one that answered with nothing.
  return siteStyle?.classes ?? NO_CLASSES;
}

/** What {@link useClassSurface} returns, and what the editor hands on as its `classes`. */
export type ClassSurface = {
  library: readonly NamedClass[] | undefined;

  absence: "pending" | "failed";

  /**
   * Store a new shared style, made from a block ("Save as shared style…").
   * Resolves to the refusal in words, or `undefined` once stored. There is
   * no way to make an empty one: a style is born from a block's look.
   */
  add: (entry: NamedClass) => Promise<string | undefined>;
  /**
   * Apply one change to a shared style's styles, while it is the Style tab's
   * target, and store them. Resolves to the refusal in words, or `undefined`
   * once stored.
   */
  writeStyles: (
    classId: string,
    change: SharedStyleChange
  ) => Promise<string | undefined>;
  /** The name each class is heading for while its rename is open. */
  pendingNames: Record<string, string>;

  currentRenameAttempt: (classId: string) => number;

  rename: (
    classId: string,
    name: { label: string; slug: string }
  ) => Promise<ClassRenameOutcome>;
};

export function useClassSurface(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  error: unknown,
  /** The site's own config, whose classes storage layers over. */
  config: { classes?: readonly NamedClass[] } | undefined
): ClassSurface {
  // Derived outside the hook, so this decides nothing and only distributes what
  // was decided — which is what keeps the component rendering the inspector
  // free of the branch.
  const failed = classReadFailed(pending, error);
  const library = readableClassLibrary(siteStyle, pending, failed);
  const configured = config?.classes;
  /*
   * ONE writer for both edits. Creating and renaming are the same
   * read-modify-write over the same list, so two independent queues let a
   * rename that had not yet refreshed be invisible to a creation — which then
   * wrote a list carrying the old slug, and in the other order dropped the new
   * class.
   */
  const writes = useClassWrites(library);
  /*
   * Which name each class is heading for while its rename is on the network.
   *
   * Held HERE because it must survive the manager panel being unmounted, which
   * the rail does on every switch. State rather than a ref: the panel renders
   * from it, so a change has to reach the screen.
   */
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  /*
   * Which rename attempt is the live one for each class.
   *
   * A REF, and held beside the pending names rather than inside the panel,
   * because two decisions depend on the same identity and one of them outlives
   * the panel. The rail unmounts the manager on every switch, so a counter kept
   * per field starts again at zero and an older answer then passes for the
   * current one.
   *
   * A ref rather than state because both readers need the value SYNCHRONOUSLY —
   * the panel reads it in the same event that started the attempt, and a state
   * update is not visible until the render after.
   *
   * A `Map` rather than a record, because a class id is stored data: every string
   * a class can carry has to be a key here, and on a plain object some strings,
   * `__proto__` among them, name an inherited accessor instead of an entry.
   */
  const renameAttempts = useRef(new Map<string, number>());
  const beginRename = useCallback((classId: string, name: string): number => {
    const mine = (renameAttempts.current.get(classId) ?? 0) + 1;
    renameAttempts.current.set(classId, mine);
    setPendingNames(current =>
      current[classId] === name ? current : { ...current, [classId]: name }
    );
    return mine;
  }, []);
  const endRename = useCallback((classId: string, mine: number) => {
    /*
     * Only the attempt that is still the live one clears the entry. Clearing
     * unconditionally let a FIRST rename's cleanup delete a second one's
     * pending name while that second write was still on the network — and the
     * panel then compares an edit against the rendered slug, so reverting to it
     * reads as a no-op while the queued rename goes on to persist a different
     * name.
     */
    if (renameAttempts.current.get(classId) !== mine) return;
    setPendingNames(current => {
      // The record's OWN entry, for the reason the counters are a `Map`: `in`
      // also answers for inherited names, and removing one that is not there
      // would rebuild the record for nothing.
      if (!Object.hasOwn(current, classId)) return current;
      const { [classId]: _gone, ...rest } = current;
      return rest;
    });
  }, []);
  /** The live attempt for a class, for a caller deciding whether it is current. */
  const currentRenameAttempt = useCallback(
    (classId: string): number => renameAttempts.current.get(classId) ?? 0,
    []
  );
  return {
    library,
    /*
     * Which absence, so the selector can say so. A read that FAILED will not
     * finish, and a surface that goes on saying "loading" describes a state
     * the site is not in — the distinction the tokens studio already draws.
     */
    absence: failed ? ("failed" as const) : ("pending" as const),
    /*
     * Withheld while the library is unknown. A failed read leaves
     * `useSiteStyle` answering with the config defaults alone, so creating
     * against it would compose a library missing everything stored — and the
     * save would then delete those classes rather than add one.
     */
    add: useRefusalWhileReplaying(useAddClass(writes, configured)),
    /*
     * Withheld the same way: a style's styles written against a library
     * missing what a replay restored would take it away again.
     */
    writeStyles: useRefusalWhileReplaying(
      useWriteClassStyles(writes, configured)
    ),
    /** Which classes are mid-rename, for the manager's no-op check. */
    pendingNames,
    /*
     * The identity BOTH supersession decisions derive from — this hook's own
     * cleanup, and the panel's judgement of whether an answer still describes
     * the rename being attempted.
     */
    currentRenameAttempt,
    /*
     * Withheld the same way and for the same reason: renaming against a
     * library missing everything stored would save that partial list, which
     * deletes the classes it could not see rather than renaming one.
     */
    rename: useHeldWhileReplaying(
      useRenameClass(writes, configured, beginRename, endRename)
    ),
  };
}

/** What a class change made while a style replay settles is told. */
const REPLAY_SETTLING = {
  ok: false as const,
  reason: "A style change is being undone or redone. Try again in a moment.",
};

/**
 * A shared-style write answering its refusal in words, refused the same way
 * while a style undo or redo settles.
 */
function useRefusalWhileReplaying<Args extends unknown[]>(
  write: (...args: Args) => Promise<string | undefined>
): (...args: Args) => Promise<string | undefined> {
  const held = useHeldWhileReplaying(write);
  return useCallback(
    async (...args: Args) => {
      const outcome = await held(...args);
      // A string or nothing is the write's own answer; the settling refusal
      // is the only object, and says why in its reason.
      return typeof outcome === "object" ? outcome.reason : outcome;
    },
    [held]
  );
}

/**
 * A class write, refused while a style undo or redo settles.
 *
 * The inspector and the class manager compose a whole library from the one
 * they hold, which still has what the replay took away until the read
 * catches up; a write made then would put it back. So the write waits, said
 * in words, until the replayed value has been read.
 */
function useHeldWhileReplaying<Args extends unknown[], Outcome>(
  write: (...args: Args) => Promise<Outcome>
): (...args: Args) => Promise<Outcome | typeof REPLAY_SETTLING> {
  const { settling } = useContext(StyleRevisionContext);
  const latest = useRef(settling);
  latest.current = settling;
  return useCallback(
    (...args: Args) =>
      latest.current ? Promise.resolve(REPLAY_SETTLING) : write(...args),
    [write]
  );
}

/** An undo's answer when what it takes back was kept over another's removal. */
const REMOVED_BY_THEM = Symbol("removed-by-them");

/**
 * The stored classes as a replay finds them, with one style taken out: the
 * undo of an edit that kept a style another author had removed meanwhile.
 * Nothing to write once the style is no longer stored.
 */
function classRemovedFrom(
  held: unknown,
  configured: readonly NamedClass[] | undefined,
  classId: string
): SiteStyleReplayed {
  const entries = (Array.isArray(held) ? held : []).filter(
    (entry): entry is NamedClass => typeof entry === "object" && entry !== null
  );
  if (!entries.some(entry => entry.id === classId)) {
    return { kind: "unchanged" };
  }
  return {
    kind: "write",
    value: classOverrideOf(
      configured,
      entries.filter(entry => entry.id !== classId)
    ),
  };
}

/**
 * One style's change applied to the stored classes as a replay finds them:
 * the stored tier with that style changed, nothing to write, or nothing it
 * can do once the style is neither stored nor in the site's code (a removed
 * style is not recreated).
 */
function classChangeOn(
  held: unknown,
  /** The site's code as it was when the step was recorded. */
  recorded: readonly NamedClass[] | undefined,
  /** The site's code as it is now, when the step is replayed. */
  configured: readonly NamedClass[] | undefined,
  classId: string,
  change: SharedStyleChange
): SiteStyleReplayed {
  const entries = (Array.isArray(held) ? held : []).filter(
    (entry): entry is NamedClass => typeof entry === "object" && entry !== null
  );
  const at = entries.findIndex(entry => entry.id === classId);
  const code = configured?.find(each => each.id === classId);
  // A style the site's code supplies is stored only while it differs from
  // the code's, so after an undo the stored tier may not hold it: its
  // styles are then the code's. Stored, it is first moved onto the code as
  // it now is, so the code's old values in it don't mask the new.
  const stored = entries[at];
  const entry =
    stored === undefined
      ? code
      : rebasedOnCode(
          stored,
          recorded?.find(each => each.id === classId),
          code
        );
  if (entry === undefined) {
    // The code no longer supplies it and nothing of the site's own is left.
    return stored === undefined
      ? { kind: "gone" }
      : {
          kind: "write",
          value: classOverrideOf(
            configured,
            entries.filter((_, index) => index !== at)
          ),
        };
  }
  const out = change(entry.styles);
  if (out.kind === "refused") return { kind: "gone" };
  // Nothing for the change to do can still leave the rebase to store: the
  // code may since have set the value the change sets, and the stored entry
  // would go on masking it.
  if (out.kind === "unchanged" && (stored === undefined || stored === entry)) {
    return { kind: "unchanged" };
  }
  const changed = {
    ...entry,
    styles: out.kind === "write" ? out.styles : entry.styles,
  };
  const next =
    at === -1
      ? [...entries, changed]
      : entries.map((each, index) => (index === at ? changed : each));
  // Only what differs from the code is stored, as a forward write stores
  // it: an undo that brings a supplied style back to the code's drops it,
  // so a later change in code shows.
  return { kind: "write", value: classOverrideOf(configured, next) };
}

/** A section save's refusal in words, or the fallback when it gave none. */
function refusalOf(
  result: { saved: boolean; issues: Record<string, string> },
  fallback: string
): string | undefined {
  if (result.saved) return undefined;
  const reasons = Object.values(result.issues);
  // An empty `issues` is still a refusal: reporting it as saved is the one
  // outcome that must never be silent.
  return reasons.length > 0 ? reasons.join(" ") : fallback;
}

/**
 * Add a shared style the builder made from a block: appended to the library,
 * through the one queue every class write joins, so it builds on a rename
 * still in flight rather than on the list both started from.
 *
 * The entry comes whole from the builder's save plan (its id, class name,
 * position and the block's styles), so the plan and the store cannot
 * disagree about what was saved.
 */
function useAddClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  const { save: saveSection, reread } = useSaveSiteStyle();
  return useCallback(
    async (entry: NamedClass): Promise<string | undefined> =>
      writes.run<string | undefined>(async existing => {
        if (existing === undefined) {
          return {
            result:
              "This site's shared styles could not be read, so none can be added.",
          };
        }
        /*
         * Judged again against the library the queue holds, just before it
         * stores: a rename that landed after the dialog read the library can
         * have taken this class name, and two styles with one class name would
         * write one selector.
         */
        const taken = sharedStyleNameTaken(
          entry.label ?? entry.slug,
          entry.slug,
          existing
        );
        if (taken !== undefined) return { result: taken };
        const next: NamedClass[] = [...existing, entry];
        /*
         * Only what DIFFERS from the site's own config classes. The base is the
         * MERGED set the canvas compiles, so saving it whole would copy every
         * config class into the database and mask the site's code from then on.
         */
        // Merged from the list it was composed against, so a style saved
        // elsewhere meanwhile is kept.
        const result = await saveSection(
          "classes",
          classOverrideOf(configured, next),
          { base: classOverrideOf(configured, existing) }
        );
        // Stored over someone else's change to a style: said, with Reload.
        toastSaveConflicts("classes", result, reread);
        // `next` is returned ONLY on success, so a refused write never becomes
        // the base the following edit builds on; the merge as stored, where
        // the save met a newer one.
        const refused = refusalOf(
          result,
          "This shared style could not be saved."
        );
        return refused === undefined
          ? {
              result: undefined,
              next: classesAfterSave(result, next, configured),
            }
          : { result: refused };
      }),
    [writes, configured, saveSection, reread]
  );
}

/**
 * Store one shared style's styles, every other key of its entry (its name,
 * its lock) kept. A history step like any style write, so the editor's Undo
 * writes the style's previous styles back.
 */
function useWriteClassStyles(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  const { reserve, reread } = useSaveSiteStyle();
  // The code's styles as they are when a step is undone or redone, not when
  // it was made: the code may change while the step waits in the history.
  const configuredNow = useRef(configured);
  configuredNow.current = configured;
  return useCallback(
    async (
      classId: string,
      change: SharedStyleChange
    ): Promise<string | undefined> => {
      /*
       * The history place is taken NOW, when the author makes the edit; the
       * payload is composed and sent in the queue, after the writes before
       * it. A page edit made while those are stored then comes after this
       * one in the history, as it was made.
       */
      const slot = reserve("classes");
      return writes.run<string | undefined>(async existing => {
        if (existing === undefined) {
          slot.cancel();
          return {
            result:
              "This site's shared styles could not be read, so this one can't be changed.",
          };
        }
        const entry = existing.find(each => each.id === classId);
        if (entry === undefined) {
          slot.cancel();
          return { result: "This shared style is no longer on the site." };
        }
        /*
         * The change applied to the styles as they stand after every write
         * queued before it, rather than an envelope the editor composed from
         * the last read: two edits made before the first is stored would
         * otherwise each carry the read's styles, and the second would undo
         * the first.
         */
        const changed = change(entry.styles);
        // Nothing to save gives the history place up again.
        if (changed.kind !== "write") slot.cancel();
        if (changed.kind === "refused") return { result: changed.reason };
        if (changed.kind === "unchanged") return { result: undefined };
        const next = existing.map(each =>
          each.id === classId ? { ...each, styles: changed.styles } : each
        );
        /*
         * Undone and redone as a change to this one style, composed against
         * the stored classes as they stand then: a whole earlier library
         * written back would also undo what changed elsewhere meanwhile, such
         * as a style removed through the Shared styles tab.
         */
        const undo = change.invert(entry.styles);
        /*
         * Where the write was merged onto another author's newer save, the
         * styles it replaced are theirs, not the ones this edit started from:
         * Undo inverts against those, so it puts their value back rather than
         * the value from before both edits.
         */
        const undoOf = (
          replaced: unknown
        ): SharedStyleChange | typeof REMOVED_BY_THEM => {
          if (replaced === undefined) return undo;
          const theirs = classesFromStored(configured, replaced).find(
            each => each.id === classId
          );
          // Gone from what the write replaced: another author removed the
          // style, and this edit kept it. Undo removes it again.
          return theirs === undefined
            ? REMOVED_BY_THEM
            : change.invert(theirs.styles);
        };
        /*
         * The code the stored entry was last rebased onto: the code this
         * edit was made against, then whatever each replay rebased it onto,
         * so a second change to the code between undo and redo is told
         * from the site's own.
         */
        let baseline = configured;
        const replay =
          (step: SharedStyleChange) =>
          (held: unknown): SiteStyleReplayed => {
            const now = configuredNow.current;
            const out = classChangeOn(held, baseline, now, classId, step);
            if (out.kind !== "gone") baseline = now;
            return out;
          };
        const result = await slot.save(
          classOverrideOf(configured, next),
          {
            undo: (held, replaced) => {
              const step = undoOf(replaced);
              return step === REMOVED_BY_THEM
                ? classRemovedFrom(held, configuredNow.current, classId)
                : replay(step)(held);
            },
            redo: replay(change),
          },
          { base: classOverrideOf(configured, existing) }
        );
        toastSaveConflicts("classes", result, reread);
        const refused = refusalOf(
          result,
          "This shared style could not be changed."
        );
        return refused === undefined
          ? {
              result: undefined,
              next: classesAfterSave(result, next, configured),
            }
          : { result: refused };
      });
    },
    [writes, configured, reserve, reread]
  );
}

/**
 * Rename one class, through the same section write that creates one.
 *
 * Answers the OUTCOME rather than reporting success by staying quiet. A site
 * style save is a network write and the panel clears its field as soon as the
 * author finishes typing, so a refusal that returned nothing would leave the
 * row reading as renamed until the next read contradicted it.
 */
function useRenameClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined,
  /**
   * Take the next attempt for this class and record the name it heads for.
   *
   * Held by the CALLER rather than by the panel, because a rename outlives the
   * panel: switching rail panels unmounts the manager, and a field remembering
   * its own pending name lost it on exactly the switch that makes the window
   * long enough to matter. Without it, an author who reverts a rename after
   * coming back has the revert read as a no-op while the first write lands.
   */
  beginRename: (classId: string, name: string) => number,
  /** Release the pending name, but only if this attempt is still the live one. */
  endRename: (classId: string, attempt: number) => void
) {
  const { reserve, reread } = useSaveSiteStyle();
  return useCallback(
    async (
      classId: string,
      name: { label: string; slug: string }
    ): Promise<ClassRenameOutcome> => {
      const mine = beginRename(classId, name.label);
      /*
       * The history place is taken NOW, as a style edit's is: a rename
       * queued behind writes still being stored would otherwise take its
       * place only once they answered, after a page edit made meanwhile.
       */
      const slot = reserve("classes");
      try {
        return await writes.run<ClassRenameOutcome>(async existing => {
          if (existing === undefined) {
            slot.cancel();
            return {
              result: {
                ok: false as const,
                reason:
                  "This site's shared styles could not be read, so none can be renamed.",
              },
            };
          }
          // The name and the class name derived from it, together; every
          // other key the entry holds, its lock among them, is kept.
          const next = existing.map(entry =>
            entry.id === classId
              ? { ...entry, label: name.label, slug: name.slug }
              : entry
          );
          // A refused save withdraws its place itself. Merged from the list
          // it was composed against, the next edit builds on what was stored.
          const result = await slot.save(
            classOverrideOf(configured, next),
            undefined,
            { base: classOverrideOf(configured, existing) }
          );
          toastSaveConflicts("classes", result, reread);
          if (result.saved) {
            return {
              result: { ok: true as const },
              next: classesAfterSave(result, next, configured),
            };
          }
          const reasons = Object.values(result.issues);
          return {
            result: {
              ok: false as const,
              reason:
                reasons.length > 0
                  ? reasons.join(" ")
                  : "This shared style could not be renamed.",
            },
          };
        });
      } finally {
        /*
         * Cleared however it went, and in a `finally` so a rejection cannot
         * leave a class permanently reading as mid-rename. A refused write
         * leaves the class with the name it had; a successful one is followed
         * by a read carrying the new one. Either way the stored slug is the
         * answer again.
         *
         * Cleared only where THIS attempt is still the live one, which is the
         * whole reason the identity exists: a superseded attempt finishing late
         * would otherwise release a name a newer write is still heading for.
         */
        endRename(classId, mine);
      }
    },
    [writes, configured, reserve, reread, beginRename, endRename]
  );
}
