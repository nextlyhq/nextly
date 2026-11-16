// @vitest-environment jsdom
/**
 * The open tab's label colour.
 *
 * jsdom applies no stylesheet, so this pins the CLASSES the trigger carries,
 * and the light and dark axe scans in the e2e suite check what they draw. The
 * label is in the foreground colour: the primary is a fill colour, and on a
 * site whose brand primary is a mid-tone it falls short of AA as small text.
 * The primary stays as the line under the open tab, which is what marks it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function classesOf(name: string): string[] {
  return (screen.getByRole("tab", { name }).getAttribute("class") ?? "").split(
    /\s+/
  );
}

describe("the open tab's label", () => {
  it("is drawn in the foreground colour, marked by the primary line", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">first</TabsContent>
        <TabsContent value="two">second</TabsContent>
      </Tabs>
    );

    const classes = classesOf("One");
    expect(classes).toContain("data-[state=active]:text-foreground");
    expect(classes).toContain("hover:text-foreground");
    expect(classes).not.toContain("data-[state=active]:text-primary");
    expect(classes).not.toContain("hover:text-primary");
    // The marker is unchanged: the primary line under the open tab.
    expect(classes).toContain("data-[state=active]:border-b-primary");
  });
});
