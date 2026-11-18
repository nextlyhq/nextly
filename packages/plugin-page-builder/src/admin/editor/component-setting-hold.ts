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
import type { EditorState } from "@nextlyhq/builder/shell";
import type {
  ComponentSettingAnswer,
  ComponentSettingAsk,
  DefinitionAction,
} from "@nextlyhq/builder/ops";
import {
  useBeforeDocumentAction,
  useDocumentActions,
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

/** The plan of a new setting, or why it would be refused. */
async function planSetting(
  ask: ComponentSettingAsk
): Promise<HeldComponentSetting | { readonly refusal: string }> {
  const action = {
    kind: "expose" as const,
    nodeId: ask.nodeId,
    propPath: ask.propPath,
    label: ask.label,
  };
  let planned: DefinitionActionResult | undefined;
  try {
    planned = await sendAction(ask.componentId, { action, dryRun: true });
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
  };
}

/**
 * Write one held setting with the page's action, or say why it was not: the
 * route refused it, the component changed since its plan, or the write minted
 * another id than the page binds.
 */
async function writeHeld(
  hold: HeldComponentSetting,
  publish: boolean
): Promise<string | undefined> {
  try {
    const written = await sendAction(hold.componentId, {
      action: hold.action,
      expect: hold.fingerprint,
      ...(publish ? { publish: true } : {}),
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
} {
  const [held, setHeld] = useState<Holds>(() => new Map());
  // Read when an answer or the Save arrives, never from the render that
  // asked, so an edit made meanwhile is what is judged.
  const now = useRef({ editor, held, library });
  now.current = { editor, held, library };
  const actions = useDocumentActions();
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
    setHeld(current => {
      if (!current.has(componentId)) return current;
      const next = new Map(current);
      next.delete(componentId);
      return next;
    });
  }, []);

  const makeComponentSetting = useCallback(
    async (ask: ComponentSettingAsk): Promise<ComponentSettingAnswer> => {
      const { editor: at, held: holds, library: read } = now.current;
      if (
        liveSettingHolds(at.document, holds).some(
          hold => hold.componentId === ask.componentId
        )
      ) {
        const title = read.titleOf(ask.componentId) ?? "This component";
        return {
          refusal: `Save the page first: ${title} has a new setting waiting to be saved with it.`,
        };
      }
      const planned = await planSetting(ask);
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

  useBeforeDocumentAction(async (action, store) => {
    const { editor: at, held: holds, library: read } = now.current;
    const pending = liveSettingHolds(at.document, holds);
    if (pending.length === 0) return;
    // A tracked write that failed refuses the Save anyway; the component is
    // written only with a page that will be stored.
    if (!(await store.writesSettled())) return;
    for (const hold of pending) {
      const refused = await writeHeld(hold, action === "publish");
      drop(hold.componentId);
      if (refused === undefined) continue;
      now.current.editor.applyAll(unbindOps(now.current.editor.document, hold));
      const title = read.titleOf(hold.componentId) ?? "The component";
      toast.error(
        `“${hold.action.label}” wasn't added to ${title}, so this page's binding to it was taken off. ${refused} Nothing was saved yet.`,
        {
          duration: REFUSED_TOAST_MS,
          action: {
            label: "Save again",
            onClick: () => void run.current?.(action),
          },
        }
      );
      throw new Error(refused);
    }
    read.retry();
  });

  return { library: drawn, makeComponentSetting };
}
