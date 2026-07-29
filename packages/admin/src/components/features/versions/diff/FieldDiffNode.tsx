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

/** Before value, struck through to read as removed. */
function BeforeValue({ field, value }: { field: FieldConfig; value: unknown }) {
  return (
    <div className="line-through text-muted-foreground">
      <FieldValue field={field} value={value} />
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
      const field = renderField(node);
      let body: React.ReactNode;
      if (node.status === "added") {
        body = <FieldValue field={field} value={node.after} />;
      } else if (node.status === "removed") {
        body = <BeforeValue field={field} value={node.before} />;
      } else if (node.status === "unchanged") {
        // Reachable only with "Changed only" off: nothing changed, so show the
        // value once rather than striking a "before" that was never removed.
        body = <FieldValue field={field} value={node.after} />;
      } else {
        body = (
          <div className="flex flex-col gap-1">
            <BeforeValue field={field} value={node.before} />
            <FieldValue field={field} value={node.after} />
          </div>
        );
      }
      return (
        <FieldRow label={node.label} status={node.status}>
          {body}
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
          </div>
        </FieldRow>
      );
    }

    case "group": {
      return (
        <FieldRow label={node.label} status={node.status}>
          <div className="pl-3 border-l border-border">
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
      // stored values plainly rather than guessing a typed display. Show the
      // struck "before" only when it was actually removed or changed; an
      // unchanged value (reachable with "Changed only" off) reads once.
      return (
        <FieldRow label={node.name} status={node.status}>
          <p className="text-xs text-muted-foreground mb-1">
            This field is no longer in the schema.
          </p>
          {node.status === "removed" || node.status === "changed" ? (
            <code className="block text-sm break-words line-through text-muted-foreground">
              {formatUnknown(node.before)}
            </code>
          ) : null}
          {node.status !== "removed" ? (
            <code className="block text-sm break-words">
              {formatUnknown(node.after)}
            </code>
          ) : null}
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
