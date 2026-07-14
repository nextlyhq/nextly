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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import { getPath } from "../../core/bindings";
import { defaultBlockRegistry } from "../../core/registry";
import { readStyleValue } from "../../core/responsive";
import { normalizeSupports } from "../../core/supports";
import { tokenSwatches } from "../../core/tokens";
import { findNode } from "../../core/tree";
import type { Binding, BlockNode, ControlRef } from "../../core/types";
import { QUERY_LOOP_TYPE } from "../../render/query/types";
import {
  getCollectionFields,
  getSampleEntries,
  type CollectionField,
} from "../api/collectionsApi";
import {
  narrowContentFields,
  type ContentField,
} from "../content/contentFields";
import { AttributesControl } from "../controls/advanced/AttributesControl";
import { CustomCssControl } from "../controls/advanced/CustomCssControl";
import { MotionControl } from "../controls/advanced/MotionControl";
import {
  registerDefaultControls,
  renderControl,
} from "../controls/registerDefaultControls";
import { supportsToControls } from "../controls/supportsToControls";
import { ArrowDown, ArrowUp, blockIcon, Copy, Trash2 } from "../icons";
import { locateNode } from "../logic/locate";
import { findEnclosingLoop } from "../logic/queryLoop";
import { useEditor } from "../store/EditorProvider";

import { firstPopulatedTab } from "./inspectorTabs";
import { QueryLoopSettings } from "./QueryLoopSettings";

const NONE = "__none__";

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

