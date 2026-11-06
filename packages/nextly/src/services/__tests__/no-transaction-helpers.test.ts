/**
 * Neither the service container nor the dispatcher offers a `withTransaction`.
 *
 * Both once did, and both opened a transaction, ran the callback on pooled
 * services that never saw it, and so made nothing atomic (and waited forever
 * on a pool of one). A transaction has one home, the adapter's
 * `transaction()`. Held at the type level and on the prototypes, so neither
 * comes back unnoticed.
 */
import { describe, expect, it } from "vitest";

import { ServiceDispatcher } from "../../dispatcher/dispatcher";
import { ServiceContainer } from "../index";

/** Whether `T` has a member named `withTransaction`. */
type HasWithTransaction<T> = "withTransaction" extends keyof T ? true : false;

// Each line fails the typecheck while its class has the member.
const containerHasIt: HasWithTransaction<ServiceContainer> = false;
const dispatcherHasIt: HasWithTransaction<ServiceDispatcher> = false;

describe("the service container and the dispatcher", () => {
  it("offer no withTransaction", () => {
    expect(containerHasIt).toBe(false);
    expect(dispatcherHasIt).toBe(false);
    expect("withTransaction" in ServiceContainer.prototype).toBe(false);
    expect("withTransaction" in ServiceDispatcher.prototype).toBe(false);
  });
});
