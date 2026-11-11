"use client";

/**
 * The one field picker every surface opens to add a field.
 *
 * It opens on its search box, shows a short most-used group then categories,
 * and finds a type by its name, description, category or any of its synonyms
 * (developer and older Nextly names included). Arrow keys move, Enter picks,
 * Escape closes. Picking a type asks only for a label, with the name derived
 * and shown; picking the field-group type first asks which existing field
 * group. "Add field" and "Add and add another" hand the choice to the host,
 * which decides where the field goes and how it is stored: the picker writes
 * nothing.
 *
 * A surface configures it rather than forking it: which built-in types it
 * offers, the surface whose plugin types join them, what it excludes, its
 * most-used types, how a label becomes a name, and its field groups.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nextlyhq/ui";
import type { FieldSurface, FieldTypeDescription } from "nextly/field-catalog";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import * as Icons from "@admin/components/icons";
import { Type } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import {
  groupFieldTypes,
  offeredFieldTypes,
  searchFieldTypes,
} from "./field-type-search";
import { usePluginFieldTypeEntries } from "./usePluginFieldTypeEntries";

/** An existing field group the picker can embed, told apart from its namesakes. */
export interface FieldGroupOption {
  /** Its address, stored on the new field. */
  slug: string;
  /** Its name, the new field's label until the person changes it. */
  label: string;
  /** What a person reads in the list, with what tells it apart. */
  text: string;
}

/** What one surface offers in the picker. */
export interface FieldPickerConfig {
  /** The surface whose plugin field types join the list. */
  surface: FieldSurface;
  /** The built-in types the surface offers, described with `describeFieldTypes`. */
  types: readonly FieldTypeDescription<string>[];
  /** Types to leave out, built-in or plugin. */
  exclude?: readonly string[];
  /** Type ids shown first, in this order, before the categories. */
  mostUsed?: readonly string[];
  /** The name a label gives a new field; empty when it gives none. */
  deriveName: (label: string) => string;
  /** The type that embeds a field group, and the groups it may embed. */
  fieldGroups?: {
    type: string;
    options: readonly FieldGroupOption[];
    loading?: boolean;
  };
}

/** What the person chose: a type, a label and the name derived from it. */
export interface FieldPickerChoice {
  type: string;
  label: string;
  name: string;
  /** The chosen field group's address, for the field-group type. */
  fieldGroup?: string;
}

export interface FieldPickerProps {
  open: boolean;
  config: FieldPickerConfig;
  /** The heading; "Add a field" when absent. */
  title?: string;
  /** Where the field will go, as the host words it ("to Address"). */
  placement?: string;
  /**
   * The label the label step starts with, for a field that has one already
   * (a type chosen again before the field is saved). Empty when absent.
   */
  initialLabel?: string;
  /**
   * Whether "Add and add another" is offered; false for a host that adds one
   * field at a time, where the picker would only close as "Add field" does.
   * Offered when absent.
   */
  offerAddAnother?: boolean;
  onCancel: () => void;
  /** Called with the choice; `addAnother` keeps the picker open for the next. */
  onAdd: (choice: FieldPickerChoice, how: { addAnother: boolean }) => void;
}

type Step =
  | { kind: "type" }
  | { kind: "field-group"; type: FieldTypeDescription<string> }
  | {
      kind: "label";
      type: FieldTypeDescription<string>;
      fieldGroup?: FieldGroupOption;
    };

const iconMap = Icons as unknown as Record<string, React.ElementType>;

/**
 * The active row of a list driven from a search box: clamped to the list as it
 * changes (plugin rows can arrive after it opens), and scrolled into view so a
 * row reached by the arrows is never off-screen.
 */
function useActiveRow(count: number, optionId: (index: number) => string) {
  const [active, setActive] = useState(0);
  const clamped = Math.max(0, Math.min(active, count - 1));
  useEffect(() => {
    // jsdom has no layout, so it has no scrollIntoView either.
    document.getElementById(optionId(clamped))?.scrollIntoView?.({
      block: "nearest",
    });
  }, [clamped, optionId]);
  return [clamped, setActive] as const;
}

