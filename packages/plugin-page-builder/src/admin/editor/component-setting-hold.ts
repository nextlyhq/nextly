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
  COMPONENT_INSTANCE_TYPE,
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
  const language = useRef(locale);
  language.current = locale;
  const run = useRef(actions?.run);
  run.current = actions?.run;

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
  // one waits rather than replacing the first plan's hold.
  const planning = useRef(new Set<string>());

  const makeComponentSetting = useCallback(
    async (ask: ComponentSettingAsk): Promise<ComponentSettingAnswer> => {
      const title = (): string =>
        now.current.library.titleOf(ask.componentId) ?? "this component";
      const holding = (): boolean =>
        liveSettingHolds(now.current.editor.document, now.current.held).some(
          hold => hold.componentId === ask.componentId
        );
      if (planning.current.has(ask.componentId)) {
        return {
          refusal: `Wait a moment: a new setting of ${title()} is still being made.`,
        };
      }
      if (holding()) {
        return {
          refusal: `Save the page first: ${title()} has a new setting waiting to be saved with it.`,
        };
      }
      planning.current.add(ask.componentId);
      let planned: Awaited<ReturnType<typeof planSetting>>;
      try {
        planned = await planSetting(ask, language.current);
      } finally {
        planning.current.delete(ask.componentId);
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

  /**
   * Write each live hold, stopping at the first refused: its binding is
   * taken off the page as one edit, and the words saying so are answered.
   */
  const writeLive = useCallback(async (): Promise<
    { readonly words: string; readonly reason: string } | undefined
  > => {
    const pending = liveSettingHolds(
      now.current.editor.document,
      now.current.held
    );
    if (pending.length === 0) return undefined;
    const read = now.current.library;
    try {
      for (const hold of pending) {
        const refused = await writeHeld(hold);
        drop(hold.componentId);
        if (refused === undefined) continue;
        now.current.editor.applyAll(
          unbindOps(now.current.editor.document, hold)
        );
        const title = read.titleOf(hold.componentId) ?? "The component";
        return {
          words: `“${hold.action.label}” wasn't added to ${title}, so this page's binding to it was taken off. ${refused}`,
          reason: refused,
        };
      }
      return undefined;
    } finally {
      read.retry();
    }
  }, [drop]);

  const writeHeldSettings = useCallback((): true | Promise<boolean> => {
    const { editor: at, held: holds } = now.current;
    if (liveSettingHolds(at.document, holds).length === 0) return true;
    return writeLive().then(refused => {
      if (refused === undefined) return true;
      toast.error(refused.words, { duration: REFUSED_TOAST_MS });
      return false;
    });
  }, [writeLive]);

  useBeforeDocumentAction(async (action, store) => {
    const { editor: at, held: holds } = now.current;
    if (liveSettingHolds(at.document, holds).length === 0) return;
    // A tracked write that failed refuses the Save anyway; the component is
    // written only with a page that will be stored.
    if (!(await store.writesSettled())) return;
    const refused = await writeLive();
    if (refused === undefined) return;
    toast.error(`${refused.words} Nothing was saved yet.`, {
      duration: REFUSED_TOAST_MS,
      action: {
        label: "Save again",
        onClick: () => void run.current?.(action),
      },
    });
    throw new Error(refused.reason);
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
