import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { ServiceContainer } from "@nextly/services/index";

import type { SeederResult } from "./permissions";

/**
 * Type for adapters that support getDrizzle() method
 */
type AdapterWithDrizzle = {
  getDrizzle(schema?: Record<string, unknown>): unknown;
  dialect: string;
};

// Default super admin credentials
const DEFAULT_SUPER_ADMIN = {
  email: "admin@example.com",
  password: "Admin@123456",
  name: "Super Admin",
} as const;

// Seed a super admin user with a role that has all permissions

export async function seedSuperAdmin(
  adapter: DrizzleAdapter | AdapterWithDrizzle,
  options?: {
    email?: string;
    password?: string;
    name?: string;
    silent?: boolean;
  }
): Promise<SeederResult> {
  const {
    email = DEFAULT_SUPER_ADMIN.email,
    password = DEFAULT_SUPER_ADMIN.password,
    name = DEFAULT_SUPER_ADMIN.name,
    silent = false,
  } = options || {};

  const log = silent ? () => {} : console.log;
  const errorLog = silent ? () => {} : console.error;

  log(" Starting super admin seeding...\n");

  // Verify adapter has getDrizzle() support
  if (typeof (adapter as AdapterWithDrizzle).getDrizzle !== "function") {
    throw new Error(
      `Seeding not supported for adapter. Adapter must have getDrizzle() method.`
    );
  }

  const container = new ServiceContainer(adapter as DrizzleAdapter);
  const roleService = container.roles;
  const permissionService = container.permissions;
  const rolePermissionService = container.rolePermissions;
  const userRoleService = container.userRoles;
  const userService = container.users;

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  try {
    // Step 1: Check if super admin user already exists
    log(" Checking for existing super admin user...");
    const existingUser = await userService.findByEmail(email);

    let userId: string;

    if (existingUser) {
      log(`  User already exists: ${email}`);
      userId = String(existingUser.id);
      skipped++;
    } else {
      // Create super admin user using createLocalUser.
      // PR 4 (unified-error-system): createLocalUser returns the
      // created user directly and throws NextlyError on failure. Any
      // throw here is caught by the outer try/catch which converts it
      // into a SeederResult.
      log(`  Creating super admin user: ${email}`);

      // Pass plain password - createLocalUser will hash it correctly
      const newUser = await userService.createLocalUser({
        email,
        name,
        password: password, // Will be hashed by createLocalUser
        isActive: true,
      });

      userId = String(newUser.id);
      created++;

      // Auto-verify the super admin's email so they can log in immediately
      await userService
        .updateUser(userId, { emailVerified: new Date() })
        .catch(() => {});
    }

    // Step 2: Get all permissions first (needed for role creation).
    // PR 4 (unified-error-system): listPermissions returns
    // `{ data, meta }` directly and throws on failure.
    log("\n Fetching all permissions...");
    const allPermissionsResult = await permissionService.listPermissions({
      limit: 1000,
    });

    const allPermissions = allPermissionsResult.data;
    log(`  Found ${allPermissions.length} permissions`);

    // Step 3: Check if "Super Admin" role exists
    log("\nChecking for Super Admin role...");
    const existingRole = await roleService.getRoleByName("Super Admin");

    let roleId: string;
    let roleAlreadyExists = false;

    if (existingRole) {
      log("   Super Admin role already exists");
      roleId = String(existingRole.id);
      roleAlreadyExists = true;
      skipped++;
    } else {
      // Create Super Admin role with all permissions
      log("  Creating Super Admin role with all permissions");
      const allPermissionIds = allPermissions.map((p: { id: unknown }) =>
        String(p.id)
      );

      // PR 4 (unified-error-system): createRole returns the role
      // directly and throws NextlyError on failure. Throws are caught
      // by the outer try/catch.
      const newRole = await roleService.createRole({
        name: "Super Admin",
        slug: "super-admin",
        description: "Has all permissions in the system",
        permissionIds: allPermissionIds,
        isSystem: true,
        level: 100, // Highest level
      });

      roleId = String(newRole.id);
      created++;
      created += allPermissionIds.length; // Count permission assignments
    }

    // Step 4: If role already existed, ensure it has all permissions
    if (roleAlreadyExists) {
      log("\n Ensuring Super Admin role has all permissions...");
      let assignedCount = 0;

      for (const permission of allPermissions) {
        try {
          // addPermissionToRole returns void, so just call it
          await rolePermissionService.addPermissionToRole(roleId, {
            action: permission.action,
            resource: permission.resource,
            name: permission.name,
          });
          assignedCount++;
        } catch (error) {
          // Permission might already be assigned, which is fine
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          if (!errorMsg.includes("already") && !errorMsg.includes("exists")) {
            errorLog(
              `Failed to assign permission ${permission.action}:${permission.resource}: ${errorMsg}`
            );
          }
        }
      }

      log(`Ensured ${assignedCount} permissions are assigned`);
      created += assignedCount;
    }

    // Step 5: Assign Super Admin role to user
    log("\n Assigning Super Admin role to user...");
    const userRoleResult = await userRoleService.assignRoleToUser(
      userId,
      roleId
    );

    if (userRoleResult.success) {
      if (userRoleResult.statusCode === 201) {
        log("Role assigned to user");
        created++;
      } else if (userRoleResult.statusCode === 409) {
        log("User already has this role");
        skipped++;
      }
    } else if (userRoleResult.statusCode === 409) {
      // Treat 409 as success (already exists)
      log("User already has this role");
      skipped++;
    } else {
      // Only treat as error if it's not a 409
      const errorMsg = `Failed to assign role to user: ${userRoleResult.message}`;
      errorLog(` ${errorMsg}`);
      errorMessages.push(errorMsg);
      errors++;
    }

    log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log("Super Admin Seeding Summary:");
    log(`  Created: ${created}`);
    log(`   Skipped: ${skipped}`);
    log(` Errors: ${errors}`);
    log(` Total: ${created + skipped + errors}`);
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (errors === 0) {
      log("Super admin seeding completed successfully!");
      log(`\nLogin credentials:`);
      log(`Email: ${email}`);
      log(`Password: ${password}`);
      log(`\n IMPORTANT: Change the password after first login!\n`);
    } else {
      errorLog("Some operations failed during super admin seeding.");
    }

    return {
      success: errors === 0,
      created,
      skipped,
      errors,
      total: created + skipped + errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
    };
  } catch (error) {
    const errorMsg = `Unexpected error during super admin seeding: ${error instanceof Error ? error.message : String(error)}`;
    errorLog(`\n${errorMsg}`);
    errorMessages.push(errorMsg);
    errors++;

    return {
      success: false,
      created,
      skipped,
      errors,
      total: created + skipped + errors,
      errorMessages,
    };
  }
}
