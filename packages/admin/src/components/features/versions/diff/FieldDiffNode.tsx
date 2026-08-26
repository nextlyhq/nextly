/**
 * Renders one node of a version diff.
 *
 * The engine produces a typed, UI-independent tree (`FieldDiff`); this walks it
 * and paints each kind: text as insert/delete runs, scalars as before/after
 * values (reusing the read-only value-display kit), groups and components
 * nested, lists item-by-item with add/remove/move/change badges, and
 * relationships as added/removed target chips. All colours are theme tokens, so
 * it reads in light and dark alike.
 *
 * A changed field states its two sides in COLUMNS, which is the shape a
 * comparison has. There is one such layout rather than a narrow variant beside
 * it: a container query folds the columns into a stack where the surface cannot
 * hold two, so the available width decides the arrangement and no caller has to.
 *
 * Each value node carries its own display config (`display`), which the engine
 * copied from the real field while it walked, so a `hasMany` array, a `select`
 * label, or a date renders faithfully without the client re-deriving the schema.
 *
 * @module components/features/versions/diff/FieldDiffNode
 */

import type { FieldConfig } from "nextly/config";

import { Badge } from "@admin/components/ui";
import type {
  FieldDiff,
  ListItemDiff,
  GroupFieldDiff,
  RelationTarget,
  SetFieldDiff,
  TextFieldDiff,
  ValueFieldDiff,
} from "@admin/services/versionApi";

import { FieldValue } from "../value-display/FieldValueDisplay";

import {
  FieldRow,
  StatusBadge,
  TextRuns,
  type DiffStatus,
} from "./diff-primitives";
import { resolveFieldDiff } from "./field-diff-registry";
// Imported for their registration side effect, exactly as the value-display kit
// is. They live here rather than at a view, because a renderer that is never
// imported is never registered and its field would silently fall back to the
// unrecognised-kind row — so the dispatcher owns making sure its own renderers
// exist. Neither imports this module, so there is no cycle.
import "./RichTextDiff";
import "./SourceDiff";
import { splitTextSegments } from "./text-segment-sides";

/**
 * A React key that stays unique across a component-type swap. When a dynamic
 * zone item changes type and old and new schemas reuse a field name, the engine
 * emits both a removed and an added sibling with that same `name`; keying by
 * name alone collides, so the kind and status disambiguate the two sides.
 */
export function childKey(node: FieldDiff): string {
  return `${node.kind}:${node.name}:${node.status}`;
}

/**
 * A field for the value-display kit, rebuilt from the node's own metadata and
 * the display config the engine attached. Carrying that config on the node
 * (rather than looking the field up in the live schema) is what lets a value
 * inside a swapped component or a flattened group still render by its real type.
 */
function renderField(node: ValueFieldDiff): FieldConfig {
  return {
    name: node.name,
    type: node.type,
    label: node.label,
    ...node.display,
  } as FieldConfig;
}

/**
 * A side of a comparison the field did not reach: it was introduced after this
 * version, or dropped before the other one. Stated rather than left blank, so
 * an absent field is distinguishable from one holding an empty value.
 */
function AbsentSide() {
  return <p className="text-sm italic text-muted-foreground">Not present</p>;
}

/**
 * The two sides of a comparison, in columns.
 *
 * Columns are the shape a comparison has, so the markup states them once and a
 * container query folds them into a stack only where the surface is genuinely
 * too narrow to hold two. The per-side caption carries the labelling in that
 * folded state and goes screen-reader-only once the column headings above sit
 * over the columns instead — assistive technology needs the label either way,
 * since neither position nor a rule is perceivable to it.
 *
 * `status` is taken rather than a pre-decided pair of sides, so which side the
 * field never reached is answered HERE and only here. A caller that renders its
 * own sides cannot then forget the rule: an added field's rendering of its
 * before side is not consulted at all.
 */
function SplitPair({
  status,
  before,
  after,
}: {
  status: DiffStatus;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 @2xl/diff:grid-cols-2 @2xl/diff:gap-4">
      <div className="min-w-0 @2xl/diff:border-r @2xl/diff:border-border @2xl/diff:pr-4">
        <p className="mb-1 text-xs font-medium text-muted-foreground @2xl/diff:sr-only">
          Before
        </p>
        {status === "added" ? <AbsentSide /> : before}
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-muted-foreground @2xl/diff:sr-only">
          After
        </p>
        {status === "removed" ? <AbsentSide /> : after}
      </div>
    </div>
  );
}

