"use client";

/**
 * The inspector (spec §9). Tabs are auto-generated from the selected block's definition:
 * Content from `def.contentFields` (plugin control set), Style + Responsive from
 * `def.styleControls` + the control registry, Advanced for the customClass escape hatch +
 * block actions. Style edits the base layer; Responsive edits the active breakpoint's
 * override layer so per-device changes are visible in the iframe canvas.
 */
import {
  Button,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";

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
import { locateNode } from "../logic/locate";
import { useEditor } from "../store/EditorProvider";

registerDefaultControls();

const BASE = "base";

function BindableField({
  node,
  field,
}: {
  node: BlockNode;
  field: ContentField;
}) {
  const { dispatch } = useEditor();
  const bound = node.bindings?.[field.name];

  if (!field.bindable) {
    return renderControl(field.type, {
      label: field.label,
      field,
      value: node.props[field.name],
      onChange: value =>
        dispatch({
          type: "UPDATE_PROPS",
          id: node.id,
          props: { [field.name]: value },
        }),
    });
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <Label style={{ fontSize: 12, color: "#6b7280" }}>{field.label}</Label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#6b7280",
          }}
        >
          Bind
          <Switch
            checked={!!bound}
            onCheckedChange={on =>
              dispatch({
                type: "SET_BINDING",
                id: node.id,
                prop: field.name,
                binding: on ? { source: "field", path: "" } : null,
              })
            }
          />
        </label>
      </div>
      {bound ? (
        <>
          <Input
            value={bound.path}
            placeholder="field path, e.g. title or author.name"
            aria-label={`${field.label} binding path`}
            onChange={e =>
              dispatch({
                type: "SET_BINDING",
                id: node.id,
                prop: field.name,
                binding: { source: "field", path: e.target.value },
              })
            }
          />
          <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
            Resolves from the current Query Loop item.
          </p>
        </>
      ) : (
        renderControl(field.type, {
          field,
          value: node.props[field.name],
          onChange: value =>
            dispatch({
              type: "UPDATE_PROPS",
              id: node.id,
              props: { [field.name]: value },
            }),
        })
      )}
    </div>
  );
}

function ContentTab({ node }: { node: BlockNode }) {
  const def = defaultBlockRegistry.get(node.type);
  const fields = narrowContentFields(def?.contentFields);
  if (fields.length === 0) {
    return <Empty>No content options for this block.</Empty>;
  }
  return (
    <div>
      {fields.map((field: ContentField) => (
        <BindableField key={field.name} node={node} field={field} />
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
  const { state, dispatch } = useEditor();
  const loc = locateNode(state.document.root, node.id);
  const move = (delta: number) => {
    if (!loc) return;
    const next = loc.index + delta;
    if (next < 0 || next >= loc.count) return;
    dispatch({
      type: "MOVE",
      id: node.id,
      parentId: loc.parentId,
      slot: loc.slot,
      index: next,
    });
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {loc ? (
        <div style={{ display: "flex", gap: 6 }}>
          <Button
            variant="outline"
            disabled={loc.index <= 0}
            aria-label="Move block up"
            onClick={() => move(-1)}
          >
            ↑ Move up
          </Button>
          <Button
            variant="outline"
            disabled={loc.index >= loc.count - 1}
            aria-label="Move block down"
            onClick={() => move(1)}
          >
            ↓ Move down
          </Button>
        </div>
      ) : null}
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