/**
 * The arrow and Enter keys of a search box that drives a list: arrows move the
 * active row, clamped to the list, and Enter picks it.
 */
function listKeys(
  count: number,
  active: number,
  setActive: (next: number) => void,
  pick: (index: number) => void
) {
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(count - 1, Math.max(0, active + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (count > 0) pick(active);
    }
  };
}

export function FieldPicker({
  open,
  config,
  title = "Add a field",
  placement,
  initialLabel,
  offerAddAnother,
  onCancel,
  onAdd,
}: FieldPickerProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {placement ??
              "Search for a field type, then give the field a label."}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted with the dialog, so every opening starts on a fresh search. */}
        {open && (
          <PickerBody
            config={config}
            initialLabel={initialLabel}
            offerAddAnother={offerAddAnother}
            onCancel={onCancel}
            onAdd={onAdd}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  config,
  initialLabel,
  offerAddAnother,
  onCancel,
  onAdd,
}: Pick<
  FieldPickerProps,
  "config" | "initialLabel" | "offerAddAnother" | "onCancel" | "onAdd"
>) {
  const [step, setStep] = useState<Step>({ kind: "type" });
  const [query, setQuery] = useState("");

  const back = () => setStep({ kind: "type" });

  if (step.kind === "type") {
    return (
      <TypeStep
        config={config}
        query={query}
        onQueryChange={setQuery}
        onCancel={onCancel}
        onPick={type =>
          setStep(
            config.fieldGroups && type.type === config.fieldGroups.type
              ? { kind: "field-group", type }
              : { kind: "label", type }
          )
        }
      />
    );
  }
  if (step.kind === "field-group") {
    return (
      <FieldGroupStep
        options={config.fieldGroups?.options ?? []}
        loading={config.fieldGroups?.loading === true}
        onBack={back}
        onPick={fieldGroup =>
          setStep({ kind: "label", type: step.type, fieldGroup })
        }
      />
    );
  }
  return (
    <LabelStep
      key={`${step.type.type}:${step.fieldGroup?.slug ?? ""}`}
      type={step.type}
      fieldGroup={step.fieldGroup}
      initialLabel={initialLabel}
      offerAddAnother={offerAddAnother !== false}
      deriveName={config.deriveName}
      onBack={() =>
        setStep(
          step.fieldGroup
            ? { kind: "field-group", type: step.type }
            : { kind: "type" }
        )
      }
      onAdd={(label, name, addAnother) => {
        onAdd(
          {
            type: step.type.type,
            label,
            name,
            ...(step.fieldGroup ? { fieldGroup: step.fieldGroup.slug } : {}),
          },
          { addAnother }
        );
        if (addAnother) {
          setQuery("");
          setStep({ kind: "type" });
        }
      }}
    />
  );
}

