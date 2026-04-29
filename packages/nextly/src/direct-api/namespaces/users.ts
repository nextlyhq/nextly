/**
 * Direct API Users Namespace
 *
 * Factory for the `nextly.users.*` sub-namespace. Provides CRUD operations
 * on the users collection via the dedicated `UserService` (not the generic
 * collection handler).
 *
 * @packageDocumentation
 */

import type { User } from "../../services/users/user-service";
import type { PaginatedResponse } from "../../types/pagination";
import { NextlyError, NextlyErrorCode } from "../errors";
import type {
  CreateUserArgs,
  DeleteResult,
  DeleteUserArgs,
  FindOneUserArgs,
  FindUserByIDArgs,
  FindUsersArgs,
  UpdateUserArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  createRequestContext,
  isNotFoundError,
  mergeConfig,
  toPaginatedResponse,
} from "./helpers";

/**
 * Users namespace API, bound to a Nextly context.
 */
export interface UsersNamespace {
  find(args?: FindUsersArgs): Promise<PaginatedResponse<User>>;
  findOne(args?: FindOneUserArgs): Promise<User | null>;
  findByID(args: FindUserByIDArgs): Promise<User | null>;
  create(args: CreateUserArgs): Promise<User>;
  update(args: UpdateUserArgs): Promise<User>;
  delete(args: DeleteUserArgs): Promise<DeleteResult>;
}

/**
 * Build the `users` namespace for a `Nextly` instance.
 */
export function createUsersNamespace(ctx: NextlyContext): UsersNamespace {
  return {
    async find(args: FindUsersArgs = {}): Promise<PaginatedResponse<User>> {
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

      return toPaginatedResponse(result, limit, page);
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

    async create(args: CreateUserArgs): Promise<User> {
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
      return user;
    },

    async update(args: UpdateUserArgs): Promise<User> {
      if (!args.id) {
        throw new NextlyError(
          "'id' is required for users.update()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
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
      return user;
    },

    async delete(args: DeleteUserArgs): Promise<DeleteResult> {
      if (!args.id) {
        throw new NextlyError(
          "'id' is required for users.delete()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      await ctx.userService.delete(args.id, createRequestContext(args));
      return {
        deleted: true,
        ids: [args.id],
      };
    },
  };
}
