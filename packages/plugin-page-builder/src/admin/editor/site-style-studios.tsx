"use client";

/**
 * The editor's writers of the site style: the tokens studio, the class
 * surface, the fonts panel's upload and the breakpoints writer, with the
 * readings of the stored style each of them offers from.
 *
 * Kept apart from the editor component because each owns state or a write
 * queue of its own, and none of it is about the document being edited.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-studios
 */
import {
  newId,
  resolveSiteTokens,
  type BreakpointSet,
  type FontFaceDef,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  authoredBreakpoints,
  FontsPanel,
  TokensPanel,
  type ClassCreation,
  type ClassRenameOutcome,
  type FontFaceUpload,
  type FontsPanelProps,
} from "@nextlyhq/builder/shell";
import { useUploadMedia } from "@nextlyhq/plugin-sdk/admin";
import { WEB_FONT_FORMATS } from "nextly/config";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  classOverrideOf,
  tokenOverrideOf,
  tokenSaveOutcome,
  type SiteStyleData,
} from "../../site-style";
import { useSaveSiteStyle } from "../site-style-client";
import { useShown } from "../use-shown";

/**
 * The faces the site loads, or `undefined` while that is not yet known.
 *
 * The same third state `offerableTokens` keeps, and for the same reason: a site
 * that self-hosts nothing legitimately has no faces, so a surface cannot tell
 * "none stored" from "the read has not come back" by looking at the value. The
 * fonts panel draws those two differently, and would otherwise report a site
 * mid-load as one loading no fonts at all.
 *
 * Unlike tokens there are no engine defaults to layer underneath — a font file
 * is something a site provides or does not — so the resolved list is returned
 * as it stands, including an empty one.
 */
export function offerableFaces(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): readonly FontFaceDef[] | undefined {
  if (pending || error !== null) return undefined;
  return style?.fonts ?? [];
}

/**
 * The tokens as the PAGE renders them, defaults included.
 *
 * Deliberately not `offerableTokens`. A studio edits what the site AUTHORED —
 * showing the engine's defaults as rows an author can rename would offer edits
 * that write nothing — while a report on what the page draws has to read what
 * the page draws. `resolveSiteTokens` layers the engine's own underneath, and
 * one of them is `font.body: system-ui`, a real typeface every site renders
 * with. Reading the authored set had the panel announce "no typeface tokens"
 * for a site whose every page was using one.
 */
export function renderedTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  return resolveSiteTokens(style?.tokens);
}

/**
 * The tokens an inspector may offer, or `undefined` while the site's own tier
 * is still unknown.
 *
 * Withheld on exactly the two states that hold the CANVAS back, and for the
 * same reason. Until the stored read answers, the merged value is the config
 * defaults alone — a real design rather than a placeholder — so a picker fed
 * from it offers a token by a name and a colour the site may have overridden,
 * and the identity an author chooses then resolves to something else on the
 * published page. The error path matters as much as the pending one: `pending`
 * is false there while the value has still fallen back to defaults.
 *
 * `undefined` rather than an empty set, because the control reads absence as
 * "the question was never asked" and offers no picker at all — which is the
 * truth here, and is different from a site that defines no tokens.
 */
export function offerableTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  // A SET even when the site defines nothing, because the renderer compiles
  // with `resolveSiteTokens`, which layers the engine's own defaults underneath.
  // A site with no tokens of its own still emits `color.text`, `color.primary`
  // and the rest, so handing over `undefined` here would have the picker offer
  // none of them — and `undefined` already means something else to the control:
  // that the question was never asked.
  return style?.tokens ?? { tokens: [] };
}

/**
 * The tokens studio, and the state that belongs to it rather than to the editor.
 *
 * Its own component because the token set an author is part-way through editing
 * is the STUDIO's business: the editor around it owns a document, and a panel's
 * unsaved half-state living in that editor is state with no reader outside one
 * branch of one render.
 *
 * Saved as it is edited rather than behind a save button. A token is site-wide,
 * so the canvas behind this panel is the preview — an unsaved edit would show
 * the author a page no visitor would see, with no other surface on which to
 * notice the difference.
 */
