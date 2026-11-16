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
  checkTemplate,
  type TemplateFailure,
} from "@admin/lib/builder/template-check";
import { templateFieldsToAdd } from "@admin/lib/builder/template-fields";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderConfig, BuilderKind } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

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
  /** Why Create waits, for the template, or null. */
  blockedBy: string | null;
  /** The fields Create hands over: the picked template's, less those left out. */
  fields: () => FieldDefinition[];
}

export function useTemplatePick(
  config: BuilderConfig,
  values: BuilderSettingsValues
): TemplatePick {
  const all = useSchemaTemplates(TEMPLATE_KIND[config.kind]);
  const pluginEntries = usePluginFieldTypeEntries("entries");
  // A starting field's type means pages designed visually; none, entries.
  const makes = values.startingFieldType ? "pages" : "entries";
  const templates = useMemo(
    () => all.filter(each => (each.template.makes ?? "entries") === makes),
    [all, makes]
  );
  const [picked, setPicked] = useState<OfferedTemplate | null>(null);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  // What the kind's picker offers, so a template adds nothing it would not.
  const offeredTypes = useMemo(
    () => builderOfferedTypes(config, pluginEntries),
    [config, pluginEntries]
  );
  const installedTypes = useMemo(
    () => new Set(pluginEntries.map(entry => entry.type)),
    [pluginEntries]
  );
  // A template picked for the other answer to "what will editors make" is no
  // longer offered, so it is no longer the one picked.
  const current = picked && templates.includes(picked) ? picked : null;
  const failures = current
    ? checkTemplate(current.template, {
        offeredTypes,
        installedTypes,
        lifecycleEnabled: values.status === true,
        leftOut,
      }).failures
    : [];
  return {
    templates,
    quick: templates.slice(0, QUICK_COUNT),
    picked: current,
    pick: next => {
      setPicked(next);
      setLeftOut(new Set());
    },
    leftOut,
    toggleLeftOut: key =>
      setLeftOut(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    failures,
    blockedBy:
      failures.length > 0
        ? "Leave out the fields this template cannot add, or choose another template."
        : null,
    fields: () =>
      current ? templateFieldsToAdd(current.template, leftOut) : [],
  };
}
