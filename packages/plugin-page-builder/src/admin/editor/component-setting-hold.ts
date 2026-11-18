"use client";

/**
 * "Make this a setting of the component", the editor's host half: a new
 * setting of a component, held while the page binds it and written with the
 * page's Save.
 *
 * A component is a document of its own, which every page placing it reads,
 * so a setting added from a page is not written at once:
 * - The server plans it without writing (`dryRun`), which mints the
 *   setting's id and answers the component as it would be, and the
 *   fingerprint of the stored component it was planned against.
 * - The page's side is one edit, the placement's binding of the new setting,
 *   so one undo takes both back: a held setting counts only while the page
 *   still holds a placement's binding of it, and the canvas draws the planned
 *   component meanwhile.
 * - The page's Save writes it, against that fingerprint, so a component
 *   changed since is refused rather than overwritten; a Publish publishes it.
 *   A refused write takes the page's binding back off as one edit, refuses
 *   this Save and offers to save again without it.
 *
 * @module admin/editor/component-setting-hold
 */
import {
  boundSettingId,
  COMPONENT_INSTANCE_TYPE,
  isComponentDocument,
  isPlainRecord,
  settingBindingKey,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentDocument,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import type {
  ComponentSettingAnswer,
  ComponentSettingAsk,
  DefinitionAction,
} from "@nextlyhq/builder/ops";
import type { EditorState } from "@nextlyhq/builder/shell";
import {
  useBeforeDocumentAction,
  useDocumentActions,
  useDocumentLocale,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  definitionActionPath,
  type DefinitionActionResult,
} from "../../composition-actions-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import type { ComponentLibraryRead } from "../component-library-client";

/**
 * One planned setting, held for the page's Save.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface HeldComponentSetting {
  readonly componentId: string;
  /** The id the plan minted, which the placement binds under. */
  readonly settingId: string;
  /** The component as the plan answered it, drawn while the hold is live. */
  readonly definition: ComponentDocument;
  /** The stored component the plan was made against, sent as `expect`. */
  readonly fingerprint: string;
  readonly action: Extract<DefinitionAction, { kind: "expose" }>;
  /** The language it was planned in, and is written in. */
  readonly locale?: string;
}

/** The held settings, one per component. */
type Holds = ReadonlyMap<string, HeldComponentSetting>;

/** Whether a node is a placement of `componentId` binding `key`. */
function bindsHeld(node: BlockNode, componentId: string, key: string): boolean {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return false;
  if (!isPlainRecord(node.props) || node.props.componentId !== componentId) {
    return false;
  }
  return isPlainRecord(node.bindings) && Object.hasOwn(node.bindings, key);
}

/** The placements of a held setting's component that bind it. */
function placementsBinding(
  document: BlockDocument,
  held: HeldComponentSetting
): BlockNode[] {
  const key = settingBindingKey(held.settingId);
  const found: BlockNode[] = [];
  walkNodes(document.nodes, node => {
    if (bindsHeld(node, held.componentId, key)) found.push(node);
  });
  return found;
}

/**
 * The held settings the page still binds: an undo took a hold's binding off
 * with the edit that made it, and the hold goes with it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function liveSettingHolds(
  document: BlockDocument,
  held: Holds
): HeldComponentSetting[] {
  return [...held.values()].filter(
    hold => placementsBinding(document, hold).length > 0
  );
}

/** The stored definitions with each live hold's planned component over them. */
function withHeldDefinitions(
  stored: DefinitionsById,
  live: readonly HeldComponentSetting[]
): DefinitionsById {
  if (live.length === 0) return stored;
  const drawn = new Map(stored);
  for (const hold of live) drawn.set(hold.componentId, hold.definition);
  return drawn;
}

/**
 * A refused hold's binding taken off as one edit, and the words saying so;
 * `unbound: false` when the editor would not take it off (its placement
 * locked since), so the hold stays and no Save stores the binding without
 * its setting.
 */
