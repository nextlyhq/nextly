"use client";

/**
 * Content width as the Style tab's Layout section draws it, for a container
 * that declares it: read from the block's own settings and written to them.
 *
 * @module content-width-fields
 */
import { findNode, type BlockNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useCanvasTokenMode } from "./canvas/prefers-dark";
import {
  CONTENT_WIDTH_HELD,
  ContentWidthControl,
  OWN_WIDTH_PROP,
  storedWidthOf,
  widthVariables,
} from "./content-width-control";
import type { EditorState } from "./editor-state";
import {
  inspectSelection,
  lockViewOf,
  propIsWritable,
  propPatch,
  type EditableProp,
} from "./inspector";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";

/** The prop that says whether a container is Boxed. */
const CONTAINED_PROP = "contained";

/** The block's own settings a Style section draws, by the section's key. */
function styleRowsOf(
  editor: EditorState,
  nodeId: string,
  sectionKey: string
): readonly EditableProp[] {
  const inspection = inspectSelection(
    editor.document,
    nodeId,
    lockViewOf(editor)
  );
  return (
    inspection?.sections.styleProps.find(section => section.key === sectionKey)
      ?.rows ?? []
  );
}

/** Set one of the block's settings, as the Content tab sets one. */
function commitSetting(
  editor: EditorState,
  nodeId: string,
  name: string,
  value: unknown
): void {
  const document = editor.document;
  if (!propIsWritable(document, nodeId, name, lockViewOf(editor))) return;
  const node: BlockNode | undefined = findNode(document.nodes, nodeId);
  if (node === undefined) return;
  editor.apply({
    kind: "update",
    id: nodeId,
    patch: propPatch(node, name, value),
  });
}

/**
 * Why the block's own settings can't be changed where the panel is: they
 * belong to the block, so not while a shared style is edited, and they are one
 * value whatever the state, so not while a state other than Normal is.
 */
function contentWidthHeld(
  target: { readonly kind: string },
  state: string
): string | undefined {
  return target.kind !== "block" || state !== "base"
    ? CONTENT_WIDTH_HELD
    : undefined;
}

/**
 * Content width at the top of a container's Layout section, or nothing for a
 * block that does not declare it.
 */
export function ContentWidthFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const mode = useCanvasTokenMode();
  const { editor, nodeId, state, tokens } = surroundings;
  const rows = styleRowsOf(editor, nodeId, "layout");
  const contained = rows.find(row => row.name === CONTAINED_PROP);
  if (contained === undefined) return null;
  const own = rows.find(row => row.name === OWN_WIDTH_PROP);
  const boxed = (contained.value ?? contained.defaultValue) === true;
  const locked = contained.readOnly ? "Held by a lock on this area" : undefined;
  const held = locked ?? contentWidthHeld(target, state);
  // Refused here as well as disabled there: a control that reaches a write
  // while held must still not change the block.
  const write = (name: string, value: unknown) => {
    if (held === undefined) commitSetting(editor, nodeId, name, value);
  };
  return (
    <ContentWidthControl
      contained={boxed}
      width={storedWidthOf(own?.value)}
      tokens={tokens}
      variables={widthVariables(tokens, mode)}
      held={held}
      onContained={next => write(CONTAINED_PROP, next)}
      onWidth={next => write(OWN_WIDTH_PROP, next)}
    />
  );
}
