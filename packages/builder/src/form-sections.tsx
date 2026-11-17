"use client";

/**
 * The Form block's two Content sections the builder draws itself: Fields
 * (`form-fields-control`) and After sending (`form-after-sending`). Each
 * replaces the generated rows of the section the block places those props
 * in, so the block's declaration still says where they are edited, and an
 * editor without these draws the generated rows instead.
 *
 * @module form-sections
 */
import * as React from "react";

import type { ContentServices } from "./content-services";
import { AfterSendingControl } from "./form-after-sending";
import { FormFieldsControl } from "./form-fields-control";
import type { BlockInspection, EditableProp } from "./inspector";

/** The block these sections are drawn for. */
const FORM_BLOCK = "core/form";

/** The sections the block places these props in, by their names. */
const FIELDS_SECTION = "Fields";
const AFTER_SENDING_SECTION = "After sending";

/** The props "Go to a page" is: the block's shared link setting. */
const PAGE_PROPS: ReadonlySet<string> = new Set([
  "href",
  "entryCollection",
  "entryId",
]);

/**
 * The field types the block's declaration offers, with their words: the
 * `type` of each item of its `fields`, so the panel offers exactly what the
 * block draws.
 */
function fieldTypesOf(
  prop: EditableProp | undefined
): { readonly value: string; readonly words: string }[] {
  const item = prop?.schema.item as
    | { type?: { options?: unknown; optionLabels?: unknown } }
    | undefined;
  const options = Array.isArray(item?.type?.options) ? item.type.options : [];
  const words = (item?.type?.optionLabels ?? {}) as Record<string, unknown>;
  return options
    .filter((option): option is string => typeof option === "string")
    .map(option => ({
      value: option,
      words: wordsOf(words[option], option),
    }));
}

/** A choice's declared words, or the choice itself. */
function wordsOf(declared: unknown, option: string): string {
  return typeof declared === "string" ? declared : option;
}

/** What drawing the sections needs from the Content tab. */
export interface FormSectionsContext {
  readonly inspection: BlockInspection;
  /**
   * The block's props as stored, its picked form among them: a prop the
   * block draws no row for is not in the inspection.
   */
  readonly stored: Readonly<Record<string, unknown>>;
  readonly services: ContentServices | undefined;
  /** Whether a prop may be written here: a lock or a content-only area say. */
  readonly writable: (name: string) => boolean;
  readonly onCommit: (name: string, value: unknown) => void;
  /** The generated rows for `rows`, as the tab draws any section's. */
  readonly rowsOf: (rows: readonly EditableProp[]) => React.JSX.Element;
}

/**
 * The bodies of the Form's sections the builder draws, by section name, or
 * none for any other block.
 */
export function formSectionBodies(
  context: FormSectionsContext
): ReadonlyMap<string, React.JSX.Element> | undefined {
  const { inspection, writable, onCommit } = context;
  if (inspection.blockName !== FORM_BLOCK) return undefined;
  const values = context.stored;
  const pageRows = inspection.props.filter(prop => PAGE_PROPS.has(prop.name));
  const messageRows = inspection.props.filter(prop => prop.name === "message");
  const fieldsProp = inspection.props.find(prop => prop.name === "fields");
  return new Map([
    [
      FIELDS_SECTION,
      <FormFieldsControl
        key="fields"
        id={`${inspection.nodeId}-form-fields`}
        value={values.fields}
        types={fieldTypesOf(fieldsProp)}
        disabled={!writable("fields")}
        onCommit={next => onCommit("fields", next)}
      />,
    ],
    [
      AFTER_SENDING_SECTION,
      <AfterSendingControl
        key="after-sending"
        id={`${inspection.nodeId}-after-sending`}
        props={values}
        disabled={name => !writable(name)}
        services={context.services}
        onCommit={onCommit}
        message={context.rowsOf(messageRows)}
        page={context.rowsOf(pageRows)}
      />,
    ],
  ]);
}
