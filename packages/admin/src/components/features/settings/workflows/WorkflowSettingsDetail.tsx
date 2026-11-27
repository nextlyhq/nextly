"use client";

/**
 * One workflow in Settings: what its code defines, read-only, and the choices
 * admins own about it, each section saved on its own.
 *
 * In order: the header (defined in code, used by), a bar saying where stages
 * and steps change, the notices, the diagram, who takes each step, the default
 * reviewers, labels and colours, and notifications. A reader who may not
 * change settings sees every section without its controls; one who may change
 * settings but not roles sees who takes each step without "Change".
 */

import { Lock } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { ROUTES } from "@admin/constants/routes";
import { useRoles } from "@admin/hooks/queries/useRoles";
import { useUsers } from "@admin/hooks/queries/useUsers";
import {
  useWorkflows,
  useWorkflowSettings,
} from "@admin/hooks/queries/useWorkflows";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { isApiError } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";
import type { WorkflowStepSummary } from "@admin/types/workflows";

import { CandidateLoadError } from "./CandidateLoadError";
import { DefaultReviewerSection } from "./DefaultReviewerSection";
import { GrantRolesDialog } from "./GrantRolesDialog";
import { StageLabelsSection } from "./StageLabelsSection";
import { StepGrantsTable } from "./StepGrantsTable";
import { useWorkflowSettingsSave } from "./useWorkflowSettingsSave";
import { workflowSettingsAccess } from "./workflow-permissions";
import {
  assigneeNames,
  reviewerOptions,
  staleReviewers,
} from "./workflow-settings-model";
import {
  RolesAccessNote,
  Section,
  WorkflowDetailUnavailableBody,
  WorkflowHeaderDescription,
  type WorkflowDetailUnavailable,
} from "./WorkflowDetailParts";
import { WorkflowDiagram } from "./WorkflowDiagram";
import { WorkflowEmailSection } from "./WorkflowEmailSection";
import { WorkflowNotices } from "./WorkflowNotices";

/** Enough roles and people for a settings choice, in one page each. */
const ONE_PAGE = {
  pagination: { page: 0, pageSize: 100 },
  sorting: [],
  filters: {},
};

const parentCrumb = { label: "Workflows", href: ROUTES.SETTINGS_WORKFLOWS };

/** The settings chrome's identity for a page titled `title`. */
const header = (title: string, description?: React.ReactNode) => ({
  title,
  description,
  crumb: title,
  parentCrumb,
});

export interface WorkflowSettingsDetailProps {
  slug: string;
}

