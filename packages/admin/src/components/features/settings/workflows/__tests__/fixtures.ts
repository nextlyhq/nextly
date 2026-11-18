/**
 * A workflow and its settings as the server answers them, for the settings
 * screen's tests: `editorial`, where Writing → Legal check → Cleared, Legal
 * check can be parked On hold, and Clear and Bounce share the permission
 * `sign-off`. Send, Park, Resume and Fast-track name none of their own.
 */
import type { Role } from "@admin/types/entities";
import type { UserApiResponse } from "@admin/types/user";
import type {
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

export const EDITORIAL: WorkflowSummary = {
  slug: "editorial",
  label: "Editorial",
  stages: [
    { name: "writing", label: "Writing", allowsPublish: false },
    { name: "legal", label: "Legal check", allowsPublish: false },
    { name: "hold", label: "On hold", allowsPublish: false },
    { name: "cleared", label: "Cleared", allowsPublish: true },
  ],
  steps: [
    {
      name: "send",
      label: "Send to legal",
      kind: "submit",
      from: ["writing"],
      to: "legal",
      primary: true,
      grantable: false,
    },
    {
      name: "clear",
      label: "Clear",
      kind: "approve",
      from: ["legal"],
      to: "cleared",
      primary: true,
      grantable: true,
    },
    {
      name: "bounce",
      label: "Bounce",
      kind: "request-changes",
      from: ["legal", "cleared"],
      to: "writing",
      primary: false,
      grantable: true,
    },
    {
      name: "park",
      label: "Park",
      kind: "move",
      from: ["legal"],
      to: "hold",
      primary: false,
      grantable: false,
    },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: ["hold"],
      to: "legal",
      primary: true,
      grantable: false,
    },
    {
      name: "fastTrack",
      label: "Fast-track",
      kind: "approve",
      from: ["hold"],
      to: "cleared",
      primary: false,
      grantable: false,
    },
  ],
  collections: ["posts", "pages"],
  singles: ["banner"],
};

/** Settings at revision 3: Lawyers hold sign-off everywhere, Interns on some collections. */
export function settingsOf(
  overrides: Partial<WorkflowSettingsView> = {}
): WorkflowSettingsView {
  return {
    workflow: "editorial",
    revision: 3,
    defaultReviewers: {},
    labels: {},
    emails: { assigned: true, approved: true, changesRequested: true },
    grants: { clear: ["r-lawyers"], bounce: ["r-lawyers"] },
    grantableSteps: {
      clear: {
        permission: "sign-off",
        partialRoles: [{ id: "r-interns", name: "Interns" }],
        sharesPermissionWith: ["bounce"],
      },
      bounce: {
        permission: "sign-off",
        partialRoles: [{ id: "r-interns", name: "Interns" }],
        sharesPermissionWith: ["clear"],
      },
    },
    ...overrides,
  };
}

const role = (id: string, name: string, extra: Partial<Role> = {}): Role => ({
  id,
  roleName: name,
  name,
  subtitle: "",
  description: "",
  type: "Custom",
  permissions: [],
  ...extra,
});

export const ROLES: Role[] = [
  role("r-admin", "Super admin", { builtIn: "super-admin", type: "System" }),
  role("r-public", "Public", {
    builtIn: "public",
    assignable: false,
    type: "System",
  }),
  role("r-lawyers", "Lawyers"),
  role("r-interns", "Interns"),
  role("r-editors", "Editors"),
];

const user = (id: string, name: string, roles: string[]): UserApiResponse => ({
  id,
  name,
  email: `${id}@example.test`,
  roles: roles.map(roleId => ({
    id: roleId,
    name: roleId,
    level: 0,
    isSystem: false,
  })),
  created: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

export const USERS: UserApiResponse[] = [
  user("u-rita", "Rita", ["r-lawyers"]),
  user("u-ed", "Ed", ["r-editors"]),
  user("u-ada", "Ada", ["r-admin"]),
];
