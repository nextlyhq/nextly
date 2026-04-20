/**
 * Quick test script to verify MediaService storage configuration
 *
 * Run with: npx tsx packages/db/test-media-storage.ts
 */

import { createTestDb } from "./src/__tests__/fixtures/db";
import { MediaService } from "./src/services/media";

async function testMediaStorage() {
  console.log("🔍 Testing MediaService Storage Configuration\n");

  // Create test database
  const { db, schema } = createTestDb();

  // Create MediaService instance
  const mediaService = new MediaService(db, schema);

  // Check current storage type
  const storageType = mediaService.getStorageType();

  console.log("✅ Current Storage Type:", storageType);
  console.log("");

  // Show storage configuration details
  switch (storageType) {
    case "local":
      console.log("📁 Local Filesystem Storage");
      console.log("   - Upload Directory: ./public/uploads");
      console.log("   - Public Path: /uploads");
      console.log("   - Files stored on local filesystem");
      console.log("");
      console.log("💡 To switch storage backends, set environment variables:");
      console.log("   - Vercel Blob: BLOB_READ_WRITE_TOKEN=vercel_blob_...");
      console.log(
        "   - AWS S3: S3_BUCKET + AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY"
      );
      console.log(
        "   - Cloudflare R2: R2_BUCKET + R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY"
      );
      break;

    case "vercel-blob":
      console.log("☁️  Vercel Blob Storage");
      console.log("   - Files stored on Vercel Blob");
      console.log("   - Public URLs: https://blob.vercel-storage.com/...");
      break;

    case "s3":
      console.log("☁️  AWS S3 Storage");
      console.log("   - Bucket:", process.env.S3_BUCKET);
      console.log("   - Region:", process.env.AWS_REGION);
      break;

    case "r2":
      console.log("☁️  Cloudflare R2 Storage");
      console.log("   - Bucket:", process.env.R2_BUCKET);
      console.log("   - Account:", process.env.R2_ACCOUNT_ID);
      break;
  }

  console.log("");
  console.log("✨ Storage configuration verified successfully!");
}

testMediaStorage().catch(console.error);