export function WorkflowSettingsDetail({
  slug,
}: WorkflowSettingsDetailProps): React.JSX.Element {
  const list = useWorkflows();
  const settingsQuery = useWorkflowSettings(slug);
  const { hasPermission } = useCurrentUserPermissions();
  const access = workflowSettingsAccess(hasPermission);
  const roles = useRoles(ONE_PAGE);
  // People are offered as reviewers only to a reader who may choose a reviewer
  // and may list them.
  const users = useUsers(ONE_PAGE, {
    enabled: access.reviewers && hasPermission("read-users"),
  });
  const { refetch } = settingsQuery;
  const refetchSettings = useCallback(() => refetch(), [refetch]);
  const { save, saving, errors, status, conflict } = useWorkflowSettingsSave(
    slug,
    settingsQuery.data,
    refetchSettings
  );
  const [granting, setGranting] = useState<WorkflowStepSummary | null>(null);

  const workflow = list.data?.items.find(each => each.slug === slug);
  useDocumentTitle(workflow?.label);
  const settings = settingsQuery.data;
  const roleItems = useMemo(() => roles.data?.items ?? [], [roles.data]);
  const userItems = useMemo(() => users.data?.items ?? [], [users.data]);

  const { roleName, nameOf } = assigneeNames(roleItems, userItems, settings);

  // What the page shows while it has no workflow: none registered, a failed read, or still reading.
  const failed = list.error ?? settingsQuery.error;
  const unavailable: WorkflowDetailUnavailable | null =
    (isApiError(settingsQuery.error) && settingsQuery.error.status === 404) ||
    (list.isSuccess && !workflow)
      ? { kind: "missing", slug }
      : failed
        ? {
            kind: "failed",
            error: failed,
            onRetry: () => {
              void list.refetch();
              void settingsQuery.refetch();
            },
          }
        : !workflow || !settings
          ? { kind: "loading" }
          : null;
  if (unavailable || !workflow || !settings) {
    const title =
      unavailable?.kind === "missing" ? "Workflow not found" : "Workflow";
    return (
      <SettingsLayout {...header(title)}>
        <WorkflowDetailUnavailableBody
          state={unavailable ?? { kind: "loading" }}
        />
      </SettingsLayout>
    );
  }

  const grantableRoles = roleItems.filter(
    role => role.builtIn === undefined && role.assignable !== false
  );
  const saved = async (
    field: string,
    patch: Parameters<typeof save>[1]
  ): Promise<boolean> => (await save(field, patch)) === "saved";

  return (
    <SettingsLayout
      {...header(
        workflow.label,
        <WorkflowHeaderDescription workflow={workflow} />
      )}
    >
      <div className="space-y-6">
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Stages and steps change in code, then deploy. Here you decide who
            takes each step, default reviewers, labels and notifications.
          </span>
        </p>

        <WorkflowNotices
          workflow={workflow}
          settings={settings}
          stale={staleReviewers(workflow, settings)}
          nameOf={nameOf}
        />

        {/* Every save's answer, a conflict's included, is announced here. */}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "min-h-5 text-sm",
            conflict ? "font-medium text-warning-text" : "text-muted-foreground"
          )}
        >
          {status}
        </p>

        <Section
          id="workflow-diagram"
          title="Stages and steps"
          description="How a document moves, read from the code."
        >
          <WorkflowDiagram workflow={workflow} settings={settings} />
        </Section>

        <Section
          id="workflow-grants"
          title="Who takes each step"
          description="The roles holding each step's permission on every collection and Single using this workflow."
        >
          <RolesAccessNote access={access} />
          {access.grants && roles.error ? (
            <CandidateLoadError
              what="roles"
              error={roles.error}
              onRetry={() => void roles.refetch()}
            />
          ) : null}
          <StepGrantsTable
            workflow={workflow}
            settings={settings}
            roleName={roleName}
            // Never a choice of roles drawn from a list that did not load.
            canChange={access.grants && !roles.error}
            saving={saving?.startsWith("grants.") ?? false}
            errors={errors}
            onChange={step => setGranting(step)}
          />
        </Section>

        <Section
          id="workflow-reviewers"
          title="Default reviewer"
          description="Assigned when a document enters the stage."
        >
          {access.reviewers && roles.error ? (
            <CandidateLoadError
              what="roles"
              error={roles.error}
              onRetry={() => void roles.refetch()}
            />
          ) : null}
          {/* People who failed to load are said so; the roles are still offered. */}
          {access.reviewers && users.error ? (
            <CandidateLoadError
              what="people"
              error={users.error}
              onRetry={() => void users.refetch()}
            />
          ) : null}
          <DefaultReviewerSection
            workflow={workflow}
            settings={settings}
            optionsFor={stage =>
              reviewerOptions(settings, roleItems, userItems, stage)
            }
            nameOf={nameOf}
            canChange={access.reviewers && !roles.error}
            saving={saving}
            errors={errors}
            onSave={(stage, reviewer) =>
              saved(`defaultReviewers.${stage}`, {
                defaultReviewers: { [stage]: reviewer },
              })
            }
          />
        </Section>

        <Section
          id="workflow-labels"
          title="Labels and colours"
          description="Shown in the editor, lists and notices. The code's names stay in the API and the types."
        >
          <StageLabelsSection
            workflow={workflow}
            settings={settings}
            canChange={access.update}
            saving={saving}
            errors={errors}
            onSave={(stage, patch) =>
              saved(`labels.${stage}`, { labels: { [stage]: patch } })
            }
          />
        </Section>

        <Section
          id="workflow-emails"
          title="Notifications"
          description="The Inbox always tells the person named. Choose which also send an email."
        >
          <WorkflowEmailSection
            settings={settings}
            canChange={access.update}
            saving={saving}
            errors={errors}
            onChange={(trigger, on) =>
              saved(`emails.${trigger}`, { emails: { [trigger]: on } })
            }
          />
        </Section>
      </div>

      {granting && (
        <GrantRolesDialog
          workflow={workflow}
          settings={settings}
          step={granting}
          roles={grantableRoles}
          saving={saving === `grants.${granting.name}`}
          error={errors[`grants.${granting.name}`]}
          onSave={roleIds =>
            saved(`grants.${granting.name}`, {
              grants: { [granting.name]: roleIds },
            })
          }
          onClose={() => setGranting(null)}
        />
      )}
    </SettingsLayout>
  );
}
