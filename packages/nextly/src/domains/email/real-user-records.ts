/**
 * Core's real records for its own emails to a person (welcome, password
 * reset, email verification): a real user, newest first, whose name and
 * address fill the template's test data.
 *
 * Offered only to a person who may read users, as every owner's records are
 * (see `sample-records.ts`); the user service is looked up when a record is
 * asked for, never at startup.
 *
 * @module domains/email/real-user-records
 */

import { getService } from "../../di/service-access";
import { NextlyError } from "../../errors";
import { SYSTEM_CONTEXT } from "../../shared/types";
import type { User } from "../users/services/user-service";

import type { EmailSampleRecords } from "./sample-records";

/** What a user is called in the list: their name, or their address. */
function labelOf(user: Pick<User, "name" | "email">): string {
  const name = user.name?.trim();
  return name ? name : user.email;
}

/**
 * A real user for a template written to one person. The access check runs
 * before either method is called, so both read as the system.
 */
export const realUserRecords: EmailSampleRecords = {
  label: "A real user",
  reads: "users",
  async list({ limit }) {
    const users = await getService("userService").listUsers(
      {
        pagination: { limit, page: 1 },
        sortBy: "createdAt",
        sortOrder: "desc",
      },
      SYSTEM_CONTEXT
    );
    return users.data.map(user => ({
      id: String(user.id),
      label: labelOf(user),
    }));
  },
  async load(id) {
    let user: User;
    try {
      user = await getService("userService").findById(id, SYSTEM_CONTEXT);
    } catch (error) {
      // Not found, or an id no user can have: a record that is gone. Any
      // other failure is the server's, and is not answered as a gone record.
      if (
        NextlyError.isNotFound(error) ||
        NextlyError.isCode(error, "VALIDATION_ERROR")
      ) {
        return null;
      }
      throw error;
    }
    return { userName: labelOf(user), userEmail: user.email };
  },
};