/**
 * The before/after presentation shared by every value node. `renderValue` draws
 * a single side through the typed value kit, so the kit is consulted once per
 * side and the arrangement lives here. A relationship or upload value is
 * resolved into the kit's display shape upstream, so the kit renders its label
 * with no reference-specific handling here.
 *
 * An unchanged node spans both columns rather than printing the same value
 * twice: repeating it costs a row of height and says nothing the badge has not.
 */
function BeforeAfter({
  status,
  before,
  after,
  renderValue,
}: {
  status: DiffStatus;
  before: unknown;
  after: unknown;
  renderValue: (value: unknown) => React.ReactNode;
}) {
  if (status === "unchanged") {
    return <>{renderValue(after)}</>;
  }
  return (
    <SplitPair
      status={status}
      before={renderValue(before)}
      after={renderValue(after)}
    />
  );
}

/** Stable React key for a target: its identity, not its (possibly shared) label. */
function targetKey(target: RelationTarget): string {
  return target.relationTo ? `${target.relationTo}:${target.id}` : target.id;
}

/**
 * A target's display text: its resolved label when readable, otherwise its id.
 * A polymorphic target keeps its collection prefix so the same id in different
 * collections stays distinguishable.
 */
function targetLabel(target: RelationTarget): string {
  const display = target.label ?? target.id;
  return target.relationTo ? `${target.relationTo}: ${display}` : display;
}

/**
 * A node kind this build does not draw.
 *
 * Reached when a server sends a kind the client predates. Rendering nothing
 * would make the field VANISH from the comparison, which reads exactly like a
 * field that did not change — the one conclusion that must never be reached by
 * accident. Degrading to the name and status loses the detail and keeps the
 * fact, so the reader knows to open the version itself.
 */
function UnrecognisedField({ node }: { node: FieldDiff }) {
  const unrecognised = node as {
    name?: string;
    label?: string;
    status?: DiffStatus;
  };
  return (
    <FieldRow
      label={unrecognised.label ?? unrecognised.name ?? "Field"}
      status={unrecognised.status ?? "changed"}
    >
      <p className="text-xs text-muted-foreground">
        This field changed, but this version of the admin cannot display the
        comparison. Open the version to read it.
      </p>
    </FieldRow>
  );
}

/**
 * A text field's runs.
 *
 * An unchanged node has only common runs, so both sides would be identical; it
 * spans instead, matching how a value node handles the same case. An added or
 * removed one has no runs at all on the side it never reached, so its sides are
 * handed over unconditionally and `SplitPair` substitutes the absence marker —
 * rendering the empty list would paint a blank paragraph, which reads as a
 * field that existed and held nothing.
 */
function TextDiff({ node }: { node: TextFieldDiff }) {
  if (node.status === "unchanged") {
    return (
      <FieldRow label={node.label} status={node.status}>
        <TextRuns segments={node.segments} />
      </FieldRow>
    );
  }
  const sides = splitTextSegments(node.segments);
  return (
    <FieldRow label={node.label} status={node.status}>
      <SplitPair
        status={node.status}
        before={<TextRuns segments={sides.before} />}
        after={<TextRuns segments={sides.after} />}
      />
    </FieldRow>
  );
}

/**
 * A scalar, media or single-relationship value.
 *
 * Already normalized by the engine, so the kit renders it without normalizing a
 * second time. A schema-less container never reaches here: the engine emits it
 * as an unknown node so its value stays hidden. A relationship or upload value
 * arrives resolved to the kit's display shape, so the same kit renders its
 * label with no special-casing.
 */
function ValueDiff({ node }: { node: ValueFieldDiff }) {
  const field = renderField(node);
  return (
    <FieldRow label={node.label} status={node.status}>
      <BeforeAfter
        status={node.status}
        before={node.before}
        after={node.after}
        renderValue={value => (
          <FieldValue field={field} value={value} preNormalized />
        )}
      />
    </FieldRow>
  );
}

/**
 * A group or single component, nested. A dynamic-zone component whose type
 * changed carries the slug transition, so the swap is legible even when neither
 * side has field values to show.
 */
function GroupDiff({ node }: { node: GroupFieldDiff }) {
  const swapped =
    node.componentTypeBefore !== undefined ||
    node.componentTypeAfter !== undefined;
  return (
    <FieldRow label={node.label} status={node.status}>
      <div className="pl-3 border-l border-border">
        {swapped ? (
          <p className="text-xs text-muted-foreground mb-1">
            Type: {node.componentTypeBefore ?? "none"} &rarr;{" "}
            {node.componentTypeAfter ?? "none"}
          </p>
        ) : null}
        {node.fields.map(child => (
          <FieldDiffNode key={childKey(child)} node={child} />
        ))}
      </div>
    </FieldRow>
  );
}

