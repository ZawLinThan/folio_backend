import { Worker } from "bullmq";

import { workerRedis } from "../config/redis.js";
import { Sentry } from "../config/sentry.js";
import { processTestGeneration } from "../services/test-generation.service.js";
import type { TestJob } from "../queue/test.queue.js";

export const testWorker = new Worker<TestJob>(
  "test-generation",

  async (job) => {
    return Sentry.startSpan(
      {
        name: "process-test",
        op: "bullmq.job",
        attributes: { jobId: job.id, testId: job.data.testId },
      },
      async () => {
        return processTestGeneration({ testId: job.data.testId, job });
      },
    );
  },
  { connection: workerRedis, concurrency: 2 },
);

testWorker.on("failed", (job, error) => {
  console.error(`Test job ${job?.id} failed`, error);
});
