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
  RelationTarget,
  TextSegment,
  ValueFieldDiff,
} from "@admin/services/versionApi";

import { FieldValue } from "../value-display/FieldValueDisplay";

import { splitTextSegments } from "./text-segment-sides";

type DiffStatus = FieldDiff["status"];

const STATUS_BADGE: Record<
  DiffStatus,
  { variant: "success" | "destructive" | "warning" | "outline"; label: string }
> = {
  added: { variant: "success", label: "Added" },
  removed: { variant: "destructive", label: "Removed" },
  changed: { variant: "warning", label: "Changed" },
  unchanged: { variant: "outline", label: "Unchanged" },
};

function StatusBadge({ status }: { status: DiffStatus }) {
  const badge = STATUS_BADGE[status];
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

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

/** A labelled block wrapping one field's diff. */
function FieldRow({
  label,
  status,
  children,
}: {
  label: string;
  status: DiffStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function TextSegmentSpan({ segment }: { segment: TextSegment }) {
  if (segment.op === 0) return <span>{segment.text}</span>;
  if (segment.op === 1) {
    return (
      <ins className="rounded-sm px-0.5 no-underline bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-100">
        {segment.text}
      </ins>
    );
  }
  return (
    <del className="rounded-sm px-0.5 bg-destructive-100 text-destructive-700 dark:bg-destructive-900 dark:text-destructive-100">
      {segment.text}
    </del>
  );
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

/** One sequence of text-diff runs as a paragraph of marked spans. */
function TextRuns({ segments }: { segments: readonly TextSegment[] }) {
  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed">
      {segments.map((segment, index) => (
        <TextSegmentSpan key={index} segment={segment} />
      ))}
    </p>
  );
}

export function FieldDiffNode({ node }: { node: FieldDiff }) {
  switch (node.kind) {
    case "text": {
      // An unchanged text node has only common runs, so both sides would be
      // identical; it spans instead, matching how a value node handles the same
      // case. A changed one distributes its runs, keeping each run's `op` so a
      // deletion still reads as struck on the left and an insertion as inserted
      // on the right.
      if (node.status === "unchanged") {
        return (
          <FieldRow label={node.label} status={node.status}>
            <TextRuns segments={node.segments} />
          </FieldRow>
        );
      }
      // An added or removed text field has no runs at all on the side it never
      // reached, so its sides are handed over unconditionally and `SplitPair`
      // substitutes the absence marker. Rendering the empty list here would
      // paint a blank paragraph, which reads as a field that existed and held
      // nothing.
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

    case "value": {
      // The value is already normalized by the engine, so the kit renders it
      // without normalizing a second time. A schema-less container never reaches
      // here: the engine emits it as an unknown node so its value stays hidden.
      // A relationship or upload value arrives resolved to the kit's display
      // shape, so the same kit renders its label with no special-casing here.
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

    case "set": {
      // A set difference spans both columns rather than splitting into them. It
      // is not a before/after pair: it names only the targets that entered or
      // left, so putting "removed" under a heading naming the older version
      // would imply that version held nothing else, when the targets present in
      // both appear on neither side.
      return (
        <FieldRow label={node.label} status={node.status}>
          <div className="flex flex-col gap-1.5">
            {node.removed.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Removed</span>
                {node.removed.map(target => (
                  <Badge key={targetKey(target)} variant="destructive">
                    {targetLabel(target)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {node.added.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Added</span>
                {node.added.map(target => (
                  <Badge key={targetKey(target)} variant="success">
                    {targetLabel(target)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {node.added.length === 0 && node.removed.length === 0 ? (
              // An unchanged relationship (reachable with "Changed only" off)
              // carries no targets, so say so rather than leaving a blank body
              // under the "Unchanged" badge.
              <span className="text-xs text-muted-foreground">No change</span>
            ) : null}
          </div>
        </FieldRow>
      );
    }

    case "group": {
      // A dynamic-zone component whose type changed carries the slug transition,
      // so the swap is legible even when neither side has field values to show.
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
  }
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
