/**
 * "+ Create a header" in a set's picker: the route makes the component alone,
 * as the band's create does, for the area in its path, and writes no set.
 */
import { describe, expect, it, vi } from "vitest";

import { areaComponentRoute } from "./area-component-route";

function ctx(area: string) {
  return { params: { area }, self: { collections: {} } } as never;
}

describe("making a header for a set's picker", () => {
  it("makes the area's component with the shared create, and answers it", async () => {
    const create = vi.fn(async () => ({ id: "h2", title: "Header 2" }));
    const route = areaComponentRoute({ field: "content" }, create);
    const answer = await route.handler(new Request("http://x/"), ctx("header"));
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      { field: "content" },
      "header"
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({
      message: "Header 2 was created.",
      item: { id: "h2", title: "Header 2", area: "header" },
    });
  });

  it("refuses an area that isn't one, making nothing", async () => {
    const create = vi.fn();
    const route = areaComponentRoute({ field: "content" }, create);
    await expect(
      route.handler(new Request("http://x/"), ctx("sidebar"))
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("is a POST at its own path, judged by core as the caller", () => {
    const route = areaComponentRoute();
    expect(route).toMatchObject({
      method: "POST",
      path: "/layouts/areas/:area/component",
      checksAccess: true,
    });
    expect(route).not.toHaveProperty("requiredPermission");
  });
});
