/**
 * Direct API Users Namespace
 *
 * Factory for the `nextly.users.*` sub-namespace. Provides CRUD operations
 * on the users collection via the dedicated `UserService` (not the generic
 * collection handler).
 *
 * @packageDocumentation
 */

import { NextlyError } from "../../errors/nextly-error";
import type { User } from "../../services/users/user-service";
import type {
  CreateUserArgs,
  DeleteUserArgs,
  FindOneUserArgs,
  FindUserByIDArgs,
  FindUsersArgs,
  ListResult,
  MutationResult,
  UpdateUserArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  createRequestContext,
  isNotFoundError,
  mergeConfig,
  toListResult,
} from "./helpers";

/**
 * Users namespace API, bound to a Nextly context.
 *
 * Phase 4 (Task 13): every list/mutation surface uses the canonical
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

      return toListResult(result, limit, page);
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
      const user = await ctx.userService.create(
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
      );
      // Phase 4 (Task 13): namespace mutations return `{ message, item }`
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
      const user = await ctx.userService.update(
        args.id,
        {
          email: email as string | undefined,
          name: name as string | undefined,
          image: image as string | undefined,
          emailVerified: emailVerified as Date | null | undefined,
          isActive: isActive as boolean | undefined,
          ...customFields,
        },
        createRequestContext(args)
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

      await ctx.userService.delete(args.id, createRequestContext(args));
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
