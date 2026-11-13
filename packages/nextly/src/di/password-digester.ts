/**
 * The account-password digester of the running app: built from the
 * `passwordHasher` it passed to `getNextly`, or core's bcrypt without one.
 *
 * The one place a path asks which scheme hashes and verifies a password, so
 * none can come to hash with one scheme while another verifies with a second.
 * It reads the registered config on each call, so a path built before the
 * services were registered still answers with the app's hasher.
 *
 * @module di/password-digester
 */

import {
  passwordDigester,
  type PasswordDigester,
} from "../auth/password/digester";

import { container } from "./container";
import type { NextlyServiceConfig } from "./register";

/** The running app's digester; core's bcrypt before any config is registered. */
export function appPasswordDigester(): PasswordDigester {
  const config = container.has("config")
    ? container.get<NextlyServiceConfig>("config")
    : undefined;
  return passwordDigester(config?.passwordHasher);
}
