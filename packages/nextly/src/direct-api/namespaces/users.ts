/**
 * Direct API Users Namespace
 *
 * Factory for the `nextly.users.*` sub-namespace. Provides CRUD operations
 * on the users collection via the dedicated `UserService` (not the generic
 * collection handler).
 *
 * @packageDocumentation
 */

import {
  roleChangeCallerFor,
  runAsRoleChangeCaller,
} from "../../domains/auth/services/super-admin-grant";
import { NextlyError } from "../../errors/nextly-error";
import type { User } from "../../services/users/user-service";
import type {
  CreateUserArgs,
  DeleteUserArgs,
  FindOneUserArgs,
  FindUserByIDArgs,
  FindUsersArgs,
  ListResult,
  DirectAPIConfig,
  MutationResult,
  UpdateUserArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  checkWrite,
  createRequestContext,
  isNotFoundError,
  mergeConfig,
  toListResult,
  type RouteGrant,
} from "./helpers";

/**
 * Users namespace API, bound to a Nextly context.
 *
 * `ListResult<T>` / `MutationResult<T>` envelopes so the Direct API and
 * the wire API speak the same shape.
 */
export interface UsersNamespace {
  find(args?: FindUsersArgs): Promise<ListResult<User>>;
  findOne(args?: FindOneUserArgs): Promise<User | null>;
  findByID(args: FindUserByIDArgs): Promise<User | null>;
  create(args: CreateUserArgs): Promise<MutationResult<User>>;
  update(args: UpdateUserArgs): Promise<MutationResult<User>>;
  delete(args: DeleteUserArgs): Promise<MutationResult<{ id: string }>>;
}

/**
 * What each user write asks of a checked caller: the permission the REST
 * route asks (`requirePermission(req, action, "users")`).
 */
const USER_WRITE = {
  create: { action: "create", resource: "users" },
  update: { action: "update", resource: "users" },
  delete: { action: "delete", resource: "users" },
} as const satisfies Record<string, RouteGrant>;

/**
 * Run a user write as REST runs it: checked first, when the call asks to be,
 * and then as its caller for the rule on granting super-admin, which only a
 * super-admin person passes and an API key never does. A trusted call runs as
 * trusted server code, which that rule allows.
 */
async function userWrite<T>(
  ctx: NextlyContext,
  args: DirectAPIConfig,
  grant: RouteGrant,
  write: () => Promise<T>
): Promise<T> {
  const caller = await checkWrite(ctx.defaultConfig, args, grant);
  if (!caller) return write();
  return runAsRoleChangeCaller(roleChangeCallerFor(caller), write);
}

/**
 * Build the `users` namespace for a `Nextly` instance.
 */
export function createUsersNamespace(ctx: NextlyContext): UsersNamespace {
  return {
    async find(args: FindUsersArgs = {}): Promise<ListResult<User>> {
      const limit = args.limit ?? 10;
      const page = args.page ?? 1;

      const result = await ctx.userService.listUsers(
        {
          pagination: { limit, page },
          search: args.search,
          emailVerified: args.emailVerified,
          hasPassword: args.hasPassword,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
        },
        createRequestContext(args)
      );

      // The limit the service ACTUALLY paginated by, not the one requested. It bounds the page
      // size it will honour, and deriving `totalPages` from the request instead would report a
      // page count for a page size that was never used.
      return toListResult(result, result.pagination.limit, page);
    },

    async findOne(args: FindOneUserArgs = {}): Promise<User | null> {
      const result = await ctx.userService.listUsers(
        {
          pagination: { limit: 1, page: 1 },
          search: args.search,
          emailVerified: args.emailVerified,
          hasPassword: args.hasPassword,
        },
        createRequestContext(args)
      );

      return result.data[0] ?? null;
    },

    async findByID(args: FindUserByIDArgs): Promise<User | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      try {
        const user = await ctx.userService.findById(
          args.id,
          createRequestContext(args)
        );
        return user;
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async create(args: CreateUserArgs): Promise<MutationResult<User>> {
      const data = args.data ?? {};
      const { name, image, roles, isActive, ...customFields } = data;
      const user = await userWrite(ctx, args, USER_WRITE.create, () =>
        ctx.userService.create(
          {
            email: args.email,
            name: (name as string) ?? "",
            password: args.password,
            image: image as string | undefined,
            roles: roles as string[] | undefined,
            isActive: isActive as boolean | undefined,
            ...customFields,
          },
          createRequestContext(args)
        )
      );
      // matching the wire API. Hardcoded noun ("User") since this is the
      // users-specific namespace.
      return {
        message: "User created.",
        item: user,
      };
    },

    async update(args: UpdateUserArgs): Promise<MutationResult<User>> {
      if (!args.id) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'id' is required for users.update()",
          statusCode: 400,
        });
      }

      const data = args.data ?? {};
      const { email, name, image, emailVerified, isActive, ...customFields } =
        data;
      const id = args.id;
      const user = await userWrite(ctx, args, USER_WRITE.update, () =>
        ctx.userService.update(
          id,
          {
            email: email as string | undefined,
            name: name as string | undefined,
            image: image as string | undefined,
            emailVerified: emailVerified as Date | null | undefined,
            isActive: isActive as boolean | undefined,
            ...customFields,
          },
          createRequestContext(args)
        )
      );
      return {
        message: "User updated.",
        item: user,
      };
    },

    async delete(
      args: DeleteUserArgs
    ): Promise<MutationResult<{ id: string }>> {
      if (!args.id) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'id' is required for users.delete()",
          statusCode: 400,
        });
      }

      const id = args.id;
      await userWrite(ctx, args, USER_WRITE.delete, () =>
        ctx.userService.delete(id, createRequestContext(args))
      );
      // For deletes the `item` is just the deleted id so callers can still
      // chain on something concrete (matches the wire API's `{ id }` shape
      // returned by delete handlers under `respondMutation`).
      return {
        message: "User deleted.",
        item: { id: args.id },
      };
    },
  };
}
