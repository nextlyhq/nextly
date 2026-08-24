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
    // That the row exists and reads as empty. jsdom computes no layout, so
    // whether the row keeps its width once the values arrive is measured in
    // e2e/tests/api-playground-metrics.spec.ts, not here.
    expect(screen.getByTestId("response-meta")).toHaveTextContent("—");
  });

  it("treats a completed empty body as a response, not as nothing sent", () => {
    // A 204 is a correct outcome, not an absence to keep waiting on. Deriving
    // "is there a response" from the body alone told a reader to send a request
    // that had already come back, with its headers sitting unread.
    render(<ResponseViewer data={undefined} code={code} status={204} />);

    expect(screen.getByText("No content")).toBeInTheDocument();
    expect(screen.queryByText("No response yet")).toBeNull();
    expect(
      screen.getByText(/returned 204 with an empty body/)
    ).toBeInTheDocument();
  });

  it("tells the headers tab the response arrived, even with no body", async () => {
    // Asserts on the HEADERS message specifically, because that is what
    // `hasResponse` decides. The body-tab assertions above read `status`
    // directly and stay green whatever `hasResponse` does -- so on their own
    // they cover the empty-state copy and not the bug.
    render(<ResponseViewer data={undefined} code={code} status={204} />);
    await userEvent.click(screen.getByRole("tab", { name: /headers/i }));

    expect(
      screen.getByText("This response carried no headers.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Send the request to see its response headers.")
    ).toBeNull();
  });

  it("still tells the headers tab to send, before the first request", async () => {
    // The control: an implementation hardcoding the arrived-message passes the
    // test above and is wrong every time somebody opens the page.
    render(<ResponseViewer data={undefined} code={code} />);
    await userEvent.click(screen.getByRole("tab", { name: /headers/i }));

    expect(
      screen.getByText("Send the request to see its response headers.")
    ).toBeInTheDocument();
  });

  it("still says nothing was sent before the first request", () => {
    // The control for the test above: without it, an implementation that always
    // says "No content" passes that one and is wrong in the commoner case.
    render(<ResponseViewer data={undefined} code={code} />);

    expect(screen.getByText("No response yet")).toBeInTheDocument();
    expect(screen.queryByText("No content")).toBeNull();
  });

  it("keeps the size within the width the row reserves", () => {
    // `formatBytes` had no gigabyte arm, so megabytes counted up forever and a
    // multi-gigabyte reply rendered wider than any reservation could cover.
    render(
      <ResponseViewer
        data={{ items: [] }}
        code={code}
        status={200}
        size={5 * 1024 * 1024 * 1024}
      />
    );

    const meta = screen.getByTestId("response-meta");
    expect(meta).toHaveTextContent("5.00 GB");
    // 10ch is what the row reserves; the widest bounded form must fit it.
    expect("1023.99 GB".length).toBeLessThanOrEqual(10);
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
