/**
 * Three defects, and each is the pane telling the truth about the wrong thing.
 *
 * The empty state was set in the code face, because the mono class sat on the
 * whole tab panel rather than on the JSON inside it. The toolbar's Copy acted
 * on the response body whatever tab was open, so on the Code tab it silently
 * copied JSON while the reader was looking at a snippet -- with a second,
 * correct Copy directly beneath it. And the metrics appeared only once a
 * response landed, so the header reflowed at the moment attention was on it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResponseViewer } from "../ResponseViewer";

const code = {
  sdk: "await nextly.find({ collection: 'posts' })",
  fetch: "await fetch('/admin/api/collections/posts/entries')",
  curl: "curl http://localhost/admin/api/collections/posts/entries",
};

// CodeMirror wants browser globals and has its own suite; what matters here is
// which string reaches the clipboard and which face the prose is set in.
vi.mock("../CodeBlock", () => ({
  CodeBlock: ({ value }: { value: string }) => <pre>{value}</pre>,
}));

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  window.localStorage.clear();
});

describe("ResponseViewer", () => {
  it("sets the empty state in the reading face, not the code face", () => {
    render(<ResponseViewer data={undefined} code={code} />);
    const heading = screen.getByText("No response yet");
    expect(heading.closest(".font-mono")).toBeNull();
  });

  it("holds a place for the metrics before the first send", () => {
    render(<ResponseViewer data={undefined} code={code} />);
    // Always present, so the header does not gain three values and reflow at
    // the moment a reply lands.
    expect(screen.getByTestId("response-meta")).toHaveTextContent("—");
  });

  it("shows the metrics once a response exists", () => {
    render(
      <ResponseViewer
        data={{ items: [] }}
        code={code}
        status={200}
        time={52}
        size={5943}
      />
    );
    const meta = screen.getByTestId("response-meta");
    expect(meta).toHaveTextContent("200");
    expect(meta).toHaveTextContent("52ms");
    expect(meta).toHaveTextContent("5.8 KB");
  });

  it("copies the body while the Body tab is open", async () => {
    render(<ResponseViewer data={{ items: [] }} code={code} />);
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify({ items: [] }, null, 2)
    );
  });

  it("copies the snippet, not the body, while the Code tab is open", async () => {
    render(<ResponseViewer data={{ items: [] }} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(code.sdk);
  });

  it("offers exactly one copy control on the Code tab", async () => {
    render(<ResponseViewer data={{ items: [] }} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    expect(screen.getAllByRole("button", { name: /^copy$/i })).toHaveLength(1);
  });

  it("does not offer to download a snippet as a response file", async () => {
    render(<ResponseViewer data={{ items: [] }} code={code} />);
    expect(
      screen.getByRole("button", { name: /download/i })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("copies the headers, not the body, while the Headers tab is open", async () => {
    // The third tab. Copy took the body whenever Code was closed, so reading
    // the headers and pressing Copy put JSON on the clipboard.
    render(
      <ResponseViewer
        data={{ items: [] }}
        code={code}
        headers={{
          "x-request-id": "abc123",
          "content-type": "application/json",
        }}
      />
    );
    await userEvent.click(screen.getByRole("tab", { name: /headers/i }));
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(
      "x-request-id: abc123\ncontent-type: application/json"
    );
  });

  it("stops saying Copied once the button would copy something else", async () => {
    // The flag used to be a bare boolean, so switching flavour inside the
    // feedback window left "Copied" standing over a control that would now put
    // a different snippet on the clipboard.
    render(<ResponseViewer data={undefined} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /curl/i }));
    expect(screen.queryByRole("button", { name: /copied/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("remembers which flavour was last read", async () => {
    const { unmount } = render(<ResponseViewer data={undefined} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    await userEvent.click(screen.getByRole("tab", { name: /curl/i }));
    unmount();

    render(<ResponseViewer data={undefined} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /code/i }));
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith(code.curl);
  });
});
