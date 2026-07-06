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
import { Button, Input, Label, Switch } from "@nextlyhq/ui";
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
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: "#9ca3af",
        margin: "4px 0 8px",
      }}
    >
      {children}
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        gap: 2,
        background: "#f3f4f6",
        borderRadius: 8,
      }}
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          style={{
            border: "none",
            cursor: "pointer",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: value === o.value ? "#111827" : "#6b7280",
            background: value === o.value ? "#fff" : "transparent",
            boxShadow: value === o.value ? "0 1px 2px rgba(0,0,0,.08)" : "none",
          }}
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
          options={[
            { value: "normal", label: "Normal" },
            { value: "hover", label: "Hover" },
          ]}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: bp === BASE ? "#9ca3af" : "#4338ca",
            background: bp === BASE ? "transparent" : "#eef2ff",
            padding: bp === BASE ? 0 : "2px 8px",
            borderRadius: 6,
          }}
          title="Editing styles for this device (change with the toolbar)"
        >
          {bp === BASE ? "Desktop" : bp}
        </span>
      </div>

      {styleState === "hover" ? (
        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 10px" }}>
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
            <Button
              variant="outline"
              disabled={loc.index <= 0}
              aria-label="Move block up"
              onClick={() => move(-1)}
            >
              ↑ Up
            </Button>
            <Button
              variant="outline"
              disabled={loc.index >= loc.count - 1}
              aria-label="Move block down"
              onClick={() => move(1)}
            >
              ↓ Down
            </Button>
            <Button
              variant="outline"
              aria-label="Duplicate block"
              onClick={() => dispatch({ type: "DUPLICATE", id: node.id })}
            >
              ⧉ Duplicate
            </Button>
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

      <div style={{ fontSize: 11, color: "#9ca3af" }}>
        <div>
          Type <code>{node.type}</code>
        </div>
      </div>

      <Button
        variant="destructive"
        aria-label="Delete block"
        onClick={() => dispatch({ type: "REMOVE", id: node.id })}
      >
        Delete block
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector shell
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "style", label: "Style" },
  { id: "advanced", label: "Advanced" },
];

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
  // Depends only on the selection id: reset when the selected block changes, not when
  // `def`/setters change identity.
  useEffect(() => {
    setTab(firstPopulatedTab(def));
    setStyleState("normal");
  }, [state.selectedId]);

  if (!node) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: "#9ca3af" }}>
        Select a block on the canvas to edit its content and style.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 12px 0" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
          {def?.label ?? node.type}
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
          {def?.category ?? "block"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            background: "#f3f4f6",
            borderRadius: 8,
          }}
        >
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                border: "none",
                cursor: "pointer",
                borderRadius: 6,
                padding: "6px 0",
                fontSize: 12,
                fontWeight: 600,
                color: tab === t.id ? "#111827" : "#6b7280",
                background: tab === t.id ? "#fff" : "transparent",
                boxShadow: tab === t.id ? "0 1px 2px rgba(0,0,0,.08)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: 12, overflow: "auto", flex: 1 }}>
        {tab === "content" && <ContentTab node={node} />}
        {tab === "style" && (
          <StyleTab
            node={node}
            styleState={styleState}
            setStyleState={setStyleState}
          />
        )}
        {tab === "advanced" && <AdvancedTab node={node} />}
      </div>
    </div>
  );
}
