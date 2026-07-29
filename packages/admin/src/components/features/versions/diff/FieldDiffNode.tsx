/**
 * Renders one node of a version diff.
 *
 * The engine produces a typed, UI-independent tree (`FieldDiff`); this walks it
 * and paints each kind: text as inline insert/delete runs, scalars as
 * before/after values (reusing the read-only value-display kit), groups and
 * components nested, lists item-by-item with add/remove/move/change badges, and
 * relationships as added/removed target chips. All colours are theme tokens, so
 * it reads in light and dark alike.
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
 * A screen-reader label ("Before" / "After") plus its value, struck through
 * when it reads as removed. The label keeps the two sides distinguishable for
 * assistive technology, which cannot perceive the strikethrough alone.
 */
function ValueSide({
  label,
  struck = false,
  children,
}: {
  label: string;
  struck?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={struck ? "line-through text-muted-foreground" : undefined}>
      <span className="sr-only">{label}: </span>
      {children}
    </div>
  );
}

/**
 * The before/after presentation shared by scalar and dropped-field values:
 * added shows one value, removed shows one struck value, changed shows both
 * labelled, and unchanged shows the value once. `renderValue` decides how a
 * single side is drawn (the typed kit for a live field, raw text for a dropped
 * one), so the labelling stays in one place.
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
  if (status === "added") {
    return <ValueSide label="New value">{renderValue(after)}</ValueSide>;
  }
  if (status === "removed") {
    return (
      <ValueSide label="Removed value" struck>
        {renderValue(before)}
      </ValueSide>
    );
  }
  if (status === "unchanged") {
    // Nothing changed: show the value once, unlabelled and not struck.
    return <>{renderValue(after)}</>;
  }
  return (
    <div className="flex flex-col gap-1">
      <ValueSide label="Before" struck>
        {renderValue(before)}
      </ValueSide>
      <ValueSide label="After">{renderValue(after)}</ValueSide>
    </div>
  );
}

function targetLabel(target: RelationTarget): string {
  return target.relationTo ? `${target.relationTo}: ${target.id}` : target.id;
}

/** A raw value from a dropped field, whose type is unknown. */
function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}

export function FieldDiffNode({ node }: { node: FieldDiff }) {
  switch (node.kind) {
    case "text": {
      return (
        <FieldRow label={node.label} status={node.status}>
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {node.segments.map((segment, index) => (
              <TextSegmentSpan key={index} segment={segment} />
            ))}
          </p>
        </FieldRow>
      );
    }

    case "value": {
      // A value node typed as a container is the engine's opaque fallback for a
      // component or group whose schema no longer resolves; its value is the raw
      // stored object. Render that plainly rather than through the typed kit,
      // which would show an empty shell. Every other value is already normalized
      // by the engine, so the kit renders it without normalizing a second time.
      const isOpaqueContainer =
        node.type === "group" || node.type === "component";
      const field = renderField(node);
      const renderValue = (value: unknown) =>
        isOpaqueContainer ? (
          <code className="block text-sm break-words">
            {formatUnknown(value)}
          </code>
        ) : (
          <FieldValue field={field} value={value} preNormalized />
        );
      return (
        <FieldRow label={node.label} status={node.status}>
          <BeforeAfter
            status={node.status}
            before={node.before}
            after={node.after}
            renderValue={renderValue}
          />
        </FieldRow>
      );
    }

    case "set": {
      return (
        <FieldRow label={node.label} status={node.status}>
          <div className="flex flex-col gap-1.5">
            {node.removed.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Removed</span>
                {node.removed.map(target => (
                  <Badge key={targetLabel(target)} variant="destructive">
                    {targetLabel(target)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {node.added.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Added</span>
                {node.added.map(target => (
                  <Badge key={targetLabel(target)} variant="success">
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
      // A field no longer in the schema: its type is unknown, so render the raw
      // stored values plainly rather than guessing a typed display. The
      // before/after labelling is shared with live values so a screen reader can
      // tell the two sides apart.
      return (
        <FieldRow label={node.name} status={node.status}>
          <p className="text-xs text-muted-foreground mb-1">
            This field is no longer in the schema.
          </p>
          <BeforeAfter
            status={node.status}
            before={node.before}
            after={node.after}
            renderValue={value => (
              <code className="block text-sm break-words">
                {formatUnknown(value)}
              </code>
            )}
          />
        </FieldRow>
      );
    }
  }
}

function ListItemRow({ item }: { item: ListItemDiff }) {
  const heading = item.componentType ?? "Item";
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{heading}</span>
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
