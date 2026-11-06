"use client";

/**
 * The variant a selected placement uses, and the control that changes it.
 *
 * Draws what `component-variants` decides. A placement's own values are kept
 * whatever variant it picks: they are written over the variant's, so changing
 * the variant changes only the fields the placement has not set itself.
 *
 * A placement holding the key of a variant the component no longer has says
 * so, "Variant removed, showing defaults", with Clear, rather than showing an
 * empty choice: the key is kept so a restored version brings the variant back,
 * and the author decides whether to let it go.
 *
 * @module variant-picker
 */
import {
  findNode,
  readableDefinition,
  type ComponentDocument,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { CircleAlert } from "lucide-react";
import * as React from "react";

import {
  chooseVariantOp,
  variantChoiceOf,
  type VariantChoice,
} from "./component-variants";
import type { EditorState } from "./editor-state";

/**
 * What the picker's control spells "no variant". Every variant's own value is
 * prefixed, so no stored key can collide with it.
 */
const NONE = "none";

function encodeVariant(id: string): string {
  return `=${id}`;
}

/**
 * The picker for one placement, or nothing when its component offers no
 * variants and it holds none.
 *
 * @experimental Settles when the component editor ships.
 */
export function VariantPicker({
  editor,
  nodeId,
  definition,
  disabled,
}: {
  editor: EditorState;
  nodeId: string;
  definition: ComponentDocument | undefined;
  /** True while the placement is locked, so it cannot change. */
  disabled?: boolean;
}): React.JSX.Element | null {
  const node = findNode(editor.document.nodes, nodeId);
  const id = React.useId();
  // A definition that could not be loaded says so below; reading its
  // absence as "this variant was removed" would say something untrue.
  if (node === undefined || definition === undefined) return null;
  const choice = variantChoiceOf(definition, node);
  if (choice.options.length === 0 && choice.chosen === undefined) return null;

  // Read the node again at commit: a choice made after another edit replaced
  // the node must not write back the older props.
  const choose = (variantId: string | undefined) => {
    const now = findNode(editor.document.nodes, nodeId);
    if (now !== undefined) editor.apply(chooseVariantOp(now, variantId));
  };

  return (
    // A row like the fields below it, its label beside the menu, inside the
    // fields' container so it stacks with them when the rail is narrow.
    <section
      className="nx-inspector__fields nx-variant-picker"
      data-variant-picker=""
    >
      <div className="nx-inspector__field">
        <Label htmlFor={id}>Variant</Label>
        {choice.removed ? (
          <RemovedVariant
            onClear={() => choose(undefined)}
            disabled={disabled}
          />
        ) : (
          <Select
            value={
              choice.chosen === undefined ? NONE : encodeVariant(choice.chosen)
            }
            disabled={disabled}
            onValueChange={next =>
              choose(next === NONE ? undefined : next.slice(1))
            }
          >
            <SelectTrigger id={id} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Default</SelectItem>
              {choice.options.map(option => (
                <SelectItem key={option.id} value={encodeVariant(option.id)}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </section>
  );
}

/** What the picker calls a variant, marked when it presets nothing. */
function optionLabel(option: VariantChoice["options"][number]): string {
  return option.empty ? `${option.label} (no changes)` : option.label;
}

/** The notice for a placement whose variant was deleted, with Clear. */
function RemovedVariant({
  onClear,
  disabled,
}: {
  onClear: () => void;
  disabled: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className="nx-variant-picker__removed" role="status">
      <CircleAlert size={14} aria-hidden="true" />
      <span>Variant removed, showing defaults</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label="Clear the removed variant"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}

/**
 * The definition a placement resolves against, from the lookup the canvas
 * composes with.
 *
 * @experimental Settles when the component editor ships.
 */
export function placedDefinition(
  definitions: ComponentLookup,
  componentId: string | undefined
): ComponentDocument | undefined {
  // Under the resolver's own rule for a supplied definition, so the picker
  // offers the variants of exactly the definition the canvas draws.
  if (componentId === undefined) return undefined;
  return readableDefinition(definitions.get(componentId));
}
