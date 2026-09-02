import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";
import { MediaService } from "../domains/media/services/media-service";
import { UploadValidator } from "../services/upload-validation";
import { WOFF2_HEADER } from "../services/upload-validation/__tests__/format-fixtures";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn() }));

// Partial: the real ErrorResponse helpers stay, only the gate is driven here.
vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return { ...actual, requirePermission: mocks.requirePermission };
});

vi.mock("../init", () => ({
  getNextly: vi.fn(async () => ({})),
  getCachedNextly: vi.fn(async () => ({})),
}));

vi.mock("../di", async () => {
  const actual = await vi.importActual<typeof import("../di")>("../di");
  return {
    ...actual,
    getService: (key: string) => container.get(key),
  };
});

// Stable user UUID v4 for the form payload (the Zod schema requires
// a strict UUID, so the version+variant bits matter).
const TEST_USER_ID = "00000000-0000-4000-8000-000000000000";

/** The gated mount, which is what a consumer wires up. */
async function mountedHandlers(): Promise<{
  POST: (
    request: Request,
    ctx: { params: Promise<{ path?: string[] }> }
  ) => Promise<Response>;
}> {
  const { createMediaHandlers } = await import("./media-handlers");
  const handlers = createMediaHandlers({ requireAuth: true });
  return {
    POST: (request, ctx) => handlers.POST(request, ctx),
  };
}

/** A POST the mounted route will parse: no `uploadedBy`, which comes from auth. */
function mountedRequest(
  file: Buffer,
  filename: string,
  mimeType: string
): [Request, { params: Promise<{ path?: string[] }> }] {
  const form = new FormData();
  form.append("file", new Blob([file], { type: mimeType }), filename);
  return [
    new Request("http://localhost/api/media", { method: "POST", body: form }),
    { params: Promise.resolve({ path: [] }) },
  ];
}

function makeRequest(
  file: Buffer,
  filename: string,
  mimeType: string
): Request {
  const form = new FormData();
  form.append("file", new Blob([file], { type: mimeType }), filename);
  form.append("uploadedBy", TEST_USER_ID);
  return new Request("http://localhost/api/media", {
    method: "POST",
    body: form,
  });
}

interface StubBundle {
  service: MediaService;
  legacyUploadMedia: ReturnType<typeof vi.fn>;
}

const DEFAULT_LEGACY_RESULT = {
  success: true,
  statusCode: 201,
  data: {
    id: "media-1",
    filename: "ok.png",
    originalFilename: "ok.png",
    mimeType: "image/png",
    size: 8,
    url: "/uploads/ok.png",
    width: null,
    height: null,
    duration: null,
    thumbnailUrl: null,
    focalX: null,
    focalY: null,
    sizes: null,
    altText: null,
    caption: null,
    tags: null,
    folderId: null,
    uploadedBy: TEST_USER_ID,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  },
};

function buildStubBundle(
  opts: { svgCsp?: boolean; legacyResult?: typeof DEFAULT_LEGACY_RESULT } = {}
): StubBundle {
  const legacyUploadMedia = vi
    .fn()
    .mockResolvedValue(opts.legacyResult ?? DEFAULT_LEGACY_RESULT);
  const storage = {
    upload: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getPublicUrl: vi.fn((p: string) => `/uploads/${p}`),
    getType: () => "test",
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const service = new MediaService(
    { uploadMedia: legacyUploadMedia } as never,
    {} as never,
    () => storage as never,
    {} as never,
    new UploadValidator(undefined),
    opts.svgCsp ?? true,
    logger as never
  );

  return { service, legacyUploadMedia };
}

describe("POST /api/media — unified validation pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  it("rejects text/html upload with VALIDATION_ERROR", async () => {
    container.registerSingleton(
      "mediaService",
      () => buildStubBundle().service
    );
    const { POST } = await import("./media");

    const html = Buffer.from(
      "<!doctype html><html><script>alert(1)</script></html>",
      "utf8"
    );
    const res = await POST(makeRequest(html, "evil.html", "text/html"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code?: string;
      error?: { code?: string };
    };
    const code = body.code ?? body.error?.code;
    expect(code).toBe("VALIDATION_ERROR");
  });

  it("rejects .exe regardless of MIME claim", async () => {
    container.registerSingleton(
      "mediaService",
      () => buildStubBundle().service
    );
    const { POST } = await import("./media");

    const res = await POST(
      makeRequest(Buffer.from("MZ"), "trojan.exe", "image/png")
    );
    expect(res.status).toBe(400);
  });

  it("rejects image/svg+xml with PNG bytes (polyglot bypass closed)", async () => {
    container.registerSingleton(
      "mediaService",
      () => buildStubBundle().service
    );
    const { POST } = await import("./media");

    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await POST(makeRequest(PNG, "evil.svg", "image/svg+xml"));
    expect(res.status).toBe(400);
    const body = JSON.stringify(await res.json());
    expect(body).toMatch(/MAGIC_BYTE_MISMATCH/);
  });
});

