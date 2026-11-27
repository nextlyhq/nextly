/**
 * Core holds the AI contract and nothing that talks to a model: no AI library
 * in any of `nextly`'s dependency lists. Providers belong to the AI package.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const manifestPath = fileURLToPath(
  new URL("../../../../package.json", import.meta.url)
);

/** Names, or name prefixes ending in `/`, of libraries that call models. */
const AI_LIBRARIES = [
  "ai",
  "@ai-sdk/",
  "openai",
  "@anthropic-ai/",
  "@google/generative-ai",
  "@google/genai",
  "@mistralai/",
  "cohere-ai",
  "groq-sdk",
  "ollama",
  "replicate",
  "langchain",
  "@langchain/",
  "llamaindex",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
];

function isAILibrary(name: string): boolean {
  return AI_LIBRARIES.some(library =>
    library.endsWith("/") ? name.startsWith(library) : name === library
  );
}

describe("nextly's package", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
  } & Partial<
    Record<
      | "dependencies"
      | "devDependencies"
      | "peerDependencies"
      | "optionalDependencies",
      Record<string, string>
    >
  >;

  it("is the manifest it means to read", () => {
    expect(manifest.name).toBe("nextly");
    expect(Object.keys(manifest.dependencies ?? {}).length).toBeGreaterThan(0);
  });

  it("lists no AI library in any dependency list", () => {
    const listed = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].flatMap(list => Object.keys(list ?? {}));
    expect(listed.filter(isAILibrary)).toEqual([]);
  });

  it("would catch one", () => {
    expect(
      ["ai", "@ai-sdk/openai", "@langchain/core", "openai"].every(isAILibrary)
    ).toBe(true);
    expect(["aim", "zod", "@aws-sdk/client-s3"].some(isAILibrary)).toBe(false);
  });
});
