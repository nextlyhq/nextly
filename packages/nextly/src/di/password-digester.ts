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
import type {
  PasswordHasher,
  PasswordPolicyOptions,
} from "../auth/password/policy";

import { container } from "./container";
import type { NextlyServiceConfig } from "./register";

/**
 * The hasher of a config loaded without registering the services: what a CLI
 * command that writes accounts publishes once it has read `nextly.config.ts`,
 * so an account it creates is hashed as the app will verify it.
 */
let loadedHasher: PasswordHasher | undefined;

/**
 * Publish the loaded config's `auth.passwordHasher` for a process that does
 * not register the services. Registered services take precedence: their config
 * is the app's own.
 */
export function useLoadedPasswordHasher(
  hasher: PasswordHasher | undefined
): void {
  loadedHasher = hasher;
}

/**
 * The running app's digester: the registered config's hasher, or, where no
 * config is registered, the one a loaded config published; core's bcrypt
 * without either.
 */
export function appPasswordDigester(): PasswordDigester {
  if (container.has("config")) {
    return passwordDigester(
      container.get<NextlyServiceConfig>("config").passwordHasher
    );
  }
  return passwordDigester(loadedHasher);
}

/**
 * The password rule an account password is judged by: the app's hasher's
 * reach, or its own `validate`, in place of core bcrypt's 72 bytes. Every
 * entry point that judges an account password before writing it (sign-up,
 * first setup, the CLI's administrator) asks this, so each takes or refuses
 * the same password the account services do.
 */
export function appPasswordRule(): PasswordPolicyOptions {
  return { hasher: appPasswordDigester().hasher };
}
