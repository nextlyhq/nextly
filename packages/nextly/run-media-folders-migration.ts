import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { config } from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables
config({ path: resolve(__dirname, "../../.env") });

const { Pool } = pg;

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();

    // Check if table exists
    const checkResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'media_folders'
      );
    `);

    if (checkResult.rows[0].exists) {
      console.log("✅ media_folders table already exists!");
      client.release();
      return;
    }

    // Read the migration file
    const migrationSQL = readFileSync(
      resolve(
        __dirname,
        "src/database/migrations/postgresql/0005_media_folders.sql"
      ),
      "utf-8"
    );

    console.log("Running media_folders migration...");
    await client.query(migrationSQL);
    console.log("✅ Migration completed successfully!");

    client.release();
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration();