function refusedHold(
  editor: Pick<EditorState, "document" | "applyAll">,
  hold: HeldComponentSetting,
  title: string,
  refused: string
): { words: string; reason: string; unbound: boolean } {
  const unbound = editor.applyAll(unbindOps(editor.document, hold)) !== null;
  return {
    words: unbound
      ? `“${hold.action.label}” wasn't added to ${title}, so this page's binding to it was taken off. ${refused}`
      : `“${hold.action.label}” wasn't added to ${title}, and this page's binding to it couldn't be taken off, as its placement is locked. ${refused} Unlock it, or take the binding off, and save again.`,
    reason: refused,
    unbound,
  };
}

/**
 * Take off each placement binding of a setting its component doesn't have,
 * which no hold here will make, as one edit, and say so.
 */
function takeOffUnmadeBindings(
  now: {
    readonly editor: Pick<EditorState, "document" | "applyAll">;
    readonly held: Holds;
    readonly library: ComponentLibraryRead;
  },
  written: ReadonlySet<string>
): void {
  const { editor: at, held: holds, library: read } = now;
  const unmade = unmadeSettingBindings(at.document, read, holds, written);
  if (unmade.length === 0) return;
  if (at.applyAll(unmade.map(entry => entry.op)) === null) return;
  const titles = [...new Set(unmade.map(entry => entry.componentId))].map(
    id => read.titleOf(id) ?? "the component"
  );
  toast.warning(
    `This page bound a setting that ${titles.join(" and ")} doesn't have, which was never made, so that binding was taken off before saving.`,
    { duration: REFUSED_TOAST_MS }
  );
}

/**
 * Write each live hold, made before or during the writing, stopping at the
 * first refused: its binding is taken off the page as one edit, and the
 * words saying so are answered.
 */
async function writeEachLive(
  now: {
    readonly current: {
      readonly editor: Pick<EditorState, "document" | "applyAll">;
      readonly held: Holds;
      readonly library: ComponentLibraryRead;
    };
  },
  drop: (componentId: string) => void,
  written: Set<string>
): Promise<{ readonly words: string; readonly reason: string } | undefined> {
  const next = (): HeldComponentSetting | undefined =>
    liveSettingHolds(now.current.editor.document, now.current.held)[0];
  if (next() === undefined) return undefined;
  const read = now.current.library;
  try {
    // Asked again after each write rather than listed once: a setting made
    // while one is being written is bound by the page this Save stores, so
    // it is written before the Save goes on. Each written hold is dropped,
    // so this ends once no new one is made.
    for (let hold = next(); hold !== undefined; hold = next()) {
      const refused = await writeHeld(hold);
      if (refused === undefined) {
        written.add(writtenKey(hold.componentId, hold.settingId));
        drop(hold.componentId);
        continue;
      }
      const title = read.titleOf(hold.componentId) ?? "The component";
      const answer = refusedHold(now.current.editor, hold, title, refused);
      if (answer.unbound) drop(hold.componentId);
      return answer;
    }
    return undefined;
  } finally {
    read.retry();
  }
}

/**
 * Why a new setting of a component must wait, if it must: one is still being
 * planned for it, or one is held for the page's Save.
 */
function waitingRefusal(
  ask: ComponentSettingAsk,
  now: {
    readonly editor: Pick<EditorState, "document">;
    readonly held: Holds;
    readonly library: ComponentLibraryRead;
  },
  planning: ReadonlySet<string>
): string | undefined {
  const title = now.library.titleOf(ask.componentId) ?? "this component";
  if (planning.has(ask.componentId)) {
    return `Wait a moment: a new setting of ${title} is still being made.`;
  }
  const holding = liveSettingHolds(now.editor.document, now.held).some(
    hold => hold.componentId === ask.componentId
  );
  return holding
    ? `Save the page first: ${title} has a new setting waiting to be saved with it.`
    : undefined;
}

/**
 * Refuse the page's Save for a held setting its component refused, saying
 * why, with the way to save again; nothing when none was refused.
 */