/** The targets that entered or left a many-relationship. */
function TargetGroup({
  label,
  targets,
  variant,
}: {
  label: string;
  targets: readonly RelationTarget[];
  variant: "success" | "destructive";
}) {
  if (targets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {targets.map(target => (
        <Badge key={targetKey(target)} variant={variant}>
          {targetLabel(target)}
        </Badge>
      ))}
    </div>
  );
}

/**
 * A many-relationship, as a set difference.
 *
 * It spans both columns rather than splitting into them. It is not a
 * before/after pair: it names only the targets that entered or left, so putting
 * "removed" under a heading naming the older version would imply that version
 * held nothing else, when the targets present in both appear on neither side.
 */
function SetDiff({ node }: { node: SetFieldDiff }) {
  const empty = node.added.length === 0 && node.removed.length === 0;
  return (
    <FieldRow label={node.label} status={node.status}>
      <div className="flex flex-col gap-1.5">
        <TargetGroup
          label="Removed"
          targets={node.removed}
          variant="destructive"
        />
        <TargetGroup label="Added" targets={node.added} variant="success" />
        {empty ? (
          // An unchanged relationship (reachable with "Changed only" off)
          // carries no targets, so say so rather than leaving a blank body
          // under the "Unchanged" badge.
          <span className="text-xs text-muted-foreground">No change</span>
        ) : null}
      </div>
    </FieldRow>
  );
}

/**
 * Draws a node whose kind this module handles itself.
 *
 * Kept apart from the registry lookup so the two jobs stay separable: this
 * switch is the built-in set, and nothing about it has to change when a
 * renderer is registered for a new kind.
 */
function BuiltInFieldDiff({ node }: { node: FieldDiff }) {
  switch (node.kind) {
    case "text":
      return <TextDiff node={node} />;

    case "value":
      return <ValueDiff node={node} />;

    case "set":
      return <SetDiff node={node} />;

    case "group":
      return <GroupDiff node={node} />;

    case "list": {
      return (
        <FieldRow label={node.label} status={node.status}>
          <div className="flex flex-col gap-2">
            {node.items.map(item => (
              <ListItemRow key={item.id} item={item} />
            ))}
          </div>
        </FieldRow>
      );
    }

    case "unknown": {
      // A field (or a container's children) gone from the current schema has no
      // findable access rule, so its historical value cannot be proven readable
      // and the engine withholds it. Only the field name and that it changed are
      // shown.
      return (
        <FieldRow label={node.name} status={node.status}>
          <p className="text-xs text-muted-foreground">
            Value hidden: the schema needed to verify who may read this field is
            no longer available.
          </p>
        </FieldRow>
      );
    }

    default:
      return <UnrecognisedField node={node} />;
  }
}

/**
 * Draws one node of a comparison.
 *
 * A registered renderer wins, so the structural kinds — and any a plugin
 * contributes — are drawn without the built-in switch growing an arm for each.
 */
export function FieldDiffNode({ node }: { node: FieldDiff }) {
  const registered = resolveFieldDiff(node.kind);
  if (registered) return <>{registered(node)}</>;
  return <BuiltInFieldDiff node={node} />;
}

function ListItemRow({ item }: { item: ListItemDiff }) {
  // A row that kept its id but swapped component type shows the transition;
  // otherwise its single component slug, or a neutral label when untagged.
  const swapped =
    item.componentTypeBefore !== undefined ||
    item.componentTypeAfter !== undefined;
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">
          {swapped ? (
            <>
              {item.componentTypeBefore ?? "none"} &rarr;{" "}
              {item.componentTypeAfter ?? "none"}
            </>
          ) : (
            (item.componentType ?? "Item")
          )}
        </span>
        <StatusBadge status={item.status} />
        {item.hasMoved && item.fromIndex != null && item.toIndex != null ? (
          <Badge variant="outline">
            Moved {item.fromIndex + 1} &rarr; {item.toIndex + 1}
          </Badge>
        ) : null}
      </div>
      {item.fields.length > 0 ? (
        <div className="pl-1">
          {item.fields.map(child => (
            <FieldDiffNode key={childKey(child)} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
