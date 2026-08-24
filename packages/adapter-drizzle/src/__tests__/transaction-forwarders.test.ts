import { describe, it, expect, vi } from "vitest";

import {
  createTransactionForwarders,
  type TransactionCrudDelegator,
} from "../transaction-forwarders";
import type {
  DeleteOptions,
  SelectOptions,
  UpdateOptions,
  UpsertOptions,
  WhereClause,
} from "../types";

describe("createTransactionForwarders", () => {
  it("forwards select with the transaction executor", async () => {
    const mockExecutor = { name: "tx-executor" };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn().mockResolvedValue([{ id: "1" }]),
      selectOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );
    const options: SelectOptions = { limit: 10, offset: 5 };

    const result = await forwarders.select("users", options);

    expect(result).toEqual([{ id: "1" }]);
    expect(mockDelegator.select).toHaveBeenCalledTimes(1);
    expect(mockDelegator.select).toHaveBeenCalledWith(
      "users",
      options,
      mockExecutor
    );
  });

  it("forwards selectOne with the transaction executor", async () => {
    const mockExecutor = { name: "tx-executor" };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn(),
      selectOne: vi.fn().mockResolvedValue({ id: "1", name: "Alice" }),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );
    const options: SelectOptions = { forUpdate: true };

    const result = await forwarders.selectOne("users", options);

    expect(result).toEqual({ id: "1", name: "Alice" });
    expect(mockDelegator.selectOne).toHaveBeenCalledTimes(1);
    expect(mockDelegator.selectOne).toHaveBeenCalledWith(
      "users",
      options,
      mockExecutor
    );
  });

  it("forwards update with the transaction executor", async () => {
    const mockExecutor = { name: "tx-executor" };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn(),
      selectOne: vi.fn(),
      update: vi.fn().mockResolvedValue([{ id: "1", name: "Bob" }]),
      delete: vi.fn(),
      upsert: vi.fn(),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );
    const data = { name: "Bob" };
    const where: WhereClause = {
      and: [{ column: "id", op: "=", value: "1" }],
    };
    const options: UpdateOptions = { returning: ["id", "name"] };

    const result = await forwarders.update("users", data, where, options);

    expect(result).toEqual([{ id: "1", name: "Bob" }]);
    expect(mockDelegator.update).toHaveBeenCalledTimes(1);
    expect(mockDelegator.update).toHaveBeenCalledWith(
      "users",
      data,
      where,
      options,
      mockExecutor
    );
  });

  it("forwards delete with the transaction executor", async () => {
    const mockExecutor = { name: "tx-executor" };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn(),
      selectOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(1),
      upsert: vi.fn(),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );
    const where: WhereClause = {
      and: [{ column: "id", op: "=", value: "1" }],
    };
    const options: DeleteOptions = {};

    const result = await forwarders.delete("users", where, options);

    expect(result).toBe(1);
    expect(mockDelegator.delete).toHaveBeenCalledTimes(1);
    expect(mockDelegator.delete).toHaveBeenCalledWith(
      "users",
      where,
      options,
      mockExecutor
    );
  });

  it("forwards upsert with the transaction executor", async () => {
    const mockExecutor = { name: "tx-executor" };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn(),
      selectOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: "1", email: "test@example.com" }),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );
    const data = { email: "test@example.com" };
    const options: UpsertOptions = { conflictColumns: ["email"] };

    const result = await forwarders.upsert("users", data, options);

    expect(result).toEqual({ id: "1", email: "test@example.com" });
    expect(mockDelegator.upsert).toHaveBeenCalledTimes(1);
    expect(mockDelegator.upsert).toHaveBeenCalledWith(
      "users",
      data,
      options,
      mockExecutor
    );
  });

  it("returns the transaction-bound Drizzle instance from getDrizzle", () => {
    const mockExecutor = { name: "tx-executor", select: vi.fn() };
    const mockDelegator: TransactionCrudDelegator = {
      select: vi.fn(),
      selectOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    };

    const forwarders = createTransactionForwarders(
      mockDelegator,
      () => mockExecutor
    );

    const drizzleInstance = forwarders.getDrizzle();
    expect(drizzleInstance).toBe(mockExecutor);
  });
});