function refuseSave(
  refused: { readonly words: string; readonly reason: string } | undefined,
  saveAgain: () => void
): void {
  if (refused === undefined) return;
  toast.error(`${refused.words} Nothing was saved yet.`, {
    duration: REFUSED_TOAST_MS,
    action: { label: "Save again", onClick: saveAgain },
  });
  throw new Error(refused.reason);
}

/** A written setting's key: its component and its id. */
function writtenKey(componentId: string, settingId: string): string {
  return `${componentId}\u0000${settingId}`;
}

/**
 * Each placement binding of a setting its component doesn't have, and the
 * edit taking it off: judged only against a library read whole, for a
 * component it holds, past the settings held or written here.
 */
function unmadeSettingBindings(
  document: BlockDocument,
  library: ComponentLibraryRead,
  held: Holds,
  written: ReadonlySet<string>
): { readonly componentId: string; readonly op: BuilderOp }[] {
  if (library.state !== "ready" || library.truncated) return [];
  const found: { componentId: string; op: BuilderOp }[] = [];
  walkNodes(document.nodes, node => {
    if (node.type !== COMPONENT_INSTANCE_TYPE) return;
    if (!isPlainRecord(node.props) || !isPlainRecord(node.bindings)) return;
    const componentId = node.props.componentId;
    if (typeof componentId !== "string") return;
    const definition = library.definitions.get(componentId);
    if (definition === undefined) return;
    const exposed: unknown = isComponentDocument(definition)
      ? definition.exposed
      : undefined;
    const has = new Set(
      (Array.isArray(exposed) ? (exposed as unknown[]) : []).flatMap(entry =>
        isPlainRecord(entry) && typeof entry.id === "string" ? [entry.id] : []
      )
    );
    const kept: NonNullable<BlockNode["bindings"]> = {};
    let dropped = false;
    for (const [key, binding] of Object.entries(node.bindings)) {
      const id = boundSettingId(key);
      const unmade =
        id !== undefined &&
        !has.has(id) &&
        held.get(componentId)?.settingId !== id &&
        !written.has(writtenKey(componentId, id));
      if (unmade) dropped = true;
      else kept[key] = binding as NonNullable<BlockNode["bindings"]>[string];
    }
    if (!dropped) return;
    found.push({
      componentId,
      op:
        Object.keys(kept).length === 0
          ? { kind: "update", id: node.id, patch: {}, unset: ["bindings"] }
          : { kind: "update", id: node.id, patch: { bindings: kept } },
    });
  });
  return found;
}

/** The edit taking a refused hold's bindings off every placement holding one. */
function unbindOps(
  document: BlockDocument,
  held: HeldComponentSetting
): BuilderOp[] {
  const key = settingBindingKey(held.settingId);
  return placementsBinding(document, held).map(node => {
    const { [key]: _gone, ...kept } = isPlainRecord(node.bindings)
      ? node.bindings
      : {};
    return Object.keys(kept).length === 0
      ? { kind: "update", id: node.id, patch: {}, unset: ["bindings"] }
      : { kind: "update", id: node.id, patch: { bindings: kept } };
  });
}

/** The route's answer inside its mutation envelope. */
interface Envelope {
  readonly item: DefinitionActionResult;
}

/** One definition action on the route, as this author. */
async function sendAction(
  componentId: string,
  body: Record<string, unknown>
): Promise<DefinitionActionResult | undefined> {
  const answer = await writePluginRoute<Envelope>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: definitionActionPath(componentId),
    body,
  });
  return answer?.item;
}

/** What a failed request says, past a refusal with no words. */
function reasonOf(error: unknown): string {
  if ((error as { status?: unknown } | null)?.status === 409) {
    return "The component was changed by someone else since.";
  }
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The component couldn't be saved.";
}

/**
 * The plan of a new setting, or why it would be refused, in the language the
 * page is edited in: a translated component is drawn in that language, so it
 * is changed in it.
 */
