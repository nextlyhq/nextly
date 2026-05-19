import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";
import { MediaService } from "../domains/media/services/media-service";
import { UploadValidator } from "../services/upload-validation";

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