describe("MediaService.upload — svgCsp honored", () => {
  const legitimateSvg = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`,
    "utf8"
  );

  const context = {
    user: {
      id: TEST_USER_ID,
      email: "u@x",
      role: "user",
      permissions: [],
    },
  } as never;

  it("default (svgCsp: true) → legacy upload receives contentDisposition: 'attachment'", async () => {
    const bundle = buildStubBundle({ svgCsp: true });
    try {
      await bundle.service.upload(
        {
          buffer: legitimateSvg,
          filename: "logo.svg",
          mimeType: "image/svg+xml",
          size: legitimateSvg.length,
        },
        context
      );
    } catch {
      // Success-path response mapping needs NEXT_PUBLIC_APP_URL; the
      // legacy call still fires before that mapping, so the mock
      // captures the args we care about either way.
    }
    expect(bundle.legacyUploadMedia).toHaveBeenCalledOnce();
    const args = bundle.legacyUploadMedia.mock.calls[0]?.[0] as {
      contentDisposition?: string;
    };
    expect(args.contentDisposition).toBe("attachment");
  });

  it("svgCsp: false → legacy upload receives no contentDisposition override", async () => {
    const bundle = buildStubBundle({ svgCsp: false });
    try {
      await bundle.service.upload(
        {
          buffer: legitimateSvg,
          filename: "logo.svg",
          mimeType: "image/svg+xml",
          size: legitimateSvg.length,
        },
        context
      );
    } catch {
      // see above
    }
    expect(bundle.legacyUploadMedia).toHaveBeenCalledOnce();
    const args = bundle.legacyUploadMedia.mock.calls[0]?.[0] as {
      contentDisposition?: string;
    };
    expect(args.contentDisposition).toBeUndefined();
  });
});

/**
 * The font cases run through the MOUNTED handler.
 *
 * `./media` names itself internal and superseded; consumers mount
 * `createMediaHandlers`. Driving these through the superseded module leaves
 * them green if the inference is removed from the handler a site actually
 * serves, which is coverage of a path nobody runs.
 */
describe("POST through the mounted media handlers — font uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.clear();
    mocks.requirePermission.mockResolvedValue({ userId: TEST_USER_ID });
  });

  afterEach(() => {
    container.clear();
  });

  it("accepts a font the browser could not name, as its canonical type", async () => {
    /*
     * The case the extension entry in the admin dropzone exists for. A browser
     * reports an empty `type` for a `.woff2` chosen from disk — fonts are not
     * in every platform's registry — and the upload was then refused for
     * claiming no type at all, whatever the allowlist said. Dropzone let the
     * file through and the server turned it away.
     *
     * Asserted on what reaches STORAGE rather than on a 201, because the
     * response is the same either way once the upload succeeds; what the record
     * carries is the thing that was wrong.
     */
    const bundle = buildStubBundle();
    container.registerSingleton("mediaService", () => bundle.service);
    const { POST } = await mountedHandlers();

    // A WOFF2 header a sniffer identifies, so the case distinguishes a font
    // from anything else renamed to look like one. Text here would pass a
    // validator that trusts whatever it cannot identify, which is the
    // implementation this must fail against.
    const bytes = WOFF2_HEADER;
    const res = await POST(...mountedRequest(bytes, "Inter.woff2", ""));

    expect(res.status).toBe(201);
    // The stored claim, read off the call rather than matched against a whole
    // argument list — the shape around it is not what this case is about.
    const stored = bundle.legacyUploadMedia.mock.calls[0]?.[0] as {
      mimeType?: string;
    };
    expect(stored.mimeType).toBe("font/woff2");
  });

  it("REFUSES content that is not the font it is named as", async () => {
    /*
     * The claim can be inferred from a filename, so nothing but the bytes
     * stands behind it — and the public route serves these types to anonymous
     * callers as immutable, cacheable assets, so a validator trusting
     * whatever it cannot identify accepts arbitrary content under a servable
     * type.
     *
     * Its control is the case above, which fails if font uploads stop working
     * at all; this one fails only when the signature goes unchecked.
     */
    container.registerSingleton(
      "mediaService",
      () => buildStubBundle().service
    );
    const { POST } = await mountedHandlers();

    const res = await POST(
      ...mountedRequest(
        Buffer.from("not-really-a-font", "utf8"),
        "Evil.woff2",
        ""
      )
    );
    expect(res.status).toBe(400);
  });

  it("does NOT invent a type for a name it does not know", async () => {
    /*
     * The control, and the half that matters for safety: this fills in a claim
     * the caller never made, so it must resolve for font names only. A `.bin`
     * with no type stays unnamed and is refused exactly as before — otherwise
     * the inference would be a way to launder anything past the allowlist.
     */
    container.registerSingleton(
      "mediaService",
      () => buildStubBundle().service
    );
    const { POST } = await mountedHandlers();

    const res = await POST(
      ...mountedRequest(Buffer.from("x", "utf8"), "payload.bin", "")
    );
    expect(res.status).not.toBe(201);
  });
});
