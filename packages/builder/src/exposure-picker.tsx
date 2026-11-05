"use client";

/**
 * Which values of a selection each placement of a new component may change:
 * the picker a "Turn into component" form shows.
 *
 * It lists every block in the selection with the props a placement could set
 * (text, rich text, an image, a link, a choice) and a switch to let a
 * placement hide the block. Each pick is asked of the engine's
 * `planExposeProperty`, against the selection as the component it will
 * become, so a prop the engine would refuse is refused here first, in words:
 * a non-content prop inside an area locked to its content (`contentOnly`),
 * or a prop no placement could set. What it hands back are the nominations
 * the save and convert planners take, by node id in the page.
 *
 * Nothing is picked to start with: a component whose placements change
 * nothing is the ordinary case, and every pick is a decision the author
 * makes, as Figma and Webflow ask it.
 *
 * @module exposure-picker
 */
import {
  COMPONENT_INSTANCE_TYPE,
  exposureTypeForProp,
  findNode,
  planExposeProperty,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
  type ExposedPropertyType,
  type ExposureEditProblem,
  type RequestedProperty,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";
import { Checkbox, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import { propLabel } from "./inspector";
import { layerLabel } from "./layers";

/** Why a pick was refused, as an author reads it. */
const REFUSAL: Readonly<Record<ExposureEditProblem, string>> = {
  "not-a-component": "This selection can’t be read as a component.",
  "unknown-exposure": "That value is no longer in this selection.",
  "unknown-node": "That block is no longer in this selection.",
  "unknown-prop": "That block no longer has this value.",
  "not-exposable": "Pages have no control for this value.",
  "content-only":
    "This block is in an area locked to its content, and this isn’t content, so pages couldn’t change it.",
  "invalid-label": "Give the field a name.",
  "invalid-exposure": "This value can’t be changed per use.",
  "exceeds-limits": "This selection is too large to offer more values.",
};

/** One value a placement could be let change. */
interface Candidate {
  readonly key: string;
  readonly nodeId: string;
  /** The prop, or `undefined` for the block's visibility. */
  readonly prop: string | undefined;
  readonly name: string;
  readonly type: ExposedPropertyType;
}

/** One block of the selection, with its candidates, at its depth. */
interface BlockRow {
  readonly node: BlockNode;
  readonly depth: number;
  readonly candidates: readonly Candidate[];
}

export interface ExposurePickerProps {
  /** The page the selection is in. */
  readonly document: BlockDocument;
  /** The selected roots, in the page's order. */
  readonly selectedIds: readonly string[];
  /** The block definitions: each prop's type and role, each slot's lock. */
  readonly definitions: SlotDefaultSource;
  /** The values picked so far. */
  readonly value: readonly RequestedProperty[];
  readonly onChange: (next: readonly RequestedProperty[]) => void;
  /** Disables every control, while the form is being sent. */
  readonly disabled?: boolean;
}

/**
 * The picker. Controlled: the form holds what is picked, so a refused save
 * keeps the author's picks for the next try.
 *
 * @experimental Settles when the composition API ships.
 */
export function ExposurePicker({
  document,
  selectedIds,
  definitions,
  value,
  onChange,
  disabled = false,
}: ExposurePickerProps): React.JSX.Element {
  const preview = React.useMemo(
    () => selectionAsComponent(document, selectedIds),
    [document, selectedIds]
  );
  const rows = React.useMemo(
    () => blockRows(preview.nodes, definitions),
    [preview, definitions]
  );
  // What each candidate would be refused on its own, so it is dimmed with the
  // reason before it is pressed.
  const refused = React.useMemo(() => {
    const reasons = new Map<string, string>();
    for (const row of rows) {
      for (const candidate of row.candidates) {
        const tried = expose(preview, [], candidate, definitions);
        if ("reason" in tried) reasons.set(candidate.key, tried.reason);
      }
    }
    return reasons;
  }, [rows, preview, definitions]);
  const [problem, setProblem] = React.useState<{
    key: string;
    reason: string;
  } | null>(null);
  const hintId = React.useId();

  const picked = (candidate: Candidate) =>
    value.find(
      entry =>
        entry.nodeId === candidate.nodeId &&
        (candidate.prop === undefined
          ? entry.type === "visibility"
          : entry.type !== "visibility" && entry.propPath === candidate.prop)
    );

  const toggle = (candidate: Candidate, on: boolean) => {
    setProblem(null);
    const held = picked(candidate);
    if (!on) {
      onChange(value.filter(entry => entry !== held));
      return;
    }
    if (held !== undefined) return;
    const tried = expose(preview, value, candidate, definitions);
    if ("reason" in tried) {
      setProblem({ key: candidate.key, reason: tried.reason });
      return;
    }
    onChange([...value, tried.property]);
  };

  const rename = (entry: RequestedProperty, label: string) => {
    onChange(value.map(held => (held === entry ? { ...held, label } : held)));
  };

  const offered = rows.filter(row => row.candidates.length > 0);

  return (
    <fieldset
      className="nx-expose-picker"
      aria-describedby={hintId}
      disabled={disabled}
    >
      <legend className="nx-expose-picker__legend">
        What each use can change
      </legend>
      <p id={hintId} className="nx-expose-picker__hint">
        {offered.length === 0
          ? "Nothing in this selection can change from one use to another, so the component looks the same everywhere it is used."
          : "Anything left unticked looks the same everywhere it is used. You can change this later in the component’s own view."}
      </p>
      {offered.length === 0 ? null : (
        <ul className="nx-expose-picker__blocks">
          {offered.map(row => (
            <li
              key={row.node.id}
              className="nx-expose-picker__block"
              style={{ "--nx-expose-depth": row.depth } as React.CSSProperties}
            >
              <span className="nx-expose-picker__block-name">
                {layerLabel(row.node)}
              </span>
              <ul className="nx-expose-picker__values">
                {row.candidates.map(candidate => (
                  <CandidateRow
                    key={candidate.key}
                    candidate={candidate}
                    entry={picked(candidate)}
                    unavailable={refused.get(candidate.key)}
                    problem={
                      problem?.key === candidate.key
                        ? problem.reason
                        : undefined
                    }
                    blockName={layerLabel(row.node)}
                    onToggle={on => toggle(candidate, on)}
                    onRename={rename}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** One value: its switch, its type, and its name once picked. */
function CandidateRow({
  candidate,
  entry,
  unavailable,
  problem,
  blockName,
  onToggle,
  onRename,
}: {
  candidate: Candidate;
  entry: RequestedProperty | undefined;
  unavailable: string | undefined;
  problem: string | undefined;
  blockName: string;
  onToggle: (on: boolean) => void;
  onRename: (entry: RequestedProperty, label: string) => void;
}): React.JSX.Element {
  const boxId = React.useId();
  const reasonId = React.useId();
  const said = problem ?? (entry === undefined ? unavailable : undefined);
  return (
    <li
      className="nx-expose-picker__value"
      data-picked={entry === undefined ? undefined : ""}
    >
      <div className="nx-expose-picker__row">
        <Checkbox
          id={boxId}
          checked={entry !== undefined}
          disabled={entry === undefined && unavailable !== undefined}
          aria-describedby={said === undefined ? undefined : reasonId}
          onCheckedChange={checked => onToggle(checked === true)}
        />
        <Label htmlFor={boxId} className="nx-expose-picker__name">
          {candidate.name}
        </Label>
      </div>
      {entry === undefined ? null : (
        <Input
          className="nx-expose-picker__label"
          value={entry.label}
          aria-label={`Name pages see for ${candidate.name} of ${blockName}`}
          onChange={event => onRename(entry, event.target.value)}
        />
      )}
      {said === undefined ? null : (
        <p
          id={reasonId}
          className="nx-expose-picker__reason"
          role={problem === undefined ? undefined : "alert"}
        >
          {said}
        </p>
      )}
    </li>
  );
}

/**
 * The selection as the component it will become, under the page's own node
 * ids: the roots in the page's order, so the picks name nodes the planners
 * can find in the page.
 */
export function selectionAsComponent(
  document: BlockDocument,
  selectedIds: readonly string[]
): ComponentDocument {
  const nodes = selectedIds
    .map(id => findNode(document.nodes, id))
    .filter((node): node is BlockNode => node !== undefined);
  return {
    formatVersion: document.formatVersion,
    kind: "component",
    nodes,
  };
}

/** Every block of the forest, depth first, with what it offers. */
function blockRows(
  nodes: readonly BlockNode[],
  definitions: SlotDefaultSource
): BlockRow[] {
  const rows: BlockRow[] = [];
  const visit = (node: BlockNode, depth: number) => {
    rows.push({ node, depth, candidates: candidatesOf(node, definitions) });
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) visit(child, depth + 1);
    }
  };
  for (const node of nodes) visit(node, 0);
  return rows;
}

/**
 * A block's candidate values: each prop of a type a placement could set, in
 * the order the block declares them, then its visibility. A placement inside
 * the selection offers none of its own here: its component's fields are that
 * component's to expose.
 */
function candidatesOf(
  node: BlockNode,
  definitions: SlotDefaultSource
): Candidate[] {
  if (node.type === COMPONENT_INSTANCE_TYPE) return [];
  const props = definitions.get(node.type)?.props ?? {};
  const candidates: Candidate[] = [];
  for (const [name, schema] of Object.entries(props)) {
    const type = exposureTypeForProp(schema);
    if (type === undefined || schema === undefined) continue;
    candidates.push({
      key: `${node.id}\u0000${name}`,
      nodeId: node.id,
      prop: name,
      // The block's own word for the property ("HTML tag"), not its name.
      name: propLabel(name, schema),
      type,
    });
  }
  candidates.push({
    key: `${node.id}\u0000`,
    nodeId: node.id,
    prop: undefined,
    name: "Can be hidden",
    type: "visibility",
  });
  return candidates;
}

/**
 * One more pick, asked of the engine against the picks already made: the
 * nomination with the id it minted, or why it was refused.
 */
function expose(
  preview: ComponentDocument,
  picked: readonly RequestedProperty[],
  candidate: Candidate,
  definitions: SlotDefaultSource
): { property: RequestedProperty } | { reason: string } {
  const draft: ComponentDocument = {
    ...preview,
    exposed: picked.map(toExposed),
  };
  const label = candidate.prop === undefined ? "Hidden" : candidate.name;
  const result = planExposeProperty(
    draft,
    candidate.prop === undefined
      ? { nodeId: candidate.nodeId, visibility: true, label }
      : { nodeId: candidate.nodeId, propPath: candidate.prop, label },
    { definitions }
  );
  if ("problem" in result) return { reason: REFUSAL[result.problem] };
  const added = (result.document.exposed ?? []).find(
    entry => entry.id === result.id
  );
  if (added === undefined) return { reason: REFUSAL["invalid-exposure"] };
  return { property: toRequested(added) };
}

/** A nomination as the envelope stores it, for the next pick to be judged with. */
function toExposed(entry: RequestedProperty): ExposedProperty {
  return {
    id: entry.id,
    label: entry.label,
    nodeId: entry.nodeId,
    propPath: entry.propPath,
    type: entry.type,
    ...(entry.options === undefined ? {} : { options: entry.options }),
  };
}

/** An envelope entry as the planners take a nomination. */
function toRequested(entry: ExposedProperty): RequestedProperty {
  return {
    id: entry.id,
    label: entry.label,
    nodeId: entry.nodeId,
    propPath: entry.propPath,
    type: entry.type,
    ...(entry.options === undefined ? {} : { options: entry.options }),
  };
}
