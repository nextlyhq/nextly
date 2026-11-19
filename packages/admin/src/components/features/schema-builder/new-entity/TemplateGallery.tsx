"use client";

/**
 * Every template for the kind being created, in one gallery: searched by name,
 * description and category, filtered by category, each showing where it comes
 * from (built in, or the plugin that offers it) and the fields it adds.
 *
 * @module components/features/schema-builder/new-entity/TemplateGallery
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@nextlyhq/ui";
import { type JSX, useMemo, useState } from "react";

import { useFieldTypeLabel } from "@admin/lib/builder/field-type-label";
import type {
  OfferedTemplate,
  SchemaTemplateField,
} from "@admin/lib/builder/schema-templates";

/** Where a template comes from, in the words its card uses. */
export function sourceWords(offered: OfferedTemplate): string {
  return offered.source === null ? "Built in" : `From ${offered.source}`;
}

/** Whether a template matches what was typed: every word somewhere in it. */
function matches(offered: OfferedTemplate, query: string): boolean {
  const { template } = offered;
  const text = [template.name, template.description, template.category]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => text.includes(word));
}

/** The fields a template adds, top level first, its containers' after them. */
function fieldsShown(
  fields: readonly SchemaTemplateField[]
): SchemaTemplateField[] {
  return fields.flatMap(field => [field, ...fieldsShown(field.fields ?? [])]);
}

function TemplateCard({
  offered,
  onUse,
}: {
  offered: OfferedTemplate;
  onUse: () => void;
}): JSX.Element {
  const typeLabel = useFieldTypeLabel();
  const { template } = offered;
  return (
    <article className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">{template.name}</h3>
          <p className="text-xs text-muted-foreground">
            {sourceWords(offered)}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onUse}>
          <span className="sr-only">Use {template.name}</span>
          <span aria-hidden="true">Use</span>
        </Button>
      </div>
      <p className="text-sm">{template.description}</p>
      <ul className="text-xs text-muted-foreground">
        {fieldsShown(template.fields).map((field, at) => (
          <li key={`${field.name}-${at}`}>
            {field.label || field.name} · {typeLabel(field.type)}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TemplateGallery({
  templates,
  onUse,
  onClose,
}: {
  templates: readonly OfferedTemplate[];
  onUse: (offered: OfferedTemplate) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(
    () => [...new Set(templates.map(each => each.template.category))],
    [templates]
  );
  const shown = templates.filter(
    each =>
      (category === null || each.template.category === category) &&
      matches(each, query)
  );
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>All templates</DialogTitle>
          <DialogDescription>
            Each adds the fields it lists; you can leave any out before Create.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Search templates"
          placeholder="Search templates"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-1" aria-label="Categories">
          {[null, ...categories].map(each => (
            <Button
              key={each ?? "all"}
              type="button"
              size="sm"
              variant={category === each ? "default" : "ghost"}
              aria-pressed={category === each}
              onClick={() => setCategory(each)}
            >
              {each ?? "All"}
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No template matches “{query.trim()}”.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {shown.map(each => (
              <TemplateCard
                key={`${each.source ?? "built-in"}:${each.template.id}`}
                offered={each}
                onUse={() => onUse(each)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
