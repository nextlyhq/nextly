/**
 * A `ServiceContainer` built on a given adapter, loaded when it is first asked
 * for.
 *
 * `./index` defines the container and imports every core service. Code that
 * builds one only inside a function, as the role seeders and the user services
 * do, would otherwise load all of them, and the route handler and registry
 * behind them, merely by being imported. This module imports `./index` as a
 * type only, so nothing is loaded until a container is built.
 *
 * It builds a new container each time, from the adapter it is handed, exactly
 * as `new ServiceContainer(adapter)` at the call site did; it does not look up
 * the registered services.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { ServiceContainer } from "./index";

export async function serviceContainerFor(
  adapter: DrizzleAdapter
): Promise<ServiceContainer> {
  const { ServiceContainer } = await import("./index");
  return new ServiceContainer(adapter);
}
