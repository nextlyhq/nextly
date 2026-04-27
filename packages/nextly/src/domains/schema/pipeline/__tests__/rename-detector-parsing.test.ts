import { describe, expect, it } from "vitest";

import {
  parseAddColumn,
  parseDropColumn,
  splitMysqlCombinedStatement,
} from "../rename-detector-parsing.js";

describe("parseDropColumn - postgresql", () => {
  it("parses simple DROP COLUMN", () => {
    const result = parseDropColumn(
      `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
      "postgresql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });

  it('strips schema prefix ("public"."dc_posts")', () => {
    const result = parseDropColumn(
      `ALTER TABLE "public"."dc_posts" DROP COLUMN "title";`,
      "postgresql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });

  it("handles IF EXISTS modifier", () => {
    const result = parseDropColumn(
      `ALTER TABLE "dc_posts" DROP COLUMN IF EXISTS "title";`,
      "postgresql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });

  it("handles reserved-word identifiers", () => {
    const result = parseDropColumn(
      `ALTER TABLE "order" DROP COLUMN "select";`,
      "postgresql"
    );
    expect(result).toEqual({ tableName: "order", columnName: "select" });
  });

  it("returns null for non-DROP statements", () => {
    expect(
      parseDropColumn(
        `ALTER TABLE "dc_posts" ADD COLUMN "x" text;`,
        "postgresql"
      )
    ).toBeNull();
    expect(
      parseDropColumn(`CREATE TABLE "dc_posts" ("id" serial);`, "postgresql")
    ).toBeNull();
  });

  it("tolerates whitespace variations", () => {
    const result = parseDropColumn(
      `ALTER  TABLE   "dc_posts"\n  DROP  COLUMN   "title";`,
      "postgresql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });
});

describe("parseDropColumn - mysql", () => {
  it("parses backtick-quoted DROP COLUMN", () => {
    const result = parseDropColumn(
      "ALTER TABLE `dc_posts` DROP COLUMN `title`;",
      "mysql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });

  it("strips database prefix (`mydb`.`dc_posts`)", () => {
    const result = parseDropColumn(
      "ALTER TABLE `mydb`.`dc_posts` DROP COLUMN `title`;",
      "mysql"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });
});

describe("parseDropColumn - sqlite", () => {
  it("parses double-quoted DROP COLUMN", () => {
    const result = parseDropColumn(
      `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
      "sqlite"
    );
    expect(result).toEqual({ tableName: "dc_posts", columnName: "title" });
  });
});

describe("parseAddColumn - postgresql", () => {
  it("parses simple ADD COLUMN with type", () => {
    const result = parseAddColumn(
      `ALTER TABLE "dc_posts" ADD COLUMN "name" text;`,
      "postgresql"
    );
    expect(result).toEqual({
      tableName: "dc_posts",
      columnName: "name",
      columnType: "text",
    });
  });

  it("captures type with size suffix", () => {
    const result = parseAddColumn(
      `ALTER TABLE "dc_posts" ADD COLUMN "name" varchar(255);`,
      "postgresql"
    );
    expect(result).toEqual({
      tableName: "dc_posts",
      columnName: "name",
      columnType: "varchar(255)",
    });
  });

  it("captures type with NOT NULL DEFAULT modifiers", () => {
    const result = parseAddColumn(
      `ALTER TABLE "dc_posts" ADD COLUMN "name" varchar(50) NOT NULL DEFAULT 'x';`,
      "postgresql"
    );
    expect(result).toEqual({
      tableName: "dc_posts",
      columnName: "name",
      columnType: "varchar(50) NOT NULL DEFAULT 'x'",
    });
  });

  it("handles IF NOT EXISTS modifier", () => {
    const result = parseAddColumn(
      `ALTER TABLE "dc_posts" ADD COLUMN IF NOT EXISTS "name" text;`,
      "postgresql"
    );
    expect(result?.columnName).toBe("name");
  });

  it("strips schema prefix", () => {
    const result = parseAddColumn(
      `ALTER TABLE "public"."dc_posts" ADD COLUMN "name" text;`,
      "postgresql"
    );
    expect(result?.tableName).toBe("dc_posts");
  });

  it("returns null for non-ADD statements", () => {
    expect(
      parseAddColumn(`ALTER TABLE "dc_posts" DROP COLUMN "x";`, "postgresql")
    ).toBeNull();
  });
});

