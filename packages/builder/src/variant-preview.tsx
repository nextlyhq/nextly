"use client";

/**
 * The variant open in a component's own view, previewed on the canvas.
 *
 * Opening a variant's values in the inspector draws the component on the
 * canvas as that variant does, so a designer setting "Featured" sees Featured
 * rather than the defaults, and a tag over the canvas says so. Closing it, or
 * deleting the variant, draws the defaults again.
 *
 * The host holds the open variant (one hook, here), hands its binding to the
 * variants section, and draws the canvas from the document this answers. The
 * preview keeps every node's id (the engine's {@link variantPreview}), so the
 * canvas still selects and edits the component's own blocks under it.
 *
 * @module variant-preview
 */
import {
  isComponentDocument,
  variantOptions,
  variantPreview,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { Eye } from "lucide-react";
import * as React from "react";

import type { VariantPreviewBinding } from "./component-variants";

/** What the host draws the canvas from, and hands the variants section. */
export interface VariantPreviewState {
  /** For the variants section: which variant is open, and how to open one. */
  readonly binding: VariantPreviewBinding;
  /** What the canvas draws: the document, as the open variant draws it. */
  readonly document: BlockDocument;
  /** The name of the variant the canvas previews, or nothing. */
  readonly previewing: string | undefined;
}

/**
 * The open variant of the component `document` is, and the document the
 * canvas draws while it is open. A page, or a variant no longer on the
 * component, previews nothing.
 *
 * @experimental Settles when the component editor ships.
 */
export function useVariantPreview(
  document: BlockDocument
): VariantPreviewState {
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const component = isComponentDocument(document) ? document : undefined;
  // Asked of the document as it stands, so a deleted variant stops previewing
  // without anything having to close it.
  const option =
    component === undefined || chosen === undefined
      ? undefined
      : variantOptions(component).find(entry => entry.id === chosen);
  const open = option?.id;
  const drawn = React.useMemo(
    () =>
      component === undefined || open === undefined
        ? document
        : variantPreview(component, open),
    [component, document, open]
  );
  const binding = React.useMemo<VariantPreviewBinding>(
    () => ({ open, onOpen: setChosen }),
    [open]
  );
  return { binding, document: drawn, previewing: option?.label };
}

/**
 * The tag over the canvas naming the variant it previews; nothing while the
 * canvas draws the defaults. A status, so the change is announced.
 *
 * @experimental Settles when the component editor ships.
 */
export function VariantPreviewTag({
  name,
}: {
  name: string | undefined;
}): React.JSX.Element | null {
  if (name === undefined) return null;
  return (
    <p className="nx-variant-preview-tag" role="status">
      <Eye size={14} aria-hidden="true" />
      Previewing {name}
    </p>
  );
}
