import type { Job } from "bullmq";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));

jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock("../../src/config/openRouterAI.js", () => ({
  chatStructured: jest.fn(),
}));

import { db } from "../../src/db/index.js";
import { processTestGeneration } from "../../src/services/test-generation.service.js";
import type { TestJob } from "../../src/queue/test.queue.js";

const select = jest.mocked(db.select);
const update = jest.mocked(db.update);
const testId = "43210c09-a35e-4ad7-8b9f-e44d90a42f54";
const job = (attemptsMade: number) =>
  ({
    attemptsMade,
    opts: { attempts: 3 },
    updateProgress: jest.fn(),
  }) as unknown as Job<TestJob>;

beforeEach(() => {
  jest.clearAllMocks();
});

it("does not generate a test that is already ready", async () => {
  select.mockReturnValueOnce({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn().mockResolvedValue([{ status: "ready" }] as never),
      })),
    })),
  } as never);

  await processTestGeneration({ testId, job: job(0) });

  expect(update).not.toHaveBeenCalled();
});

it("marks a permanently failing test as failed on the last attempt", async () => {
  select.mockReturnValueOnce({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest
          .fn()
          .mockResolvedValue([{ status: "queued", notebookId: null }] as never),
      })),
    })),
  } as never);
  const set = jest.fn(() => ({
    where: jest.fn().mockResolvedValue([] as never),
  }));
  update.mockReturnValueOnce({ set } as never);

  await expect(processTestGeneration({ testId, job: job(2) })).rejects.toThrow(
    "Test notebook is unavailable",
  );

  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
});

it("keeps a retryable failure queued until BullMQ retries it", async () => {
  select.mockReturnValueOnce({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest
          .fn()
          .mockResolvedValue([{ status: "queued", notebookId: null }] as never),
      })),
    })),
  } as never);

  await expect(processTestGeneration({ testId, job: job(0) })).rejects.toThrow(
    "Test notebook is unavailable",
  );

  expect(update).not.toHaveBeenCalled();
});