describe("parseAddColumn - mysql", () => {
  it("parses backtick-quoted ADD COLUMN", () => {
    const result = parseAddColumn(
      "ALTER TABLE `dc_posts` ADD COLUMN `name` text;",
      "mysql"
    );
    expect(result).toEqual({
      tableName: "dc_posts",
      columnName: "name",
      columnType: "text",
    });
  });

  it("captures multi-word type without parens", () => {
    const result = parseAddColumn(
      "ALTER TABLE `dc_posts` ADD COLUMN `n` int unsigned;",
      "mysql"
    );
    expect(result?.columnType).toBe("int unsigned");
  });
});

describe("parseAddColumn - sqlite", () => {
  it("parses double-quoted ADD COLUMN", () => {
    const result = parseAddColumn(
      `ALTER TABLE "dc_posts" ADD COLUMN "name" text;`,
      "sqlite"
    );
    expect(result).toEqual({
      tableName: "dc_posts",
      columnName: "name",
      columnType: "text",
    });
  });
});

describe("splitMysqlCombinedStatement", () => {
  it("returns single-element array when statement has no top-level comma", () => {
    expect(
      splitMysqlCombinedStatement("ALTER TABLE `t` DROP COLUMN `a`")
    ).toEqual(["ALTER TABLE `t` DROP COLUMN `a`"]);
  });

  it("splits DROP+ADD combined statement", () => {
    const result = splitMysqlCombinedStatement(
      "ALTER TABLE `t` DROP COLUMN `a`, ADD COLUMN `b` int"
    );
    expect(result).toEqual([
      "ALTER TABLE `t` DROP COLUMN `a`",
      "ALTER TABLE `t` ADD COLUMN `b` int",
    ]);
  });

  it("paren-aware: keeps numeric(10,2) intact", () => {
    const result = splitMysqlCombinedStatement(
      "ALTER TABLE `t` ADD COLUMN `a` numeric(10,2) DEFAULT 0, DROP COLUMN `b`"
    );
    expect(result).toEqual([
      "ALTER TABLE `t` ADD COLUMN `a` numeric(10,2) DEFAULT 0",
      "ALTER TABLE `t` DROP COLUMN `b`",
    ]);
  });

  it("string-literal-aware: keeps enum('a','b','c') intact", () => {
    const result = splitMysqlCombinedStatement(
      "ALTER TABLE `t` ADD COLUMN `a` enum('x','y','z') DEFAULT 'x', DROP COLUMN `b`"
    );
    expect(result).toEqual([
      "ALTER TABLE `t` ADD COLUMN `a` enum('x','y','z') DEFAULT 'x'",
      "ALTER TABLE `t` DROP COLUMN `b`",
    ]);
  });

  it("does not split commas inside string literal DEFAULT", () => {
    const result = splitMysqlCombinedStatement(
      "ALTER TABLE `t` ADD COLUMN `a` varchar(255) DEFAULT 'a,b,c'"
    );
    expect(result).toEqual([
      "ALTER TABLE `t` ADD COLUMN `a` varchar(255) DEFAULT 'a,b,c'",
    ]);
  });

  it("handles 3-way combined statement", () => {
    const result = splitMysqlCombinedStatement(
      "ALTER TABLE `t` DROP COLUMN `a`, DROP COLUMN `b`, ADD COLUMN `c` int"
    );
    expect(result).toEqual([
      "ALTER TABLE `t` DROP COLUMN `a`",
      "ALTER TABLE `t` DROP COLUMN `b`",
      "ALTER TABLE `t` ADD COLUMN `c` int",
    ]);
  });

  it("returns input unchanged for non-ALTER TABLE statements", () => {
    expect(splitMysqlCombinedStatement("CREATE TABLE `t` (`a` int)")).toEqual([
      "CREATE TABLE `t` (`a` int)",
    ]);
  });
});
