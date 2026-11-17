"use client";

/**
 * Where a Form block's form comes from: its first setting.
 *
 * - **With a form source installed** (the forms plugin), "Form: <pick a
 *   form>" lists the forms the author may pick, a draft or closed one
 *   marked. Once one is picked, the panel says that its fields, emails, spam
 *   protection and saved responses come from that source, links to the form
 *   in the admin ("Edit this form ↗"), and offers "or use a simple form",
 *   which clears the pick and keeps the block's own fields.
 * - **With none**, the block edits its own fields, and this says what
 *   installing the Forms plugin adds.
 *
 * Everything shown is what the host's `listForms` answers: the panel names
 * no plugin, collection or address of its own.
 *
 * @module form-source-control
 */
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import type { ContentServices, FormSource } from "./content-services";
import { FORM_WORDS, pickedFormOf, type PickedForm } from "./form-picked";

/** What reading the site's form sources has come to. */
export type FormSources =
  | { readonly status: "absent" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly sources: readonly FormSource[] };

/** The site's form sources, read once per `listForms`. */
export function useFormSources(
  listForms: ContentServices["listForms"]
): FormSources {
  const [sources, setSources] = React.useState<FormSources>(
    listForms === undefined ? { status: "absent" } : { status: "loading" }
  );
  React.useEffect(() => {
    if (listForms === undefined) {
      setSources({ status: "absent" });
      return;
    }
    let current = true;
    setSources({ status: "loading" });
    listForms().then(
      read => {
        if (current) setSources({ status: "ready", sources: read });
      },
      () => {
        if (current) setSources({ status: "failed" });
      }
    );
    return () => {
      current = false;
    };
  }, [listForms]);
  return sources;
}

/** A picked form as a choice's value: both halves, never confused. */
export function formChoiceValue(form: PickedForm): string {
  return JSON.stringify([form.provider, form.ref]);
}

/** The picked form a choice's value names. */
export function formOfChoice(value: string): PickedForm | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { provider: parsed[0], ref: parsed[1] };
    }
  } catch {
    // Not a choice this control made.
  }
  return undefined;
}

/** A listed form's words: its title, and its state where it is not open. */
function choiceWords(title: string, state: string): string {
  const mark = FORM_WORDS.stateMark[state];
  return mark === undefined ? title : `${title} (${mark})`;
}

/** The forms each source lists, as menu items, grouped where there are several. */
export function FormChoiceItems({
  sources,
}: {
  readonly sources: readonly FormSource[];
}): React.JSX.Element {
  const items = (source: FormSource) =>
    source.forms.map(form => (
      <SelectItem
        key={form.ref}
        value={formChoiceValue({ provider: source.id, ref: form.ref })}
      >
        {choiceWords(form.title, form.state)}
      </SelectItem>
    ));
  if (sources.length === 1 && sources[0] !== undefined) {
    return <>{items(sources[0])}</>;
  }
  return (
    <>
      {sources.map(source => (
        <SelectGroup key={source.id}>
          <SelectLabel>{source.label}</SelectLabel>
          {items(source)}
        </SelectGroup>
      ))}
    </>
  );
}

/** The listed form `picked` is, and its source. */
function listedOf(
  sources: readonly FormSource[],
  picked: PickedForm | undefined
):
  | {
      readonly source: FormSource;
      readonly form: FormSource["forms"][number] | undefined;
    }
  | undefined {
  if (picked === undefined) return undefined;
  const source = sources.find(each => each.id === picked.provider);
  if (source === undefined) return undefined;
  return { source, form: source.forms.find(form => form.ref === picked.ref) };
}

/** The id of the picker's trigger for a block, so another part can focus it. */
export function formPickerId(nodeId: string): string {
  return `${nodeId}-form-pick`;
}

export function FormSourceControl({
  nodeId,
  stored,
  sources,
  disabled,
  onCommit,
}: {
  readonly nodeId: string;
  /** The block's stored `form`. */
  readonly stored: unknown;
  readonly sources: FormSources;
  /** Whether the pick may be changed here: a lock or a content-only area say. */
  readonly disabled: boolean;
  /** Write the block's `form`; `undefined` clears it. */
  readonly onCommit: (form: PickedForm | undefined) => void;
}): React.JSX.Element | null {
  const picked = pickedFormOf(stored);
  // A host that lists no sources says nothing either way.
  if (sources.status === "absent" || sources.status === "loading") {
    return null;
  }
  const useSimple =
    picked === undefined ? null : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nx-form-source__simple"
        disabled={disabled}
        onClick={() => onCommit(undefined)}
      >
        {FORM_WORDS.useSimple}
      </Button>
    );
  if (sources.status === "failed") {
    return (
      <div className="nx-form-source" data-content-control="form-source">
        <p className="nx-inspector__hint" role="status">
          {FORM_WORDS.listFailed}
        </p>
        {useSimple}
      </div>
    );
  }
  if (sources.sources.length === 0) {
    return (
      <div className="nx-form-source" data-content-control="form-source">
        <p className="nx-form-source__hint">{FORM_WORDS.installHint}</p>
        {useSimple}
      </div>
    );
  }
  const listed = listedOf(sources.sources, picked);
  const id = formPickerId(nodeId);
  const value =
    picked !== undefined && listed?.form !== undefined
      ? formChoiceValue(picked)
      : "";
  return (
    <div className="nx-form-source" data-content-control="form-source">
      <div className="nx-inspector__field nx-inspector__field--stacked">
        <label className="nx-inspector__field-name" htmlFor={id}>
          {FORM_WORDS.pickLabel}
        </label>
        <Select
          value={value}
          disabled={disabled}
          onValueChange={next => {
            const form = formOfChoice(next);
            if (form !== undefined) onCommit(form);
          }}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={FORM_WORDS.pickPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <FormChoiceItems sources={sources.sources} />
          </SelectContent>
        </Select>
      </div>
      {listed === undefined ? null : (
        <p className="nx-form-source__from">
          {FORM_WORDS.comesFrom(listed.source.label)}
        </p>
      )}
      {listed?.form?.editHref === undefined ? null : (
        <a
          className="nx-form-source__edit"
          href={listed.form.editHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {FORM_WORDS.edit}
        </a>
      )}
      {useSimple}
    </div>
  );
}
