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

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import { Copy, Lock } from "lucide-react";
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
import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";
import type {
  WorkflowAssignee,
  WorkflowStepSummary,
} from "@admin/types/workflows";

import { DefaultReviewerSection } from "./DefaultReviewerSection";
import { GrantRolesDialog } from "./GrantRolesDialog";
import { StageLabelsSection } from "./StageLabelsSection";
import { StepGrantsTable } from "./StepGrantsTable";
import { useWorkflowSettingsSave } from "./useWorkflowSettingsSave";
import { workflowSettingsAccess } from "./workflow-permissions";
import {
  attachmentsPhrase,
  reviewerOptions,
  rolesHoldingPrimary,
  staleReviewers,
} from "./workflow-settings-model";
import { WorkflowDiagram } from "./WorkflowDiagram";
import { WorkflowEmailSection } from "./WorkflowEmailSection";
import { DefinedInCodeBadge } from "./WorkflowList";
import { WorkflowNotices } from "./WorkflowNotices";

/** Enough roles and people for a settings choice, in one page each. */
const ONE_PAGE = {
  pagination: { page: 0, pageSize: 100 },
  sorting: [],
  filters: {},
};

const parentCrumb = { label: "Workflows", href: ROUTES.SETTINGS_WORKFLOWS };

/** A titled card of the page, named by its heading. */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <div className="space-y-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Copies the configuration file's path, and says so in its own name for a
 * moment, so a screen reader hears the copy happen.
 */
function CopyPathButton({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={copied ? "Path copied" : "Copy path"}
      onClick={() => {
        void navigator.clipboard?.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <Copy aria-hidden="true" className="size-3.5" />
      {copied ? "Copied" : "Copy path"}
    </Button>
  );
}

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
  // People are offered as reviewers only to a reader who may list them.
  const users = useUsers(ONE_PAGE, {
    enabled: access.update && hasPermission("read-users"),
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

  const roleName = (id: string): string => {
    const role = roleItems.find(each => each.id === id);
    if (role) return role.roleName || role.name;
    const partial = Object.values(settings?.grantableSteps ?? {})
      .flatMap(step => step.partialRoles)
      .find(each => each.id === id);
    return partial?.name ?? `Role ${id}`;
  };
  const nameOf = (assignee: WorkflowAssignee): string => {
    if (assignee.kind === "role") return `${roleName(assignee.id)} (role)`;
    const user = userItems.find(each => each.id === assignee.id);
    return user ? user.name || user.email : `Person ${assignee.id}`;
  };

  const header = (title: string, description?: React.ReactNode) => ({
    title,
    description,
    crumb: title,
    parentCrumb,
  });

  const missing =
    (isApiError(settingsQuery.error) && settingsQuery.error.status === 404) ||
    (list.isSuccess && !workflow);
  if (missing) {
    return (
      <SettingsLayout {...header("Workflow not found")}>
        <Alert variant="warning" role="alert">
          <AlertDescription>
            No workflow named &ldquo;{slug}&rdquo; is registered. A workflow is
            defined in code and attached to a collection or Single.
          </AlertDescription>
        </Alert>
      </SettingsLayout>
    );
  }

  const failed = list.error ?? settingsQuery.error;
  if (failed) {
    return (
      <SettingsLayout {...header("Workflow")}>
        <Alert variant="destructive" role="alert">
          <AlertDescription className="space-y-3">
            <p>
              {apiErrorMessage(failed, "The workflow could not be loaded.")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void list.refetch();
                void settingsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </SettingsLayout>
    );
  }

  if (!workflow || !settings) {
    return (
      <SettingsLayout {...header("Workflow")}>
        <div className="space-y-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
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
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DefinedInCodeBadge />
          {workflow.configPath !== null && (
            <span className="inline-flex flex-wrap items-center gap-1">
              Registered in{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {workflow.configPath}
              </code>
              <CopyPathButton path={workflow.configPath} />
            </span>
          )}
          <span>Used by {attachmentsPhrase(workflow)}</span>
        </span>
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
          {access.update && !access.grants && (
            <p className="text-sm text-muted-foreground">
              Changing who takes a step also needs permission to update roles.
            </p>
          )}
          <StepGrantsTable
            workflow={workflow}
            settings={settings}
            roleName={roleName}
            canChange={access.grants}
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
          <DefaultReviewerSection
            workflow={workflow}
            settings={settings}
            optionsFor={stage =>
              reviewerOptions(workflow, settings, roleItems, userItems, stage)
            }
            judgedOnSave={stage =>
              rolesHoldingPrimary(workflow, settings, roleItems, stage) === null
            }
            nameOf={nameOf}
            canChange={access.update}
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
          description="The bell always tells the person named. Choose which also send an email."
        >
          <WorkflowEmailSection
            settings={settings}
            canChange={access.update}
            saving={saving}
            errors={errors}
            onChange={(trigger, on) => {
              void save(`emails.${trigger}`, { emails: { [trigger]: on } });
            }}
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
