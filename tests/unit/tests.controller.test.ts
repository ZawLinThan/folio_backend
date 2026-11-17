import type { Request, Response } from "express";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn() },
}));

jest.mock("../../src/queue/test.queue.js", () => ({
  testQueue: { add: jest.fn() },
}));

jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));

import { generateTest } from "../../src/controllers/tests.controller.js";
import { testQueue } from "../../src/queue/test.queue.js";
import { db } from "../../src/db/index.js";

const select = jest.mocked(db.select);
const insert = jest.mocked(db.insert);
const update = jest.mocked(db.update);
const enqueue = jest.mocked(testQueue.add);
const userId = "8918a4e1-dcd7-4dc6-948d-1e42e5e96e8d";
const notebookId = "a907a6e4-7965-4d45-86f9-1c9fac5ec196";
const documentId = "c7c0dfc8-d6c2-4c92-83b5-c6d7c2db0f8c";
const testId = "43210c09-a35e-4ad7-8b9f-e44d90a42f54";

const body = () => ({
  title: "Practice test",
  notebookId,
  mode: "notebook",
  referenceFileId: null,
  referenceUrl: null,
});

const request = (authenticated = true): Request =>
  ({
    body: body(),
    user: authenticated ? { id: userId } : undefined,
  }) as Request;

const response = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }) as unknown as Response;

const selectNotebook = (rows: unknown[]) => ({
  from: jest.fn(() => ({
    where: jest.fn(() => ({
      limit: jest.fn().mockResolvedValue(rows as never),
    })),
  })),
});

const selectDocuments = (rows: unknown[]) => ({
  from: jest.fn(() => ({ where: jest.fn().mockResolvedValue(rows as never) })),
});

beforeEach(() => {
  jest.clearAllMocks();
});

it("rejects unauthenticated callers before accessing the database", async () => {
  const res = response();

  await generateTest(request(false), res);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(select).not.toHaveBeenCalled();
});

it("does not reveal a notebook owned by another user", async () => {
  select.mockReturnValueOnce(selectNotebook([]) as never);
  const res = response();

  await generateTest(request(), res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(enqueue).not.toHaveBeenCalled();
});

it("requires a ready study document", async () => {
  select
    .mockReturnValueOnce(selectNotebook([{ id: notebookId }]) as never)
    .mockReturnValueOnce(selectDocuments([]) as never);
  const res = response();

  await generateTest(request(), res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(enqueue).not.toHaveBeenCalled();
});

it("persists a queued test and enqueues its ID", async () => {
  select
    .mockReturnValueOnce(selectNotebook([{ id: notebookId }]) as never)
    .mockReturnValueOnce(
      selectDocuments([{ id: documentId, name: "Study notes" }]) as never,
    );
  const saved = {
    id: testId,
    userId,
    notebookId,
    title: "Practice test",
    referenceFileId: null,
    status: "queued",
    errorMessage: null,
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
    updatedAt: new Date("2026-10-20T12:00:00.000Z"),
  };
  const values = jest.fn(() => ({
    returning: jest.fn().mockResolvedValue([saved] as never),
  }));
  insert.mockReturnValueOnce({ values } as never);
  const res = response();

  await generateTest(request(), res);

  expect(values).toHaveBeenCalledWith(
    expect.objectContaining({ userId, notebookId, status: "queued" }),
  );
  expect(enqueue).toHaveBeenCalledWith(
    "generate-test",
    { testId },
    expect.objectContaining({ jobId: testId, attempts: 3 }),
  );
  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ id: testId, status: "queued" }),
  );
});

it("marks a saved test failed when enqueueing fails", async () => {
  select
    .mockReturnValueOnce(selectNotebook([{ id: notebookId }]) as never)
    .mockReturnValueOnce(
      selectDocuments([{ id: documentId, name: "Study notes" }]) as never,
    );
  insert.mockReturnValueOnce({
    values: jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([{ id: testId }] as never),
    })),
  } as never);
  enqueue.mockRejectedValueOnce(new Error("Redis unavailable") as never);
  update.mockReturnValueOnce({
    set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([] as never) })),
  } as never);
  const res = response();

  await generateTest(request(), res);

  expect(update).toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(500);
});
