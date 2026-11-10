/**
 * A blocks field's own settings: which blocks it accepts and which kinds of
 * document it holds, the two lists its stored policy keeps (`blocks.allow` and
 * `blocks.kinds`).
 *
 * Each list is edited as names typed in, because the admin has no list of the
 * registered blocks to choose from; the save checks each name the way it
 * checks one written in code. An empty list is stored as no list, which is
 * what the policy reads as "any".
 */
import { Button, Input, Label } from "@nextlyhq/ui";
import type { JSX, KeyboardEvent } from "react";
import { useId, useState } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import type { FieldSettingsControlProps } from "./types";

type Policy = NonNullable<BuilderField["blocks"]>;

export function BlocksSettings({
  field,
  readOnly,
  onChange,
}: FieldSettingsControlProps): JSX.Element {
  const policy: Policy = field.blocks ?? {};

  const setList = (key: keyof Policy, next: string[]) => {
    const { [key]: _previous, ...rest } = policy;
    void _previous;
    const updated: Policy = next.length > 0 ? { ...rest, [key]: next } : rest;
    // A policy with neither list is no policy, so the field stores none.
    const hasAny = Object.keys(updated).length > 0;
    if (hasAny) {
      onChange({ ...field, blocks: updated });
    } else {
      const { blocks: _dropped, ...withoutPolicy } = field;
      void _dropped;
      onChange(withoutPolicy);
    }
  };

  return (
    <div className="space-y-4">
      <NameList
        label="Blocks it accepts"
        help='Block names, or a namespace such as "core/*". Leave empty to accept any block.'
        addLabel="Add block"
        values={policy.allow ?? []}
        readOnly={readOnly}
        onChange={next => setList("allow", next)}
      />
      <NameList
        label="Document kinds"
        help='The kinds of document it holds, such as "page". Leave empty for any kind.'
        addLabel="Add kind"
        values={policy.kinds ?? []}
        readOnly={readOnly}
        onChange={next => setList("kinds", next)}
      />
    </div>
  );
}

/** A list of names: each removable, and a box to add one more. */
function NameList({
  label,
  help,
  addLabel,
  values,
  readOnly,
  onChange,
}: {
  label: string;
  help: string;
  addLabel: string;
  values: readonly string[];
  readOnly: boolean;
  onChange: (next: string[]) => void;
}): JSX.Element {
  const inputId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState("");

  // A name already listed is not added twice, and blank input adds nothing.
  const add = () => {
    const name = draft.trim();
    if (name === "" || values.includes(name)) return;
    onChange([...values, name]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  return (
    <div className="space-y-2">
      {/* Read-only draws no input, so the label then points at nothing. */}
      <Label htmlFor={readOnly ? undefined : inputId}>{label}</Label>
      <p id={helpId} className="text-xs text-muted-foreground">
        {help}
      </p>
      {values.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-1.5">
          {values.map(value => (
            <li
              key={value}
              className="flex items-center gap-1 rounded-sm border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <code>{value}</code>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(values.filter(v => v !== value))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            id={inputId}
            aria-describedby={helpId}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
