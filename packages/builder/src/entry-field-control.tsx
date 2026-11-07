"use client";

/**
 * The Entry content block's Content tab: which of the template's collection's
 * top-level blocks fields it draws, and the way to the entry those blocks are
 * edited on.
 *
 * - **Field** is a menu of the collection's top-level blocks fields. A choice
 *   the collection no longer has stays chosen, read "Body (removed)" and
 *   marked invalid, so the author sees what the block still names and picks
 *   another; nothing is changed for them.
 * - A line says the content is the entry's own, edited on the entry, in the
 *   collection's words ("This is the post’s own content, edited on the
 *   post.").
 * - **Open post** opens the previewed entry's edit screen in a new tab, so
 *   the template stays open with its history. Disabled while no entry is
 *   previewed.
 *
 * The fields and the entry come from the template's editor
 * (`usePreviewedCollection`, `usePreviewedEntry`); outside a template there
 * is no collection, and the menu offers the stored choice alone.
 *
 * @experimental Settles when collection templates ship.
 * @module entry-field-control
 */
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { ExternalLink } from "lucide-react";
import type * as React from "react";

import type { ContentControlProps } from "./content-controls";
import { propLabel } from "./inspector";
import {
  entryFieldRemoved,
  fieldName,
  usePreviewedCollection,
  usePreviewedEntry,
  type PreviewedBlocksField,
  type PreviewedCollection,
} from "./previewed-entry";

/** A stored field name, or `undefined` where the block names none as text. */
function storedField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Open an entry's edit screen in a new tab, holding no handle on this one. */
function openInNewTab(href: string): void {
  window.open(href, "_blank", "noopener");
}

/** The Field menu, the line about whose content it is, and Open entry. */
/**
 * The words a chosen field is read by: its label where the collection has
 * it, else its name as the canvas and Layers name it, marked "(removed)"
 * where the collection no longer has it. Nothing while none is chosen.
 */
function chosenWords(
  field: string | undefined,
  offered: readonly PreviewedBlocksField[],
  removed: boolean,
  collection: PreviewedCollection | undefined
): string | undefined {
  if (field === undefined) return undefined;
  const listed = offered.find(each => each.name === field);
  if (listed !== undefined) return listed.label;
  const words = fieldName(field, collection);
  return removed ? `${words} (removed)` : words;
}

export function EntryFieldControl({
  id,
  prop,
  disabled,
  onCommit,
  label,
}: ContentControlProps): React.JSX.Element {
  const collection = usePreviewedCollection();
  const previewed = usePreviewedEntry();
  const name = label ?? propLabel(prop.name, prop.schema);
  const field = storedField(prop.value);
  const removed = entryFieldRemoved(field, collection);
  const offered = collection?.blocksFields ?? [];
  // The stored choice is always listed, so the menu can say what it is even
  // where the collection no longer has it or its fields are not known.
  const listsStored =
    field !== undefined && !offered.some(each => each.name === field);
  const singular = collection?.singular ?? "entry";
  // What the trigger shows, in full: its title, where a long name ("Members
  // Only (removed)") is cut to one line with an ellipsis.
  const chosen = chosenWords(field, offered, removed, collection);
  const entryId = previewed?.kind === "entry" ? previewed.id : undefined;
  return (
    <div className="nx-inspector__field" data-content-control="entryField">
      <Label htmlFor={id}>{name}</Label>
      <Select
        disabled={disabled}
        value={field}
        onValueChange={next => onCommit(prop.name, next)}
      >
        <SelectTrigger
          id={id}
          aria-invalid={removed ? true : undefined}
          title={chosen}
        >
          <SelectValue placeholder="Choose a field" />
        </SelectTrigger>
        <SelectContent>
          {offered.map(each => (
            <SelectItem key={each.name} value={each.name}>
              {each.label}
            </SelectItem>
          ))}
          {field !== undefined && listsStored ? (
            <SelectItem value={field}>
              {/* Named as the canvas and Layers name it. */}
              {chosen}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <div className="nx-inspector__entry-content">
        <p className="nx-inspector__note">
          This is the {singular}’s own content, edited on the {singular}.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Said as well as shown: it leaves this tab for another.
          aria-label={`Open ${singular} in a new tab`}
          disabled={entryId === undefined || collection === undefined}
          onClick={() => {
            if (entryId !== undefined && collection !== undefined) {
              openInNewTab(collection.entryHref(entryId));
            }
          }}
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
          Open {singular}
        </Button>
      </div>
    </div>
  );
}
