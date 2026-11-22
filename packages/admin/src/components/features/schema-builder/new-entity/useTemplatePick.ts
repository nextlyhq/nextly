/**
 * The template the new-entity dialog starts an entity from, if one: the
 * templates offered for the kind and for what editors will make, the one
 * picked, the fields left out of it, the check of what is left, and the fields
 * Create hands over.
 *
 * @module components/features/schema-builder/new-entity/useTemplatePick
 */
import { useMemo, useState } from "react";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";
import { builderOfferedTypes } from "@admin/lib/builder/offered-field-types";
import {
  useSchemaTemplates,
  type OfferedTemplate,
  type SchemaTemplateKind,
} from "@admin/lib/builder/schema-templates";
import {
  hasPageBuilderField,
  startingFields,
} from "@admin/lib/builder/starting-field";
import {
  checkTemplate,
  type TemplateFailure,
  type TemplateNeed,
} from "@admin/lib/builder/template-check";
import { templateFieldsToAdd } from "@admin/lib/builder/template-fields";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderConfig, BuilderKind } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

/** None needed, as one value, so a reader's memo keeps it between renders. */
const NO_NEEDS: readonly TemplateNeed[] = [];

/** How many templates the dialog offers before "Browse all templates". */
const QUICK_COUNT = 3;

const TEMPLATE_KIND: Record<BuilderKind, SchemaTemplateKind> = {
  collection: "collection",
  single: "single",
  "field-group": "fieldGroup",
};

export interface TemplatePick {
  /** Every template offered for this kind and for what editors will make. */
  templates: readonly OfferedTemplate[];
  /** The first few, offered in the dialog itself. */
  quick: readonly OfferedTemplate[];
  picked: OfferedTemplate | null;
  pick: (next: OfferedTemplate | null) => void;
  leftOut: ReadonlySet<string>;
  /** Leave the field with `key` out, or put it back. */
  toggleLeftOut: (key: string) => void;
  /** Each rule a field kept breaks. */
  failures: readonly TemplateFailure[];
  /** What the fields kept need to exist, read from them. */
  needs: readonly TemplateNeed[];
  /** Why Create waits, for the template, or null. */
  blockedBy: string | null;
  /** The fields Create hands over: the picked template's, less those left out. */
  fields: () => FieldDefinition[];
}

/** `set` with `key` added, or taken out when it holds it. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * The picked template checked against what the kind's picker offers, the
 * plugins installed, the entity's drafts, the fields left out and the fields
 * it starts with: once per change to any of them, so what it needs is one
 * value between renders for the readers that ask about it.
 */
function useCheckedTemplate(
  current: OfferedTemplate | null,
  config: BuilderConfig,
  pluginEntries: Parameters<typeof builderOfferedTypes>[1],
  lifecycleEnabled: boolean,
  leftOut: ReadonlySet<string>,
  starting: readonly { name: string }[]
): ReturnType<typeof checkTemplate> | null {
  // What the kind's picker offers, so a template adds nothing it would not.
  const offeredTypes = useMemo(
    () => builderOfferedTypes(config, pluginEntries),
    [config, pluginEntries]
  );
  const installedTypes = useMemo(
    () => new Set(pluginEntries.map(entry => entry.type)),
    [pluginEntries]
  );
  return useMemo(
    () =>
      current
        ? checkTemplate(current.template, {
            offeredTypes,
            installedTypes,
            lifecycleEnabled,
            leftOut,
            startingFieldNames: starting.map(field => field.name),
          })
        : null,
    [current, offeredTypes, installedTypes, lifecycleEnabled, leftOut, starting]
  );
}

export function useTemplatePick(
  config: BuilderConfig,
  values: BuilderSettingsValues
): TemplatePick {
  const all = useSchemaTemplates(TEMPLATE_KIND[config.kind]);
  const pluginEntries = usePluginFieldTypeEntries("entries");
  // The fields the entity starts with: the Page Builder's among them means
  // pages designed visually; any other, or none, entries. Derived as the
  // created entity is, so the templates offered match what it will be.
  const starting = useMemo(
    () => startingFields(values.startingFieldType ?? null),
    [values.startingFieldType]
  );
  const makes = hasPageBuilderField(starting) ? "pages" : "entries";
  const templates = useMemo(
    () => all.filter(each => (each.template.makes ?? "entries") === makes),
    [all, makes]
  );
  const [picked, setPicked] = useState<OfferedTemplate | null>(null);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  // A template picked for the other answer to "what will editors make" is no
  // longer offered, so it is dropped with the fields left out of it: answering
  // back starts with no template, never the old one brought back. Reset while
  // rendering, so no render shows the dropped template.
  if (picked && !templates.includes(picked)) {
    setPicked(null);
    setLeftOut(new Set());
  }
  const current = picked && templates.includes(picked) ? picked : null;
  const checked = useCheckedTemplate(
    current,
    config,
    pluginEntries,
    values.status === true,
    leftOut,
    starting
  );
  const failures = checked?.failures ?? [];
  return {
    templates,
    quick: templates.slice(0, QUICK_COUNT),
    picked: current,
    pick: next => {
      setPicked(next);
      setLeftOut(new Set());
    },
    leftOut,
    toggleLeftOut: key => setLeftOut(prev => toggled(prev, key)),
    failures,
    needs: checked?.needs ?? NO_NEEDS,
    blockedBy:
      failures.length > 0
        ? "Leave out the fields this template cannot add, or choose another template."
        : null,
    fields: () =>
      current ? templateFieldsToAdd(current.template, leftOut) : [],
  };
}
