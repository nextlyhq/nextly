"use client";

/**
 * The inspector (spec §9). Tabs are auto-generated from the selected block's definition:
 * Content from `def.contentFields` (plugin control set), Style + Responsive from
 * `def.styleControls` + the control registry, Advanced for the customClass escape hatch +
 * block actions. Style edits the base layer; Responsive edits the active breakpoint's
 * override layer so per-device changes are visible in the iframe canvas.
 */
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";

import { defaultBlockRegistry } from "../../core/registry";
import { readStyleValue } from "../../core/responsive";
import { findNode } from "../../core/tree";
import type { BlockNode, ControlRef } from "../../core/types";
import {
  narrowContentFields,
  type ContentField,
} from "../content/contentFields";
import {
  registerDefaultControls,
  renderControl,
} from "../controls/registerDefaultControls";
import { useEditor } from "../store/EditorProvider";

registerDefaultControls();

const BASE = "base";

function ContentTab({ node }: { node: BlockNode }) {
  const { dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const fields = narrowContentFields(def?.contentFields);
  if (fields.length === 0) {
    return <Empty>No content options for this block.</Empty>;
  }
  return (
    <div>
      {fields.map((field: ContentField) => (
        <div key={field.name}>
          {renderControl(field.type, {
            label: field.label,
            field,
            value: node.props[field.name],
            onChange: value =>
              dispatch({
                type: "UPDATE_PROPS",
                id: node.id,
                props: { [field.name]: value },
              }),
          })}
        </div>
      ))}
    </div>
  );
}

function StyleTab({
  node,
  breakpoint,
}: {
  node: BlockNode;
  breakpoint: string;
}) {
  const { dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const controls = def?.styleControls ?? [];
  if (controls.length === 0) {
    return <Empty>No style options for this block.</Empty>;
  }
  const isOverride = breakpoint !== BASE;
  return (
    <div>
      {isOverride ? (
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
          Editing <strong>{breakpoint}</strong> overrides. Empty values fall
          back to the base style.
        </p>
      ) : null}
      {controls.map((ref: ControlRef) => (
        <div key={`${ref.control}:${ref.styleKey}`}>
          {renderControl(ref.control, {
            label: ref.label,
            value: readStyleValue(node.style, ref.styleKey, breakpoint),
            onChange: value =>
              dispatch({
                type: "UPDATE_STYLE",
                id: node.id,
                breakpoint,
                style: { [ref.styleKey]: value },
              }),
          })}
        </div>
      ))}
    </div>
  );
}

function AdvancedTab({ node }: { node: BlockNode }) {
  const { dispatch } = useEditor();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        {renderControl("text", {
          label: "Custom CSS class",
          value: node.customClass ?? "",
          onChange: value =>
            dispatch({
              type: "SET_CUSTOM_CLASS",
              id: node.id,
              customClass: typeof value === "string" ? value : "",
            }),
        })}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>
        <div>
          Type: <code>{node.type}</code>
        </div>
        <div>
          ID: <code>{node.id}</code>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button
          variant="outline"
          onClick={() => dispatch({ type: "DUPLICATE", id: node.id })}
        >
          Duplicate
        </Button>
        <Button
          variant="destructive"
          onClick={() => dispatch({ type: "REMOVE", id: node.id })}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>
      {children}
    </p>
  );
}

export function Inspector() {
  const { state } = useEditor();
  const node = state.selectedId
    ? findNode(state.document.root, state.selectedId)
    : undefined;

  if (!node) {
    return (
      <div style={{ fontSize: 13, color: "#9ca3af", padding: 8 }}>
        Select a block to edit its content and style.
      </div>
    );
  }

  const def = defaultBlockRegistry.get(node.type);

  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        {def?.label ?? node.type}
      </div>
      <Tabs defaultValue="content">
        <TabsList style={{ width: "100%" }}>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
          <TabsTrigger value="responsive">Responsive</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          <ContentTab node={node} />
        </TabsContent>
        <TabsContent value="style">
          <StyleTab node={node} breakpoint={BASE} />
        </TabsContent>
        <TabsContent value="responsive">
          <StyleTab node={node} breakpoint={state.activeBreakpoint} />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedTab node={node} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
