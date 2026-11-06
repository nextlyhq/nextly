// Imported from the package root on purpose: `Role` is part of the public
// surface, and apps build their own values of it (fixtures, wrappers, cached
// copies), so a field added to it must not turn their literals into errors.
import type { Role } from "../../index";

// A role written as before `assignable` existed is still a Role.
export const roleWithoutAssignable: Role = {
  id: "role-1",
  name: "Editor",
  slug: "editor",
  level: 10,
  isSystem: false,
};
