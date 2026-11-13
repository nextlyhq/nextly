/**
 * A signed-out screen (sign-in, register, setup and the rest) draws its
 * content inside one `main` landmark, as the signed-in shell does.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicLayout } from "../PublicLayout";

describe("PublicLayout", () => {
  it("draws its content inside the page's one main landmark", () => {
    render(
      <PublicLayout>
        <p>Registration Is Closed</p>
      </PublicLayout>
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("Registration Is Closed")
    );
  });
});
