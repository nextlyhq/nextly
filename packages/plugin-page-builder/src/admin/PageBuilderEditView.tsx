"use client";

/**
 * The full-screen page editor, mounted as the `pages` collection Edit-view override.
 * Renders inside the admin content area. Loads the stored block tree (or an empty one),
 * wires the store + canvas + save shell.
 */
import { makeNode } from "../core/tree";
import type { BlockDocument } from "../core/types";
import "../render/blocks"; // register block renderers so the canvas + store defaults work

import { EditorSurface } from "./EditorSurface";
import { SaveShell } from "./SaveShell";
import { EditorProvider, draftKeyFor } from "./store/EditorProvider";
import type { CustomEditViewProps } from "./types";
import { useRemotePatterns } from "./useRemotePatterns";

function emptyDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

export function PageBuilderEditView(props: CustomEditViewProps) {
  // The canvas renders the same blocks the published page does, so it enforces
  // the same allowlist. The edit-view props are core's contract and carry no
  // plugin configuration, so it is read from the plugin's own admin metadata.
  const remotePatterns = useRemotePatterns();
  const data = props.initialData ?? {};
  const doc = (data.content as BlockDocument | undefined) ?? emptyDoc();
  const customCss = typeof data.customCss === "string" ? data.customCss : "";

  return (
    <EditorProvider
      document={doc}
      draftKey={draftKeyFor(props.collectionSlug, props.entryId)}
      customCss={customCss}
      remotePatterns={remotePatterns}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SaveShell props={props} />
        {/*
         * The full edit view has somewhere to go, so it supplies the exit. The
         * field mounts do not and deliberately leave it unset, which is what makes
         * the shell draw no exit affordance there rather than an inert one.
         */}
        <EditorSurface onExit={props.onCancel} />
      </div>
    </EditorProvider>
  );
}