async function planSetting(
  ask: ComponentSettingAsk,
  locale: string | undefined
): Promise<HeldComponentSetting | { readonly refusal: string }> {
  const action = {
    kind: "expose" as const,
    nodeId: ask.nodeId,
    propPath: ask.propPath,
    label: ask.label,
  };
  let planned: DefinitionActionResult | undefined;
  try {
    planned = await sendAction(ask.componentId, {
      action,
      dryRun: true,
      ...(locale === undefined ? {} : { locale }),
    });
  } catch (error) {
    return { refusal: reasonOf(error) };
  }
  if (planned === undefined) {
    return { refusal: "The setting couldn't be planned. Try again." };
  }
  const refusal = planned.refusals[0];
  if (refusal !== undefined) return { refusal };
  return {
    componentId: ask.componentId,
    settingId: planned.targetId,
    definition: planned.definition,
    fingerprint: planned.fingerprint,
    action,
    ...(locale === undefined ? {} : { locale }),
  };
}

/**
 * Write one held setting to its component's working draft, or say why it was
 * not: the route refused it, the component changed since its plan, or the
 * write minted another id than the page binds.
 *
 * Never published from here, a page's Publish included: the component's
 * draft may hold other unpublished changes, which would go live on every page
 * placing it. A page published binding a setting its live component lacks is
 * named by the publish dialog instead, which asks before publishing the
 * component.
 */
async function writeHeld(
  hold: HeldComponentSetting
): Promise<string | undefined> {
  try {
    const written = await sendAction(hold.componentId, {
      action: hold.action,
      expect: hold.fingerprint,
      ...(hold.locale === undefined ? {} : { locale: hold.locale }),
    });
    if (written === undefined) return "The component couldn't be saved.";
    return written.targetId === hold.settingId
      ? undefined
      : "The component was changed by someone else since.";
  } catch (error) {
    return reasonOf(error);
  }
}

/** How long the refusal stays: long enough to read it and save again. */
const REFUSED_TOAST_MS = 15_000;

