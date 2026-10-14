import { describe, expect, it } from "vitest";

import { ACCOUNT_PRINCIPAL, accountsRoutes } from "./routes";

/** The routes only a signed-in holder may reach. */
const HOLDER_ROUTES = [
  "POST /sign-out/everywhere",
  "POST /password",
  "POST /address",
  "POST /address/confirm",
  "POST /delete",
];

describe("the accounts routes", () => {
  const routes = accountsRoutes(() => {
    throw new Error("no route runs here");
  });
  const named = (route: (typeof routes)[number]) =>
    `${route.method} ${route.path}`;

  it("asks core for the account kind on the holder's routes alone", () => {
    expect(
      routes.filter(route => route.principal !== undefined).map(named)
    ).toEqual(HOLDER_ROUTES);
    for (const route of routes.filter(r => HOLDER_ROUTES.includes(named(r))))
      expect(route.principal).toEqual({ kind: ACCOUNT_PRINCIPAL });
  });

  it("makes every other route public, and no route both", () => {
    const others = routes.filter(
      route => !HOLDER_ROUTES.includes(named(route))
    );

    expect(others).toHaveLength(11);
    for (const route of others) expect(route.public).toBe(true);
    for (const route of routes)
      expect(route.public === true && route.principal !== undefined).toBe(
        false
      );
  });

  it("serves each route once", () => {
    const names = routes.map(named);

    expect(new Set(names).size).toBe(names.length);
  });
});
