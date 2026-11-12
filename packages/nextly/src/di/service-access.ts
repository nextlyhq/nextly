/**
 * Reading services from the DI container, apart from registering them.
 *
 * `register.ts` imports every service registration, so a module that only
 * wants to look a service up would load all of them by importing from there.
 * This file depends on the container alone; `ServiceMap` and the registration
 * itself stay in `register.ts`, reached here only as a type.
 */
import { container } from "./container";
import type { ServiceMap } from "./register";

/**
 * The flag `registerServices()` sets once registration has finished and
 * `shutdownServices()` and `clearServices()` clear. It lives on `globalThis`
 * so that every copy of this module in one process reads the same answer;
 * `register.ts` is the only writer.
 */
const registration = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
};

/**
 * Get a service from the container with type safety.
 * Services must be registered first via `registerServices()`.
 */
export function getService<T extends keyof ServiceMap>(name: T): ServiceMap[T] {
  return container.get<ServiceMap[T]>(name);
}

/**
 * Check if services have been registered.
 */
export function isServicesRegistered(): boolean {
  return registration.__nextly_isRegistered ?? false;
}

/**
 * Who waits for registration to finish, kept beside the flag on `globalThis`
 * so every copy of this module shares the waiters.
 */
const waiting = globalThis as unknown as {
  __nextly_registeredWaiters?: (() => void)[];
};

/**
 * Resolves once services are registered: at once when they are, else when
 * `registerServices()` finishes. For work a plugin starts during the boot
 * without awaiting it, which can then wait for the boot instead of failing.
 * Awaited inside the boot itself (a plugin's `init` or `onReady`), it would
 * wait for its own boot and never resolve.
 */
export function whenServicesRegistered(): Promise<void> {
  if (isServicesRegistered()) return Promise.resolve();
  return new Promise(resolve => {
    (waiting.__nextly_registeredWaiters ??= []).push(resolve);
  });
}

/** Release everyone waiting; `register.ts` calls it as it sets the flag. */
export function announceServicesRegistered(): void {
  const waiters = waiting.__nextly_registeredWaiters ?? [];
  waiting.__nextly_registeredWaiters = [];
  for (const resolve of waiters) resolve();
}
