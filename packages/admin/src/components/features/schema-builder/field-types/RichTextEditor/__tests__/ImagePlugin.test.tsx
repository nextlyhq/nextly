/**
 * ImagePlugin Unit Tests
 *
 * Tests for INSERT_IMAGE_COMMAND handling and image insertion.
 */

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act, render } from "@testing-library/react";
import { $getRoot, $getSelection, $createParagraphNode } from "lexical";
import type { LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";

import { ImageNode, $isImageNode } from "../ImageNode";
import { ImagePlugin, INSERT_IMAGE_COMMAND } from "../ImagePlugin";
import { lexicalTheme } from "../theme";

interface EditorElement extends HTMLElement {
  __editor?: LexicalEditor;
}

// Helper component to test editor updates
function EditorContent() {
  const [editor] = useLexicalComposerContext();

  return (
    <div
      ref={contentRef => {
        if (contentRef) {
          // Store editor in data attribute for test access
          (contentRef as EditorElement).__editor = editor;
        }
      }}
    />
  );
}

// Test wrapper component
function TestEditor({ children }: { children: React.ReactNode }) {
  const initialConfig = {
    namespace: "Test",
    theme: lexicalTheme,
    onError: (error: Error) => {
      throw error;
    },
    nodes: [ImageNode],
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ImagePlugin />
      {children}
    </LexicalComposer>
  );
}

describe("ImagePlugin", () => {
  it("should register INSERT_IMAGE_COMMAND", () => {
    const { container } = render(
      <TestEditor>
        <EditorContent />
      </TestEditor>
    );

    const editor = (container.firstChild as EditorElement | null)?.__editor;
    expect(editor).toBeDefined();

    // Verify the command is registered by checking it doesn't throw
    act(() => {
      editor!.update(() => {
        // This will throw if command is not registered
        editor!.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/image.jpg",
          altText: "Test image",
        });
      });
    });
  });

  it("should insert ImageNode when INSERT_IMAGE_COMMAND is dispatched", () => {
    const { container } = render(
      <TestEditor>
        <EditorContent />
      </TestEditor>
    );

    const editor = (container.firstChild as EditorElement | null)!.__editor!;

    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.select();

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/test.jpg",
          altText: "Test image",
          width: 800,
          height: 600,
        });
      });
    });

    // Verify the image node was inserted
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();

      // Find ImageNode in children
      const imageNode = children.find(child => $isImageNode(child));

      expect(imageNode).toBeDefined();
      expect(imageNode?.getSrc()).toBe("https://example.com/test.jpg");
      expect(imageNode?.getAltText()).toBe("Test image");
      expect(imageNode?.getWidth()).toBe(800);
      expect(imageNode?.getHeight()).toBe(600);
    });
  });

  it("should insert ImageNode with minimal props", () => {
    const { container } = render(
      <TestEditor>
        <EditorContent />
      </TestEditor>
    );

    const editor = (container.firstChild as EditorElement | null)!.__editor!;

    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.select();

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/minimal.jpg",
          altText: "Minimal image",
        });
      });
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const imageNode = children.find(child => $isImageNode(child));

      expect(imageNode).toBeDefined();
      expect(imageNode?.getSrc()).toBe("https://example.com/minimal.jpg");
      expect(imageNode?.getAltText()).toBe("Minimal image");
      expect(imageNode?.getWidth()).toBeUndefined();
      expect(imageNode?.getHeight()).toBeUndefined();
    });
  });

  it("should set maxWidth to 500 by default", () => {
    const { container } = render(
      <TestEditor>
        <EditorContent />
      </TestEditor>
    );

    const editor = (container.firstChild as EditorElement | null)!.__editor!;

    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.select();

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/image.jpg",
          altText: "Test",
        });
      });
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const imageNode = children.find(child => $isImageNode(child));

      expect(imageNode?.getMaxWidth()).toBe(500);
    });
  });

  it("should throw error if ImageNode is not registered", () => {
    const initialConfig = {
      namespace: "Test",
      theme: lexicalTheme,
      onError: (error: Error) => {
        // Suppress error logging in test
      },
      nodes: [], // No ImageNode registered
    };

    expect(() => {
      render(
        <LexicalComposer initialConfig={initialConfig}>
          <ImagePlugin />
          <EditorContent />
        </LexicalComposer>
      );
    }).toThrow("ImagePlugin: ImageNode not registered on editor");
  });

  it("should insert multiple images", () => {
    const { container } = render(
      <TestEditor>
        <EditorContent />
      </TestEditor>
    );

    const editor = (container.firstChild as EditorElement | null)!.__editor!;

    act(() => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.select();

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/image1.jpg",
          altText: "Image 1",
        });

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/image2.jpg",
          altText: "Image 2",
        });

        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          src: "https://example.com/image3.jpg",
          altText: "Image 3",
        });
      });
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const imageNodes = children.filter(child => $isImageNode(child));

      expect(imageNodes).toHaveLength(3);
      expect(imageNodes[0]?.getSrc()).toBe("https://example.com/image1.jpg");
      expect(imageNodes[1]?.getSrc()).toBe("https://example.com/image2.jpg");
      expect(imageNodes[2]?.getSrc()).toBe("https://example.com/image3.jpg");
    });
  });
});