function TypeStep({
  config,
  query,
  onQueryChange,
  onCancel,
  onPick,
}: {
  config: FieldPickerConfig;
  query: string;
  onQueryChange: (query: string) => void;
  onCancel: () => void;
  onPick: (type: FieldTypeDescription<string>) => void;
}) {
  const listId = useId();
  const pluginRows = usePluginFieldTypeEntries(config.surface);
  const offered = useMemo(
    () => offeredFieldTypes(config.types, pluginRows, config.exclude),
    [config.types, pluginRows, config.exclude]
  );
  const results = searchFieldTypes(offered, query);
  const groups = useMemo(
    () => groupFieldTypes(offered, config.mostUsed ?? []),
    [offered, config.mostUsed]
  );
  // The rows in the order the arrows walk them, grouped or not.
  const rows = results ?? groups.flatMap(group => group.types);
  const optionId = useCallback(
    (index: number) => `${listId}-option-${index}`,
    [listId]
  );
  const [active, setActive] = useActiveRow(rows.length, optionId);

  const renderOption = (type: FieldTypeDescription<string>) => {
    const index = rows.indexOf(type);
    const Icon = iconMap[type.icon] ?? Type;
    return (
      <div
        key={type.type}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        data-type={type.type}
        onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => onPick(type)}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-md border p-2",
          // The active row is marked as the kit marks a selected card, a
          // primary border and tint, plus the focus ring: a tint keeps the
          // row's own text tokens legible in both colour schemes, where a
          // solid accent fill hid the muted description in dark.
          index === active
            ? "border-primary bg-primary/10 ring-2 ring-ring"
            : "border-border bg-background"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {type.label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {type.hint}
          </span>
        </span>
      </div>
    );
  };

  return (
    <>
      <Input
        role="combobox"
        aria-label="Search field types"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={rows.length > 0 ? optionId(active) : undefined}
        placeholder="Search field types"
        value={query}
        autoFocus
        onChange={event => {
          onQueryChange(event.target.value);
          setActive(0);
        }}
        onKeyDown={listKeys(rows.length, active, setActive, index =>
          onPick(rows[index])
        )}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Field types"
        // Padded so the active row's ring is not clipped by the scroll edge.
        className="max-h-[400px] space-y-3 overflow-y-auto p-1"
      >
        {results
          ? results.map(renderOption)
          : groups.map(group => (
              <div key={group.heading} role="group" aria-label={group.heading}>
                <div
                  aria-hidden
                  className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground"
                >
                  {group.heading}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {group.types.map(renderOption)}
                </div>
              </div>
            ))}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {results?.length === 0
          ? `No field type matches “${query.trim()}”.`
          : ""}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function FieldGroupStep({
  options,
  loading,
  onBack,
  onPick,
}: {
  options: readonly FieldGroupOption[];
  loading: boolean;
  onBack: () => void;
  onPick: (option: FieldGroupOption) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = options.filter(option =>
    option.text.toLowerCase().includes(q)
  );
  const optionId = useCallback(
    (index: number) => `${listId}-option-${index}`,
    [listId]
  );
  const [active, setActive] = useActiveRow(matches.length, optionId);
  const message = loading
    ? "Loading field groups…"
    : options.length === 0
      ? "There are no field groups yet."
      : matches.length === 0
        ? `No field group matches “${query.trim()}”.`
        : "";

  return (
    <>
      <Input
        role="combobox"
        aria-label="Search field groups"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          matches.length > 0 ? optionId(active) : undefined
        }
        placeholder="Search field groups"
        value={query}
        autoFocus
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={listKeys(matches.length, active, setActive, index =>
          onPick(matches[index])
        )}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Field groups"
        className="max-h-[400px] space-y-1.5 overflow-y-auto p-1"
      >
        {matches.map((option, index) => (
          <div
            key={option.slug}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(option)}
            className={cn(
              "cursor-pointer rounded-md border p-2 text-sm",
              index === active
                ? "border-primary bg-primary/10 ring-2 ring-ring"
                : "border-border bg-background"
            )}
          >
            {option.text}
          </div>
        ))}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
      </DialogFooter>
    </>
  );
}

function LabelStep({
  type,
  fieldGroup,
  initialLabel,
  offerAddAnother,
  deriveName,
  onBack,
  onAdd,
}: {
  type: FieldTypeDescription<string>;
  fieldGroup?: FieldGroupOption;
  initialLabel?: string;
  offerAddAnother: boolean;
  deriveName: (label: string) => string;
  onBack: () => void;
  onAdd: (label: string, name: string, addAnother: boolean) => void;
}) {
  const inputId = useId();
  const [label, setLabel] = useState(fieldGroup?.label ?? initialLabel ?? "");
  const trimmed = label.trim();
  const name = trimmed ? deriveName(trimmed) : "";
  const add = (addAnother: boolean) => {
    if (name) onAdd(trimmed, name, addAnother);
  };

  return (
    <>
      <div className="text-sm">
        <span data-picked className="font-medium">
          {type.label}
        </span>
        {fieldGroup && (
          <span className="text-muted-foreground"> · {fieldGroup.text}</span>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>Label</Label>
        <Input
          id={inputId}
          value={label}
          autoFocus
          onChange={event => setLabel(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(false);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Name: <code>{name || "—"}</code>
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {offerAddAnother && (
          <Button variant="outline" disabled={!name} onClick={() => add(true)}>
            Add and add another
          </Button>
        )}
        <Button disabled={!name} onClick={() => add(false)}>
          Add field
        </Button>
      </DialogFooter>
    </>
  );
}
