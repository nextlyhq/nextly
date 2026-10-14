import {
  respondAction,
  respondDoc,
  type PluginAuditDeclaration,
  type PluginPermission,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import {
  ACCOUNT_STATES,
  STAFF_ACTIONS,
  STAFF_API_PATH,
  type StaffAccountBody,
  type StaffAccountsListBody,
  type StaffAction,
} from "../admin-contract";
import { accountsError } from "../errors";
import type { FlowDeps } from "../flows/deps";
import { runStaffAction } from "../flows/staff-actions";
import { accountForStaff, listAccountsForStaff } from "../flows/staff-reads";

import { ACCOUNT_PRINCIPAL } from "./routes";

/** Staff who hold it see the list of accounts and each account's page. */
export const READ_ACCOUNTS = "read-accounts";

/** Staff who hold it act on an account: every action in `STAFF_ACTIONS`. */
export const MANAGE_ACCOUNTS = "manage-accounts";

/**
 * The plugin's two permissions, which a site grants through its roles: no
 * staff member needs to be a super-admin to look after accounts.
 */
export const STAFF_PERMISSIONS: PluginPermission[] = [
  {
    action: "read",
    resource: "accounts",
    label: "Read accounts",
    description:
      "See the site's accounts: their addresses, names and states, never a password",
  },
  {
    action: "manage",
    resource: "accounts",
    label: "Manage accounts",
    description:
      "Deactivate, reactivate and delete accounts, end their sessions, and send them verification and reset emails",
    // Deleting an account cannot be undone.
    danger: true,
  },
];

/** The audit kind each action is recorded under. */
const AUDIT_KINDS: Record<StaffAction, string> = {
  deactivate: "nextlyhq-plugin-accounts.staff.deactivated",
  reactivate: "nextlyhq-plugin-accounts.staff.reactivated",
  "end-sessions": "nextlyhq-plugin-accounts.staff.sessions-ended",
  "resend-verification": "nextlyhq-plugin-accounts.staff.verification-resent",
  "send-reset": "nextlyhq-plugin-accounts.staff.reset-link-sent",
  delete: "nextlyhq-plugin-accounts.staff.deleted",
};

/**
 * What a staff action's audit row carries beside the staff member: the
 * account, by its kind and id alone, never its address or its name, so a
 * row keeps nothing personal about the account once it is deleted.
 */
const AUDIT_METADATA_KEYS = ["accountKind", "accountId"];

export const STAFF_AUDIT: PluginAuditDeclaration = {
  kinds: STAFF_ACTIONS.map(action => ({
    kind: AUDIT_KINDS[action],
    metadataKeys: AUDIT_METADATA_KEYS,
  })),
};

/** What each action answers once it is done. */
const DONE: Record<StaffAction, string> = {
  deactivate: "The account is deactivated.",
  reactivate: "The account is active again.",
  "end-sessions": "The account's sessions have ended.",
  "resend-verification": "The verification email is on its way.",
  "send-reset": "A reset link is on its way.",
  delete: "The account is deleted.",
};

/** The list's query, as staff send it. */
const LIST_QUERY = z.strictObject({
  search: z.string().max(320).optional(),
  state: z.enum(ACCOUNT_STATES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

/** An account's id as a path names it; anything else is no account. */
const ACCOUNT_ID = z.string().min(1).max(36);

/**
 * The admin's routes: reads gated by `read-accounts`, actions by
 * `manage-accounts`, every answer `no-store`, and every action written to
 * core's audit log with the staff member who took it. Writes take the
 * double-submit CSRF token the admin's own client sends.
 */
export function staffRoutes(deps: () => FlowDeps): PluginRoute[] {
  return [
    {
      method: "GET",
      path: STAFF_API_PATH,
      requiredPermission: READ_ACCOUNTS,
      noStore: true,
      handler: request => listEndpoint(deps(), request),
    },
    {
      method: "GET",
      path: `${STAFF_API_PATH}/:id`,
      requiredPermission: READ_ACCOUNTS,
      noStore: true,
      handler: (_request, ctx) => accountEndpoint(deps(), ctx),
    },
    ...STAFF_ACTIONS.map(
      (action): PluginRoute => ({
        method: "POST",
        path: `${STAFF_API_PATH}/:id/${action}`,
        requiredPermission: MANAGE_ACCOUNTS,
        csrf: true,
        noStore: true,
        handler: (request, ctx) => actionEndpoint(deps(), ctx, request, action),
      })
    ),
  ];
}

/**
 * One page of the list, in the list envelope `{ items, meta }`, where `meta`
 * says the page, its size and whether pages follow or precede it. It carries
 * no total, and so is built here rather than by `respondList`, which needs
 * one: the plugin's database surface has no count to give a total without
 * reading every matching row.
 */
async function listEndpoint(
  deps: FlowDeps,
  request: Request
): Promise<Response> {
  const parsed = LIST_QUERY.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success)
    throw accountsError(
      "ACCOUNTS_INVALID_INPUT",
      { reason: "staff-list-query" },
      { reason: "query" }
    );
  const page = await listAccountsForStaff(deps, parsed.data);

  const body: StaffAccountsListBody = {
    items: page.items,
    meta: {
      page: page.page,
      limit: page.perPage,
      hasNext: page.hasNext,
      hasPrev: page.page > 1,
    },
  };

  return Response.json(body);
}

/** An account's page, and whether this staff member may act on it. */
async function accountEndpoint(
  deps: FlowDeps,
  ctx: PluginRouteContext
): Promise<Response> {
  const account = await accountForStaff(deps, accountIdOf(ctx));
  if (account === null) throw accountsError("ACCOUNTS_NOT_FOUND");

  const body: StaffAccountBody = {
    account,
    canManage: (await ctx.caller?.can("manage", "accounts")) ?? false,
  };

  return respondDoc(body);
}

/** Runs one action, and records it in the audit log once it is done. */
async function actionEndpoint(
  deps: FlowDeps,
  ctx: PluginRouteContext,
  request: Request,
  action: StaffAction
): Promise<Response> {
  const accountId = accountIdOf(ctx);
  // Read before acting: an action must never happen without its record.
  const audit = auditOf(ctx);
  const result = await runStaffAction(deps, action, accountId);
  if (result.status === "missing") throw accountsError("ACCOUNTS_NOT_FOUND");
  if (result.status === "refused")
    throw accountsError(
      "ACCOUNTS_NOT_APPLICABLE",
      { action, reason: result.reason },
      { reason: result.reason }
    );

  await audit.write({
    kind: AUDIT_KINDS[action],
    actorUserId: ctx.user?.id ?? null,
    request,
    metadata: { accountKind: ACCOUNT_PRINCIPAL, accountId },
  });

  return respondAction(DONE[action], { accountId });
}

function accountIdOf(ctx: PluginRouteContext): string {
  const parsed = ACCOUNT_ID.safeParse(ctx.params.id);
  if (!parsed.success) throw accountsError("ACCOUNTS_NOT_FOUND");
  return parsed.data;
}

/**
 * The plugin's audit writer, which core lends a plugin that declares its
 * kinds; one that does not is a core this plugin cannot run on.
 */
function auditOf(
  ctx: PluginRouteContext
): NonNullable<PluginRouteContext["audit"]> {
  if (ctx.audit === undefined)
    throw accountsError("ACCOUNTS_CORE_MISSING", { missing: "audit" });
  return ctx.audit;
}
