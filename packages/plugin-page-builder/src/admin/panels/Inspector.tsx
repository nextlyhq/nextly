"use client";

/**
 * The inspector (spec §9). A polished, three-tab settings panel generated from the
 * selected block's definition:
 *  - Content — `def.contentFields` via the plugin control set (with per-field "bind"
 *    toggles for Query Loop data).
 *  - Style   — `def.styleControls`, with a Normal / Hover state switch (hover writes
 *    `node.styleHover`) and the active device breakpoint (from the toolbar) shown inline.
 *  - Advanced — reorder, custom class, duplicate / delete.
 */
import {
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

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
import { ArrowDown, ArrowUp, blockIcon, Copy, Trash2 } from "../icons";
import { locateNode } from "../logic/locate";
import { useEditor } from "../store/EditorProvider";

import { firstPopulatedTab } from "./inspectorTabs";

registerDefaultControls();

const BASE = "base";
type Tab = "content" | "style" | "advanced";
type StyleState = "normal" | "hover";

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="nx-pb-section-label">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="nx-pb-empty">{children}</p>;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="nx-pb-seg" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className="nx-pb-seg-btn"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

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
        <Label className="nx-pb-control-label">{field.label}</Label>
        <label
          className="nx-pb-control-label"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
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
          <p className="nx-pb-empty" style={{ marginTop: 2 }}>
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
    return <Empty>This block has no content options.</Empty>;
  }
  return (
    <div>
      <SectionLabel>Content</SectionLabel>
      {fields.map(field => (
        <BindableField key={field.name} node={node} field={field} />
      ))}
    </div>
  );
}

function StyleTab({
  node,
  styleState,
  setStyleState,
}: {
  node: BlockNode;
  styleState: StyleState;
  setStyleState: (v: StyleState) => void;
}) {
  const { state, dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const controls = def?.styleControls ?? [];
  const bp = state.activeBreakpoint;
  const tree = styleState === "hover" ? node.styleHover : node.style;

  if (controls.length === 0) {
    return <Empty>This block has no style options.</Empty>;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Segmented<StyleState>
          value={styleState}
          onChange={setStyleState}
          ariaLabel="Style state"
          options={[
            { value: "normal", label: "Normal" },
            { value: "hover", label: "Hover" },
          ]}
        />
        <span
          className="nx-pb-device-badge"
          data-active={bp !== BASE || undefined}
          title="Editing styles for this device (change with the toolbar)"
        >
          {bp === BASE ? "Desktop" : bp}
        </span>
      </div>

      {styleState === "hover" ? (
        <p className="nx-pb-empty" style={{ margin: "0 0 10px" }}>
          Applied on <strong>:hover</strong>; empty values fall back to Normal.
        </p>
      ) : null}

      <SectionLabel>Style</SectionLabel>
      {controls.map((ref: ControlRef) => (
        <div key={`${ref.control}:${ref.styleKey}`}>
          {renderControl(ref.control, {
            label: ref.label,
            value: readStyleValue(tree, ref.styleKey, bp),
            onChange: value =>
              dispatch({
                type: "UPDATE_STYLE",
                id: node.id,
                breakpoint: bp,
                styleState,
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
    <div style={{ display: "grid", gap: 14 }}>
      {loc ? (
        <div>
          <SectionLabel>Arrange</SectionLabel>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="nx-pb-icon-btn"
              disabled={loc.index <= 0}
              aria-label="Move block up"
              onClick={() => move(-1)}
            >
              <ArrowUp size={15} aria-hidden /> Up
            </button>
            <button
              type="button"
              className="nx-pb-icon-btn"
              disabled={loc.index >= loc.count - 1}
              aria-label="Move block down"
              onClick={() => move(1)}
            >
              <ArrowDown size={15} aria-hidden /> Down
            </button>
            <button
              type="button"
              className="nx-pb-icon-btn"
              aria-label="Duplicate block"
              onClick={() => dispatch({ type: "DUPLICATE", id: node.id })}
            >
              <Copy size={15} aria-hidden /> Duplicate
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <SectionLabel>Custom CSS class</SectionLabel>
        {renderControl("text", {
          value: node.customClass ?? "",
          onChange: value =>
            dispatch({
              type: "SET_CUSTOM_CLASS",
              id: node.id,
              customClass: typeof value === "string" ? value : "",
            }),
        })}
      </div>

      <div className="nx-pb-empty">
        Type <code>{node.type}</code>
      </div>

      <button
        type="button"
        className="nx-pb-icon-btn"
        aria-label="Delete block"
        style={{
          color: "hsl(var(--destructive))",
          borderColor: "hsl(var(--destructive) / 0.4)",
        }}
        onClick={() => dispatch({ type: "REMOVE", id: node.id })}
      >
        <Trash2 size={15} aria-hidden /> Delete block
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector shell
// ---------------------------------------------------------------------------

export function Inspector() {
  const { state } = useEditor();
  const [tab, setTab] = useState<Tab>("content");
  const [styleState, setStyleState] = useState<StyleState>("normal");
  const node = state.selectedId
    ? findNode(state.document.root, state.selectedId)
    : undefined;
  const def = node ? defaultBlockRegistry.get(node.type) : undefined;

  // On selection change, open a populated tab and reset Hover mode, so panel state from
  // the previously-selected block never leaks (spec §3.5).
  useEffect(() => {
    setTab(firstPopulatedTab(def));
    setStyleState("normal");
  }, [state.selectedId]);

  if (!node) {
    return (
      <>
        <div className="nx-pb-pane-header">Settings</div>
        <div className="nx-pb-inspector-empty">
          Select a block on the canvas to edit its content and style.
        </div>
      </>
    );
  }

  const Icon = blockIcon(def?.icon);

  return (
    <div className="nx-pb-inspector">
      <div className="nx-pb-inspector-header">
        <span className="nx-pb-block-icon">
          <Icon size={16} aria-hidden />
        </span>
        <div>
          <div className="nx-pb-inspector-title">{def?.label ?? node.type}</div>
          <div className="nx-pb-inspector-sub">{def?.category ?? "block"}</div>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={v => setTab(v as Tab)}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <TabsList style={{ margin: "10px 12px 0" }}>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <div style={{ padding: 12, overflow: "auto", flex: 1 }}>
          <TabsContent value="content">
            <ContentTab node={node} />
          </TabsContent>
          <TabsContent value="style">
            <StyleTab
              node={node}
              styleState={styleState}
              setStyleState={setStyleState}
            />
          </TabsContent>
          <TabsContent value="advanced">
            <AdvancedTab node={node} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
