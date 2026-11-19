"use client";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import type { ProviderTypeOption, TemplateOption } from "./activity-choices";
import {
  ORIGIN_FILTERS,
  OUTCOME_FILTERS,
  TIME_WINDOWS,
  type ActivityFilter,
  type OutcomeFilter,
} from "./activity-model";

/**
 * Sentinel for "no filter": Radix Select forbids an empty value. Every other
 * value carries a prefix, so no template slug or provider can be mistaken
 * for it, a template named `any` included.
 */
const ANY = "any";

/** The value a template is selected by. */
export function templateValue(slug: string): string {
  return `template:${slug}`;
}

/** The value a provider type is selected by. */
export function providerTypeValue(type: string): string {
  return `type:${type}`;
}

/** The default filters: any outcome, the last 7 days. */
export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = {
  outcome: "any",
  window: "7d",
};

/** Whether any filter narrows the list beyond the default window. */
export function isFiltered(filter: ActivityFilter): boolean {
  return (
    filter.outcome !== "any" ||
    filter.template !== undefined ||
    filter.providerType !== undefined ||
    filter.providerOrigin !== undefined
  );
}

export interface ActivityFiltersProps {
  filter: ActivityFilter;
  onChange: (filter: ActivityFilter) => void;
  /** Templates to offer; `undefined` hides the template filter. */
  templates: readonly TemplateOption[] | undefined;
  /** Provider types to offer; `undefined` hides the provider filters. */
  providers: readonly ProviderTypeOption[] | undefined;
}

/**
 * Activity's filters: outcome, template, provider type, where the provider
 * came from, and how far back. Each wraps onto its own line at phone width
 * rather than scrolling sideways.
 */
export function ActivityFilters({
  filter,
  onChange,
  templates,
  providers,
}: ActivityFiltersProps): JSX.Element {
  const set = (next: Partial<ActivityFilter>) =>
    onChange({ ...filter, ...next });
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-wrap">
        <Select
          value={filter.outcome}
          onValueChange={value => set({ outcome: value as OutcomeFilter })}
        >
          <SelectTrigger aria-label="Outcome" className="xl:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_FILTERS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {templates && (
          <Select
            value={filter.template ? templateValue(filter.template) : ANY}
            onValueChange={value =>
              set({
                template: templates.find(
                  option => templateValue(option.slug) === value
                )?.slug,
              })
            }
          >
            <SelectTrigger aria-label="Template" className="xl:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any template</SelectItem>
              {templates.map(option => (
                <SelectItem
                  key={option.slug}
                  value={templateValue(option.slug)}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {providers && (
          <Select
            value={
              filter.providerType ? providerTypeValue(filter.providerType) : ANY
            }
            onValueChange={value =>
              set({
                providerType: providers.find(
                  option => providerTypeValue(option.type) === value
                )?.type,
              })
            }
          >
            <SelectTrigger aria-label="Provider" className="xl:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any provider</SelectItem>
              {providers.map(option => (
                <SelectItem
                  key={option.type}
                  value={providerTypeValue(option.type)}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {providers && (
          <Select
            value={filter.providerOrigin ?? ANY}
            onValueChange={value =>
              set({
                providerOrigin: ORIGIN_FILTERS.find(
                  option => option.value === value
                )?.value,
              })
            }
          >
            <SelectTrigger aria-label="Provider origin" className="xl:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any origin</SelectItem>
              {ORIGIN_FILTERS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div
        role="group"
        aria-label="How far back"
        className="inline-flex w-full rounded-md border border-border bg-muted/40 p-1 sm:w-auto"
      >
        {TIME_WINDOWS.map(option => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={filter.window === option.value ? "outline" : "ghost"}
            aria-pressed={filter.window === option.value}
            className="flex-1 sm:flex-none"
            onClick={() => set({ window: option.value })}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
