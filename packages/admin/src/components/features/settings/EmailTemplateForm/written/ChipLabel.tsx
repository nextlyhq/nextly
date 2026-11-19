/**
 * What a chip shows inside a field: its variable's friendly name, a mark when
 * it would show nothing with the test data, and its fallback dialog on click.
 * The surrounding block says how chips read there: a list's blocks know what
 * `item` is, so the same chip reads the same way wherever it sits.
 *
 * @module components/features/settings/EmailTemplateForm/written/ChipLabel
 */
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { createContext, useContext, useState, type JSX } from "react";

import { AlertTriangle } from "@admin/components/icons";

import type { ChipNamer } from "./chip-names";
import { ChipFallbackDialog } from "./ChipFallbackDialog";

/** How chips read where they sit. */
export interface ChipView {
  /** A variable path's friendly name. */
  name: ChipNamer;
  /** Whether a chip shows nothing with the test data. */
  blank: (chip: { variable: string; fallback?: string }) => boolean;
  /** The variable paths offered here, such as for a link's address. */
  paths: readonly string[];
}

/** Without a provider, a chip shows its variable's path and is never marked. */
export const ChipViewContext = createContext<ChipView>({
  name: variable => variable,
  blank: () => false,
  paths: [],
});

interface ChipProps {
  variable: string;
  fallback: string | undefined;
  /** Sets the chip's fallback, or removes it with undefined. */
  onFallback: (fallback: string | undefined) => void;
}

/** A chip inside a text field, editable while its field is. */
export function ChipLabel(props: ChipProps): JSX.Element {
  const editable = useLexicalEditable();
  return <ChipButton {...props} editable={editable} />;
}

/**
 * A chip anywhere: inside a text field, or standing for a whole value such
 * as an image's address. It opens its fallback dialog while `editable`.
 */
export function ChipButton({
  variable,
  fallback,
  onFallback,
  editable,
}: ChipProps & { editable: boolean }): JSX.Element {
  const view = useContext(ChipViewContext);
  const [open, setOpen] = useState(false);
  const name = view.name(variable);
  const blank = view.blank({ variable, fallback });
  return (
    <>
      <button
        type="button"
        className={
          blank ? "inline-flex items-center gap-1 text-warning-text" : undefined
        }
        disabled={!editable}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {blank ? <AlertTriangle aria-hidden className="size-3" /> : null}
        <span title={variable}>{name}</span>
        {blank ? <span className="sr-only">, shows nothing</span> : null}
      </button>
      <ChipFallbackDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        fallback={fallback}
        hasTestValue={!view.blank({ variable })}
        onSave={onFallback}
      />
    </>
  );
}