/** A short, safe preview string for a resolved binding value. */
function previewText(v: unknown): string {
  if (v == null) return "—";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else s = JSON.stringify(v) ?? "—";
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/**
 * Binding editor for a bindable field. Inside a Query Loop we discover the loop collection's
 * fields and show a field DROPDOWN plus a live value from a sample entry; outside a loop (or
 * if discovery fails) we fall back to a raw path input.
 */
function BindingPathEditor({
  node,
  field,
  binding,
}: {
  node: BlockNode;
  field: ContentField;
  binding: Binding;
}) {
  const { state, dispatch } = useEditor();
  const loop = findEnclosingLoop(state.document.root, node.id);
  const collection =
    loop && typeof loop.props.collection === "string"
      ? loop.props.collection
      : "";
  const [fields, setFields] = useState<CollectionField[]>([]);
  const [sample, setSample] = useState<Record<string, unknown> | null>(null);

  const setPath = (path: string) =>
    dispatch({
      type: "SET_BINDING",
      id: node.id,
      prop: field.name,
      binding: { source: "field", path },
    });

  useEffect(() => {
    let alive = true;
    if (!collection) {
      setFields([]);
      setSample(null);
      return;
    }
    getCollectionFields(collection)
      .then(f => alive && setFields(f))
      .catch(() => alive && setFields([]));
    getSampleEntries(collection, { limit: 1 })
      .then(rows => alive && setSample(rows[0] ?? null))
      .catch(() => alive && setSample(null));
    return () => {
      alive = false;
    };
  }, [collection]);

  // No loop context / discovery unavailable → raw path input.
  if (!collection || fields.length === 0) {
    return (
      <>
        <Input
          value={binding.path}
          placeholder="field path, e.g. title or author.name"
          aria-label={`${field.label} binding path`}
          onChange={e => setPath(e.target.value)}
        />
        <p className="nx-pb-empty" style={{ marginTop: 2 }}>
          Resolves from the current Query Loop item.
        </p>
      </>
    );
  }

  return (
    <>
      <Select
        value={binding.path || NONE}
        onValueChange={v => setPath(v === NONE ? "" : v)}
      >
        <SelectTrigger aria-label={`${field.label} field`}>
          <SelectValue placeholder="Choose a field…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Choose a field…</SelectItem>
          {fields.map(f => (
            <SelectItem key={f.name} value={f.name}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="nx-pb-empty" style={{ marginTop: 2 }}>
        {binding.path ? (
          <>
            Preview:{" "}
            <strong>{previewText(getPath(sample ?? {}, binding.path))}</strong>
          </>
        ) : (
          "Pick a field from the loop collection."
        )}
      </p>
    </>
  );
}

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
        <BindingPathEditor node={node} field={field} binding={bound} />
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
  // The Query Loop authors through its own discovery-driven panel, not content fields.
  if (node.type === QUERY_LOOP_TYPE) {
    return <QueryLoopSettings node={node} />;
  }
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
  const legacy = def?.styleControls ?? [];
  const groups = supportsToControls(def?.supports);
  const bp = state.activeBreakpoint;
  const tree = styleState === "hover" ? node.styleHover : node.style;

  if (legacy.length === 0 && groups.length === 0) {
    return <Empty>This block has no style options.</Empty>;
  }

  const renderRef = (ref: ControlRef) => (
    <div key={`${ref.control}:${ref.styleKey}`}>
      {renderControl(ref.control, {
        label: ref.label,
        value: readStyleValue(tree, ref.styleKey, bp),
        tokens: ref.control === "color" ? tokenSwatches() : undefined,
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
  );

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

      {groups.map(g => (
        <div key={g.group}>
          <SectionLabel>{g.group}</SectionLabel>
          {g.controls.map(renderRef)}
        </div>
      ))}

      {legacy.length ? (
        <>
          <SectionLabel>Style</SectionLabel>
          {legacy.map(renderRef)}
        </>
      ) : null}
    </div>
  );
}

const VISIBILITY_BREAKPOINTS: { id: string; label: string }[] = [
  { id: "base", label: "desktop" },
  { id: "tablet", label: "tablet" },
  { id: "mobile", label: "mobile" },
];

function AdvancedTab({ node }: { node: BlockNode }) {
  const { state, dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const sup = normalizeSupports(def?.supports);
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

      {sup.customAttributes ? (
        <>
          <div>
            <SectionLabel>CSS ID</SectionLabel>
            {renderControl("text", {
              value: node.cssId ?? "",
              onChange: value =>
                dispatch({
                  type: "SET_CSS_ID",
                  id: node.id,
                  cssId: typeof value === "string" ? value : "",
                }),
            })}
          </div>
          <div>
            <SectionLabel>Attributes</SectionLabel>
            <AttributesControl
              value={node.attributes}
              onChange={value =>
                dispatch({
                  type: "SET_ATTRIBUTES",
                  id: node.id,
                  attributes: (value ?? {}) as Record<string, string>,
                })
              }
            />
          </div>
        </>
      ) : null}

      {sup.visibility ? (
        <div>
          <SectionLabel>Visibility</SectionLabel>
          {VISIBILITY_BREAKPOINTS.map(bp => (
            <label
              key={bp.id}
              style={{ display: "flex", gap: 6, alignItems: "center" }}
            >
              <input
                type="checkbox"
                checked={node.visibility?.[bp.id] === false}
                onChange={e =>
                  dispatch({
                    type: "SET_VISIBILITY",
                    id: node.id,
                    breakpoint: bp.id,
                    visible: !e.target.checked,
                  })
                }
              />
              Hide on {bp.label}
            </label>
          ))}
        </div>
      ) : null}

      {sup.motion ? (
        <div>
          <SectionLabel>Motion</SectionLabel>
          <MotionControl
            value={node.motion}
            onChange={value =>
              dispatch({
                type: "SET_MOTION",
                id: node.id,
                motion: value ?? {},
              })
            }
          />
        </div>
      ) : null}

      {sup.customCss ? (
        <div>
          <SectionLabel>Custom CSS</SectionLabel>
          <CustomCssControl
            value={node.customCss}
            onChange={value =>
              dispatch({
                type: "SET_BLOCK_CSS",
                id: node.id,
                css: typeof value === "string" ? value : "",
              })
            }
          />
        </div>
      ) : null}

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

/**
 * Page-level settings, shown when no block is selected. Currently hosts the page
 * custom-CSS editor (Edit view only). Selectors are scoped to the page root on
 * render, so CSS here cannot leak onto the rest of the site.
 */
function PagePanel() {
  const { state, dispatch } = useEditor();
  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Page</SectionLabel>
      <Label htmlFor="nx-pb-page-css" className="nx-pb-control-label">
        Custom CSS
      </Label>
      <Textarea
        id="nx-pb-page-css"
        value={state.customCss}
        spellCheck={false}
        rows={12}
        placeholder={".hero {\n  color: rebeccapurple;\n}"}
        style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
        onChange={e =>
          dispatch({ type: "SET_PAGE_CUSTOM_CSS", customCss: e.target.value })
        }
      />
      <p className="nx-pb-empty" style={{ marginTop: 4 }}>
        Applies to this page only. Unsafe rules (imports, scripts, data URLs)
        are stripped on render.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector shell
// ---------------------------------------------------------------------------

export function Inspector() {
  const { state, pageCssEnabled } = useEditor();
  const [tab, setTab] = useState<Tab>("content");
  const [styleState, setStyleState] = useState<StyleState>("normal");
  const node = state.selectedId
    ? findNode(state.document.root, state.selectedId)
    : undefined;
  const def = node ? defaultBlockRegistry.get(node.type) : undefined;

  // On selection change, open a populated tab and reset Hover mode, so panel state from
  // the previously-selected block never leaks (spec §3.5). The Query Loop always has its
  // Content panel populated (the settings UI), so open there.
  useEffect(() => {
    const initial =
      node?.type === QUERY_LOOP_TYPE ? "content" : firstPopulatedTab(def);
    setTab(initial);
    setStyleState("normal");
  }, [state.selectedId]);

  if (!node) {
    return (
      <>
        <div className="nx-pb-pane-header">Settings</div>
        <div className="nx-pb-inspector-empty">
          Select a block on the canvas to edit its content and style.
        </div>
        {pageCssEnabled ? <PagePanel /> : null}
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