/**
 * The held settings of an editor: the library it draws with, each live hold
 * over the stored component, and the host service that plans one.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function useComponentSettingHold(
  editor: Pick<EditorState, "document" | "applyAll">,
  library: ComponentLibraryRead
): {
  readonly library: ComponentLibraryRead;
  readonly makeComponentSetting: (
    ask: ComponentSettingAsk
  ) => Promise<ComponentSettingAnswer>;
  /**
   * Write each held setting before the editor closes for the form, where
   * nothing holds it: `false` when one was refused and its binding taken
   * off, so the editor stays open showing that. `true` at once when none
   * is held, so an ordinary leave stays synchronous.
   */
  readonly writeHeldSettings: () => true | Promise<boolean>;
} {
  const [held, setHeld] = useState<Holds>(() => new Map());
  // Read when an answer or the Save arrives, never from the render that
  // asked, so an edit made meanwhile is what is judged.
  const now = useRef({ editor, held, library });
  now.current = { editor, held, library };
  const actions = useDocumentActions();
  const locale = useDocumentLocale()?.code ?? undefined;
  // The language and the actions as they are when an answer arrives.
  const at = useRef({ language: locale, run: actions?.run });
  at.current = { language: locale, run: actions?.run };

  const live = useMemo(
    () => liveSettingHolds(editor.document, held),
    [editor.document, held]
  );
  const drawn = useMemo(
    () =>
      live.length === 0
        ? library
        : {
            ...library,
            definitions: withHeldDefinitions(library.definitions, live),
          },
    [library, live]
  );

  const drop = useCallback((componentId: string) => {
    const without = (current: Holds): Holds => {
      if (!current.has(componentId)) return current;
      const next = new Map(current);
      next.delete(componentId);
      return next;
    };
    setHeld(without);
    // Read by a later write before this render commits.
    now.current = { ...now.current, held: without(now.current.held) };
  }, []);

  // The components a plan is being made for, so a second pick of the same
  // one waits rather than replacing the first plan's hold; and the settings
  // written from here, which the library may not show yet while it reads
  // the component again.
  const kept = useRef({
    planning: new Set<string>(),
    written: new Set<string>(),
  });

  const makeComponentSetting = useCallback(
    async (ask: ComponentSettingAsk): Promise<ComponentSettingAnswer> => {
      const { planning } = kept.current;
      const waiting = waitingRefusal(ask, now.current, planning);
      if (waiting !== undefined) return { refusal: waiting };
      planning.add(ask.componentId);
      let planned: Awaited<ReturnType<typeof planSetting>>;
      try {
        planned = await planSetting(ask, at.current.language);
      } finally {
        planning.delete(ask.componentId);
      }
      if ("refusal" in planned) return planned;
      setHeld(current => new Map(current).set(ask.componentId, planned));
      // Read by a Save before this render commits.
      now.current = {
        ...now.current,
        held: new Map(now.current.held).set(ask.componentId, planned),
      };
      return { settingId: planned.settingId };
    },
    []
  );

  const writeHeldSettings = useCallback((): true | Promise<boolean> => {
    const { editor: shown, held: holds } = now.current;
    if (liveSettingHolds(shown.document, holds).length === 0) return true;
    return writeEachLive(now, drop, kept.current.written).then(refused => {
      if (refused === undefined) return true;
      toast.error(refused.words, { duration: REFUSED_TOAST_MS });
      return false;
    });
  }, [drop]);

  useBeforeDocumentAction(async (action, store) => {
    // A binding of a setting its component doesn't have, which no hold here
    // will make, as a page recovered after a reload holds, goes first.
    takeOffUnmadeBindings(now.current, kept.current.written);
    const { editor: shown, held: holds } = now.current;
    if (liveSettingHolds(shown.document, holds).length === 0) return;
    // A tracked write that failed refuses the Save anyway; the component is
    // written only with a page that will be stored.
    if (!(await store.writesSettled())) return;
    refuseSave(
      await writeEachLive(now, drop, kept.current.written),
      () => void at.current.run?.(action)
    );
  });

  return { library: drawn, makeComponentSetting, writeHeldSettings };
}

/**
 * An editor's mount with its held settings: the library drawn with each live
 * hold over the stored component, and the service the placement panel plans
 * a new setting with.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function useHeldComponentSettings<
  M extends {
    readonly editor: Pick<EditorState, "document" | "applyAll">;
    readonly componentLibrary: ComponentLibraryRead;
  },
>(
  mount: M
): M & {
  readonly makeComponentSetting: ReturnType<
    typeof useComponentSettingHold
  >["makeComponentSetting"];
  readonly writeHeldSettings: ReturnType<
    typeof useComponentSettingHold
  >["writeHeldSettings"];
} {
  const held = useComponentSettingHold(mount.editor, mount.componentLibrary);
  return {
    ...mount,
    componentLibrary: held.library,
    makeComponentSetting: held.makeComponentSetting,
    writeHeldSettings: held.writeHeldSettings,
  };
}

/**
 * A leave for the form that writes the held settings first, and leaves only
 * once they are written: the form saves the page, and once the editor closes
 * nothing holds a setting the page binds.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function useLeavingWithHeldSettings(
  writeHeldSettings: () => true | Promise<boolean>,
  leave: () => void
): () => void {
  // The leave as it is when the writes end, not as it was when they began:
  // it commits the document it closes over, and the author may edit while
  // they are in flight.
  const latest = useRef(leave);
  latest.current = leave;
  return useMemo(
    () => leavingWithHeldSettings(writeHeldSettings, () => latest.current()),
    [writeHeldSettings]
  );
}

/** `useLeavingWithHeldSettings`'s leave, outside React. */
export function leavingWithHeldSettings(
  writeHeldSettings: () => true | Promise<boolean>,
  leave: () => void
): () => void {
  return () => {
    const written = writeHeldSettings();
    if (written === true) {
      leave();
      return;
    }
    void written.then(closes => {
      if (closes) leave();
    });
  };
}
