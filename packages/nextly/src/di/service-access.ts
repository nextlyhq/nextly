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
