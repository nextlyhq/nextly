"use client";

/**
 * The registered workflows, one card each: its label, that it is defined in
 * code, the collections and Singles using it, and its stages with how many
 * documents are recorded in each. A card opens the workflow's own page.
 */

import { Badge } from "@nextlyhq/ui";
import { ChevronRight, FileCode } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { WorkflowSummary } from "@admin/types/workflows";

import { StagePill } from "./StagePill";
import { attachmentsPhrase } from "./workflow-settings-model";

export interface WorkflowListProps {
  workflows: readonly WorkflowSummary[];
}

/** The "Defined in code" badge every workflow carries: none is made here. */
export function DefinedInCodeBadge(): React.JSX.Element {
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <FileCode aria-hidden="true" className="size-3.5" />
      Defined in code
    </Badge>
  );
}

export function WorkflowList({
  workflows,
}: WorkflowListProps): React.JSX.Element {
  return (
    <ul className="space-y-3" aria-label="Workflows">
      {workflows.map(workflow => (
        <li key={workflow.slug}>
          <Link
            href={buildRoute(ROUTES.SETTINGS_WORKFLOW_DETAIL, {
              slug: workflow.slug,
            })}
            className="group flex items-start gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{workflow.label}</h2>
                <DefinedInCodeBadge />
              </div>
              <p className="text-sm text-muted-foreground">
                Used by {attachmentsPhrase(workflow)}
              </p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                {workflow.stages.map(stage => (
                  <li
                    key={stage.name}
                    className="inline-flex items-center gap-1.5 text-sm"
                  >
                    <StagePill label={stage.label} colour={undefined} />
                    <span className="font-medium">
                      {workflow.stageCounts[stage.name] ?? 0}
                      <span className="sr-only"> documents</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