export function TokensStudio({
  merged,
  supplied,
  pending,
}: {
  /** The site's tokens as the canvas compiles them: config under stored. */
  merged: SiteTokenSet | undefined;
  /** What the site's own code supplies, which the stored tier layers over. */
  supplied: SiteTokenSet | undefined;
  /** Whether the read is still in flight, as against having failed. */
  pending: boolean;
}): React.JSX.Element {
  const { save } = useSaveSiteStyle();
  /*
   * What the CANVAS resolves, which is what the studio has to show and edit.
   *
   * `resolveSiteTokens` layers the engine's own defaults — `color.primary`,
   * `color.text`, `space.4` and the rest — under whatever the site states, and
   * the renderer compiles with it. Without that step here, the studio reports
   * every category empty on a site that states no tokens of its own, while the
   * page it is previewing is actively using them and the colour picker beside
   * it offers them. They could then be neither seen nor overridden: adding a
   * token and renaming it to a default's label does not reach one, because the
   * rename freezes the new token's own identity.
   *
   * The baseline for the override is resolved for the same reason. Storing what
   * differs from the CONFIG alone would write every engine default into the
   * database on the first edit — the same fault as saving the merged set, one
   * tier further down.
   */
  const editable = merged === undefined ? undefined : resolveSiteTokens(merged);
  const baseline = resolveSiteTokens(supplied);
  /*
   * The studio's own latest set, and the authority while it is open.
   *
   * `useSiteStyle` answers from a query refetched only after a save lands, so
   * two edits made before that — two blurs, two removals, a double Add — would
   * both compose against the SAME snapshot and the second would overwrite the
   * first. Nothing would report it: the mutation serialises the payloads and
   * neither fails. Composing against this means every edit builds on the last.
   */
  const [edits, show, shownNow] = useShown<SiteTokenSet | null>(null);
  const [issue, setIssue] = useState<string | undefined>(undefined);
  /*
   * The last set a save is KNOWN to have stored, and what a refused edit falls
   * back to — not "whatever was on screen before it", which after an earlier
   * refusal is itself a value the site never accepted.
   */
  const persisted = useRef<SiteTokenSet | null>(null);
  /* The most recent edit handed to a save, and the one question both branches
   * of an answer ask: is this still about what the author is looking at? */
  const latest = useRef<SiteTokenSet | null>(null);

  const commit = (next: SiteTokenSet): void => {
    show(next);
    setIssue(undefined);
    latest.current = next;
    void save(
      "tokens",
      /*
       * Only what DIFFERS from the site's own defaults. `merged` is what the
       * canvas compiles, so saving it whole would copy every config token into
       * the database on the first edit and mask the site's code from then on.
       */
      tokenOverrideOf(baseline, next)
    ).then(result => {
      const outcome = tokenSaveOutcome(
        result.saved,
        result.issues,
        next,
        latest.current,
        persisted.current
      );
      if (result.saved) persisted.current = next;
      if (outcome.tokens !== undefined) show(outcome.tokens);
      if (outcome.issue !== undefined) setIssue(outcome.issue ?? undefined);
    });
  };

  return (
    <TokensPanel
      tokens={edits ?? editable}
      supplied={baseline}
      issue={issue}
      absence={pending ? "pending" : "failed"}
      onChange={commit}
      /*
       * The set as it is at the moment an import needs it, rather than the one
       * the panel last rendered with. `shown` is written before React is told
       * anything, so it answers for an edit the panel has not been re-rendered
       * with yet.
       */
      currentTokens={() => shownNow() ?? editable}
    />
  );
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
    <T,>(
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

  create: (slug: string) => Promise<ClassCreation>;
  /** Which classes are mid-rename, for the manager's no-op check. */
  pendingSlugs: Record<string, string>;

  currentRenameAttempt: (classId: string) => number;

  rename: (classId: string, slug: string) => Promise<ClassRenameOutcome>;
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
  const [pendingSlugs, setPendingSlugs] = useState<Record<string, string>>({});
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
  const beginRename = useCallback((classId: string, slug: string): number => {
    const mine = (renameAttempts.current.get(classId) ?? 0) + 1;
    renameAttempts.current.set(classId, mine);
    setPendingSlugs(current =>
      current[classId] === slug ? current : { ...current, [classId]: slug }
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
    setPendingSlugs(current => {
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
    create: useCreateClass(writes, configured),
    /** Which classes are mid-rename, for the manager's no-op check. */
    pendingSlugs,
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
    rename: useRenameClass(writes, configured, beginRename, endRename),
  };
}

/**
 * Create a named class in the site's library, answering with its new id.
 *
 * Two documents are involved and this owns only one. The class lives in the
 * site style; putting it on a block is a node write the inspector already
 * performs, so this returns the id rather than applying it — one application
 * path, and the per-node bound stays enforced in a single place.
 *
 * The id is minted with the engine's own `newId`, which is where every other id
 * in this repository comes from. Deliberately not derived from the slug:
 * `NamedClass` keeps `id` and `slug` apart precisely so a rename cannot orphan
 * the documents referencing it, and a slug-seeded id would be a fossil of
 * whatever the class was called first.
 *
 * `orderIndex` is one past the highest in the library, so a class an author has
 * just created and applied wins over the ones already there rather than being
 * silently overridden by them.
 */
function useCreateClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  // Its own write handle rather than one passed in. The caller is already the
  // largest component in this file, and a dependency a hook can obtain for
  // itself is a statement that does not need to live there.
  const { save: saveSection } = useSaveSiteStyle();
  return useCallback(
    async (slug: string): Promise<ClassCreation> =>
      // Composed INSIDE the queue, so a creation following a rename builds on
      // that rename rather than on the list they both started from.
      //
      // The result type is stated rather than inferred: inference takes the
      // first branch it meets, which is the refusal, and the success branch
      // then fails to assign.
      writes.run<ClassCreation>(async existing => {
        if (existing === undefined) {
          return {
            result: {
              ok: false as const,
              reason:
                "This site's classes could not be read, so none can be added.",
            },
          };
        }
        const classId = newId();
        const next: NamedClass[] = [
          ...existing,
          {
            id: classId,
            slug,
            orderIndex: nextOrderIndex(existing),
            styles: {},
          },
        ];
        /*
         * Only what DIFFERS from the site's own config classes. The base is the
         * MERGED set the canvas compiles, so saving it whole would copy every
         * config class into the database on the first creation and mask the
         * site's code from then on — the argument `tokenOverrideOf` already
         * makes for tokens.
         */
        const result = await saveSection(
          "classes",
          classOverrideOf(configured, next)
        );
        // `next` is returned ONLY on success, so a refused write never becomes
        // the base the following edit builds on.
        if (result.saved) {
          return { result: { ok: true as const, classId }, next };
        }
        const reasons = Object.values(result.issues);
        // An empty `issues` is still a refusal — the transport could not
        // describe it. Reporting it as saved is the one outcome that must never
        // be silent, which is the rule the breakpoints writer below follows too.
        return {
          result: {
            ok: false as const,
            reason:
              reasons.length > 0
                ? reasons.join(" ")
                : "This class could not be saved.",
          },
        };
      }),
    [writes, configured, saveSection]
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
  beginRename: (classId: string, slug: string) => number,
  /** Release the pending name, but only if this attempt is still the live one. */
  endRename: (classId: string, attempt: number) => void
) {
  const { save: saveSection } = useSaveSiteStyle();
  return useCallback(
    async (classId: string, slug: string): Promise<ClassRenameOutcome> => {
      const mine = beginRename(classId, slug);
      try {
        return await writes.run<ClassRenameOutcome>(async existing => {
          if (existing === undefined) {
            return {
              result: {
                ok: false as const,
                reason:
                  "This site's classes could not be read, so none can be renamed.",
              },
            };
          }
          const next = existing.map(entry =>
            entry.id === classId ? { ...entry, slug } : entry
          );
          const result = await saveSection(
            "classes",
            classOverrideOf(configured, next)
          );
          if (result.saved) return { result: { ok: true as const }, next };
          const reasons = Object.values(result.issues);
          return {
            result: {
              ok: false as const,
              reason:
                reasons.length > 0
                  ? reasons.join(" ")
                  : "This class could not be renamed.",
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
    [writes, configured, saveSection, beginRename, endRename]
  );
}

/** One past the highest position in the library, or zero for an empty one. */
function nextOrderIndex(library: readonly NamedClass[]): number {
  return library.reduce(
    (highest, entry) =>
      Number.isFinite(entry.orderIndex)
        ? Math.max(highest, entry.orderIndex + 1)
        : highest,
    0
  );
}

/**
 * The record an upload answers with, derived from the hook rather than restated.
 *
 * Naming the shape here would be this file's second opinion about what the
 * media pipeline returns, and it would go on compiling after that shape moved.
 */
type UploadedMedia = Awaited<
  ReturnType<ReturnType<typeof useUploadMedia>["mutateAsync"]>
>;

/**
 * Store a font file on this site, then declare the `@font-face` that loads it.
 *
 * Two writes that have to happen in this order and cannot be one: the file must
 * exist and have an id before anything can point at it, and a face pointing at
 * an id that was never stored is a family the page silently fails to load.
 *
 * The face is built from what upload validation SETTLED on rather than from
 * what the browser guessed — `media.mimeType` is the type the bytes were proved
 * to be, so the `format()` hint in the emitted rule cannot disagree with the
 * file the route will serve.
 *
 * @param stored - The faces already declared, which the new one is appended to
 * @returns A writer answering with a message when it refused, `undefined` when
 *   the face is stored
 */
function useFontFaceWriter(
  stored: readonly FontFaceDef[] | undefined,
  storedPending: boolean,
  unreadableFonts: readonly string[]
): (request: FontFaceUpload) => Promise<string | undefined> {
  const { save: saveSiteStyle } = useSaveSiteStyle();
  const { mutateAsync: uploadMedia } = useUploadMedia();
  /*
   * Every face this writer has saved, kept until the read reports it back.
   *
   * `useUpdateSingleDocument` starts its invalidation with `void`, so the save
   * resolves BEFORE the refetch that carries the new face into `stored`. An
   * author adding a family's regular and its bold in quick succession reaches
   * the second add while `stored` still describes the document as it was, and
   * a base taken from it saves the second face over the first.
   *
   * Held rather than reset on arrival, and UNIONED with `stored` below: once
   * the read catches up the two agree and the union is `stored` exactly, so
   * there is no moment when this has to be judged stale. The union is also
   * what keeps a face added from another surface in the meantime — a reset
   * base would drop it.
   */
  const written = useRef<readonly FontFaceDef[]>([]);
  /*
   * The last file that reached storage, and what it became.
   *
   * The two writes cannot be one — the bytes must have an id before a face can
   * point at one — so a refused style write leaves a stored object no face
   * references. The form keeps the `File` on a refusal so the author can fix
   * the descriptors and resubmit, and without this each attempt uploaded the
   * same bytes again: a run of validation failures left a copy per attempt.
   *
   * Keyed on the `File` itself, which is the identity the picker hands over
   * and which changes exactly when the author chooses a different file.
   */
  const uploaded = useRef<{ file: File; media: UploadedMedia } | null>(null);

  return useCallback(
    async (request: FontFaceUpload): Promise<string | undefined> => {
      /*
       * Refused rather than guessed at. `save` replaces the section outright,
       * so appending to a stored tier that has not arrived writes the new face
       * ALONE and discards every face already stored — and the author is told
       * it saved.
       *
       * The panel does not render the form while the read is in flight, so
       * nothing reaches this through the UI and no test drives it. It stays
       * because the callback is the host's to hand out and a boolean over a
       * value already in hand costs nothing, while the failure it prevents is
       * silent data loss.
       */
      if (storedPending) {
        return "This site's fonts are still loading. Try again in a moment.";
      }

      /*
       * Refused BEFORE the upload, because the alternative is deletion.
       *
       * `stored` is the read's value, which drops any row it cannot type, and
       * `save` replaces the section outright — so appending to it saves a list
       * those rows are missing from, and the write succeeds, because what it
       * sends is exactly what the checker approves.
       *
       * Not a capability withdrawn: `refusing` in the storage module rejects a
       * write over any issue at all, so such a row already blocks every save of
       * this section. Refusing here names it, and does so before an upload
       * whose bytes nothing would reference.
       */
      if (unreadableFonts.length > 0) {
        return `This site stores a font this version cannot read (${unreadableFonts.join(", ")}), and adding one would replace it. Repair or remove that entry first.`;
      }

      const stored_ = await storeOnce(request.file, uploaded, uploadMedia);
      if (typeof stored_ === "string") return stored_;
      const media = stored_;

      /*
       * The picker's `accept` is a hint a caller can bypass, and the media
       * pipeline accepts far more than fonts. A PNG stored here would be saved
       * as a face with no `format()` — which `validateFontFace` permits — and
       * the byte route answers 404 for every type outside the servable set, so
       * the site would carry a family that silently never loads.
       *
       * Decided on the type upload validation SETTLED on rather than the one
       * the browser guessed, which is the same value the route will check the
       * bytes against.
       */
      const format = fontFormatFor(media.mimeType);
      if (format === undefined) {
        return `A font file has to be .woff2 or .woff — this one was stored as ${media.mimeType}.`;
      }

      const face: FontFaceDef = {
        family: request.family,
        /*
         * The route that serves bytes to a reader with no session. A stored
         * media URL is not usable here: `validateFontFace` refuses anything
         * carrying a scheme or an authority, and a backend that stores absolute
         * URLs would produce exactly that.
         */
        src: [{ url: `/api/media/${media.id}/raw`, format }],
        weight: request.weight,
        style: request.style,
      };

      const next = [...appendBase(stored, written.current), face];
      const result = await saveSiteStyle("fonts", next);
      if (result.saved) {
        // Stored and referenced, so the next add starts clean rather than
        // pointing a second face at the first face's bytes.
        uploaded.current = null;
        written.current = next;
        return undefined;
      }
      /*
       * Joined rather than picked from, for the reason the breakpoint writer
       * joins: `issues` is keyed by path, and taking the first tells an author
       * about one refused field while a second is also refused.
       */
      const reasons = Object.values(result.issues);
      return reasons.length > 0
        ? reasons.join(" ")
        : "That font could not be saved.";
    },
    [saveSiteStyle, stored, storedPending, unreadableFonts, uploadMedia]
  );
}

/**
 * Everything a new face must be saved alongside: what was read, plus what this
 * writer saved that the read has not reported back yet.
 *
 * A union rather than a choice between the two. Picking `written` while it
 * looks ahead would drop a face added from another surface since; picking
 * `stored` drops the one just saved. Order follows `stored`, so a face keeps
 * the position the document gives it and an unreported one lands after —
 * where it will be once the read catches up.
 *
 * @param stored - The read's faces, or `undefined` before it arrives
 * @param written - Faces this writer has saved, oldest first
 * @returns The faces to append to
 */
function appendBase(
  stored: readonly FontFaceDef[] | undefined,
  written: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  const base = stored ?? [];
  const present = new Set(base.map(faceIdentity));
  return [...base, ...written.filter(face => !present.has(faceIdentity(face)))];
}

/**
 * What makes two face records the same stored row.
 *
 * The sources carry it: a face added here points at one media object, whose id
 * is minted by the upload, so two adds never collide and a re-read of the same
 * row always matches. Family, weight and style join it because a document may
 * legitimately point two faces at one file — a variable font serving both an
 * upright and a synthesised oblique is the ordinary case.
 */
function faceIdentity(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/**
 * The fonts panel, with the writer that adds a face.
 *
 * Its own component rather than another hook in the editor: the editor already
 * carries more state than one screen can hold, and a panel that needs a writer
 * is the thing that should own it. The upload also concerns nobody else on this
 * surface, so the editor gains one element and no new state.
 */
export function FontsPanelWithUpload({
  faces,
  tokens,
  absence,
  onOpenTokens,
  storedFaces,
  storedPending,
  unreadableFonts,
}: FontsPanelProps & {
  storedFaces: readonly FontFaceDef[] | undefined;
  storedPending: boolean;
  unreadableFonts: readonly string[];
}): React.JSX.Element {
  const addFontFace = useFontFaceWriter(
    storedFaces,
    storedPending,
    unreadableFonts
  );
  return (
    <FontsPanel
      absence={absence}
      acceptFiles={FONT_FILE_ACCEPT}
      faces={faces}
      onAddFace={addFontFace}
      onOpenTokens={onOpenTokens}
      tokens={tokens}
    />
  );
}

/**
 * Put a file on this site, at most once per file.
 *
 * The two writes an added face needs cannot be one — the bytes must have an id
 * before a face can point at one — so a refused style write leaves a stored
 * object no face references. The form keeps the `File` on a refusal so the
 * author can correct the descriptors and press Add again, and re-uploading on
 * each attempt turned a run of refusals into a copy per attempt.
 *
 * @param file - What the author chose, and the identity this remembers by
 * @param seen - Where the last stored file and its record are kept
 * @param upload - The media pipeline's own mutation
 * @returns The stored record, or a message the author can act on
 */
async function storeOnce(
  file: File,
  seen: React.MutableRefObject<{ file: File; media: UploadedMedia } | null>,
  upload: (input: { file: File }) => Promise<UploadedMedia>
): Promise<UploadedMedia | string> {
  const remembered = seen.current;
  if (remembered !== null && remembered.file === file) return remembered.media;

  try {
    const media = await upload({ file });
    seen.current = { file, media };
    return media;
  } catch (reason) {
    /*
     * The upload's own refusal, which is the one an author can act on: it names
     * the format, the size cap or the signature mismatch. Replacing it with
     * wording of our own would describe a policy this surface does not hold.
     */
    return reason instanceof Error
      ? reason.message
      : "That file could not be uploaded.";
  }
}

/**
 * The `format()` hint for a validated media type.
 *
 * Read from the same table the upload gate, the public byte route and the
 * admin dropzone read, so this panel cannot come to disagree with any of them
 * about what a web font is. A restated map is the shape that drifts: a format
 * core adds would be stored and served while this panel refused the type it
 * had just accepted, and the author would see a font the site handles
 * everywhere except the one screen offering to add it.
 *
 * An unrecognised type contributes no hint at all rather than a guessed one:
 * `format()` is advisory, and a browser told the wrong format skips the source
 * entirely.
 */
function fontFormatFor(mimeType: string): string | undefined {
  const settled = mimeType.toLowerCase().trim();
  return WEB_FONT_FORMATS.find(format => format.mimeType === settled)
    ?.formatKeyword;
}

/**
 * What the file picker offers, in the two vocabularies a picker accepts.
 *
 * Both, because neither alone is enough. A `.woff2` chosen from disk is
 * reported with no type at all on the platforms that do not carry fonts in
 * their registry, so a types-only `accept` hides the file the author came to
 * add; an extensions-only one hides a font handed over by a tool that names it
 * correctly and spells it differently.
 */
const FONT_FILE_ACCEPT: string = WEB_FONT_FORMATS.flatMap(format => [
  format.extension,
  format.mimeType,
]).join(",");

/**
 * Writing the site's breakpoints, for the manager in the top bar.
 *
 * A hook rather than a callback inside the editor, because that component is
 * already the largest branch point on this surface and every decision folded
 * into it is one more path through the whole thing. What it needs from here is
 * one stable function.
 *
 * Section-scoped, so this sends the breakpoints and nothing else — the other
 * three fields of the record are owned by other studios and are not read here in
 * order to write this one.
 */
export function useBreakpointWriter(
  configSiteStyle: SiteStyleData | undefined
): (next: BreakpointSet) => Promise<string | undefined> {
  const { save: saveSiteStyle } = useSaveSiteStyle();
  /*
   * Whether the HOST states breakpoints in its config, which is what makes an
   * empty stored set unrepresentable. Read from the config tier rather than from
   * the merged value, because the merged one cannot tell a stored set from a
   * defaulted one — which is the ambiguity being guarded.
   *
   * Through the SAME base filter the manager uses. A config carrying only the
   * built-in `{ id: "base" }` row states no authored breakpoint, so counting it
   * refuses the one save that returns such a site to its base-only state — and
   * tells the author to remove a config row the manager deliberately hides as
   * built in. Three surfaces now ask this question and all three ask it once.
   */
  const configuredAuthored = authoredBreakpoints(configSiteStyle?.breakpoints);
  const configured =
    configuredAuthored.viewport.length > 0 ||
    configuredAuthored.container.length > 0;

  return useCallback(
    async (next: BreakpointSet): Promise<string | undefined> => {
      /*
       * An empty set is not storable as an intention while the host states
       * defaults, so it is refused rather than reported as saved.
       *
       * `resolveSiteStyle` layers the stored record over the host's config and
       * decides "was anything stored" with `hasBreakpoints`, which is
       * `viewport.length > 0 || container.length > 0`. So writing
       * `{ viewport: [], container: [] }` succeeds, reads back as NOTHING
       * STORED, and the config defaults return — the author removes every row,
       * is told it saved, and watches them reappear.
       *
       * Refusing says what happened and where the remaining breakpoints come
       * from, which is the one thing the author cannot see from this screen.
       * Representing "explicitly none" would take a stored-format change, and
       * that is not a decision this callback should make silently.
       */
      const emptied = next.viewport.length === 0 && next.container.length === 0;
      if (emptied && configured) {
        return "Your site's configuration defines these breakpoints, so removing them all here would restore them. Remove them from the config instead.";
      }
      const result = await saveSiteStyle("breakpoints", next);
      if (result.saved) return undefined;
      const reasons = Object.values(result.issues);
      // `issues` can be empty on a refusal the transport could not describe.
      // Answering `undefined` there would report a save that did not happen,
      // which is the one outcome that must never be silent.
      return reasons.length > 0
        ? reasons.join(" ")
        : "These breakpoints could not be saved.";
    },
    [saveSiteStyle, configured]
  );
}

/**
 * What the stored site style's read has DONE, in the manager's three words.
 *
 * Named rather than written inline for the reason the writer moved out of the
 * editor component: every decision folded into that function is another path
 * through the whole of it, and `fallow` reports the growth as introduced
 * complexity.
 *
 * `error === null`, not `!== undefined`. `useSiteStyle` types the field as
 * `Error | null` and normalises a successful read to `null`, so an `undefined`
 * comparison is true on success as well as on failure — the mistake that once
 * withheld the provenance trace unconditionally.
 */
export function siteStyleStatus(
  pending: boolean,
  error: Error | null
): "loading" | "unavailable" | "ready" {
  if (pending) return "loading";
  return error === null ? "ready" : "unavailable";
}
