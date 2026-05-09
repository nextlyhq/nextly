import { describe, it, expect } from "vitest";

import { createTestDb } from "../../__tests__/fixtures/db";
import { MediaService } from "../media";

describe("MediaService Storage Configuration", () => {
  it("should show current storage backend configuration", () => {
    const { db, schema } = createTestDb();
    const mediaService = new MediaService(db, schema);

    const storageType = mediaService.getStorageType();

    console.log("\n🔍 MediaService Storage Configuration:");
    console.log("=====================================");
    console.log(`Storage Type: ${storageType}\n`);

    switch (storageType) {
      case "local":
        console.log("📁 Local Filesystem Storage");
        console.log("   - Upload Directory: ./public/uploads");
        console.log("   - Public Path: /uploads");
        console.log("   - Files stored on local filesystem");
        console.log("\n💡 To switch storage backends, add to .env:");
        console.log("   - Vercel Blob: BLOB_READ_WRITE_TOKEN=vercel_blob_...");
        console.log("   - AWS S3: S3_BUCKET + AWS_REGION + credentials");
        console.log(
          "   - Cloudflare R2: R2_BUCKET + R2_ACCOUNT_ID + credentials"
        );
        break;

      case "vercel-blob":
        console.log("☁️  Vercel Blob Storage");
        console.log("   - Token configured: ✅");
        console.log("   - Public URLs: https://blob.vercel-storage.com/...");
        break;

      case "s3":
        console.log("☁️  AWS S3 Storage");
        console.log(`   - Bucket: ${process.env.S3_BUCKET}`);
        console.log(`   - Region: ${process.env.AWS_REGION}`);
        break;

      case "r2":
        console.log("☁️  Cloudflare R2 Storage");
        console.log(`   - Bucket: ${process.env.R2_BUCKET}`);
        console.log(`   - Account: ${process.env.R2_ACCOUNT_ID}`);
        break;
    }

    console.log("=====================================\n");

    expect(["local", "vercel-blob", "s3", "r2"]).toContain(storageType);
  });
});
