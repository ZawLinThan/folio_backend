import { Queue } from "bullmq";

import { producerRedis } from "../config/redis.js";

/** Payload for a test generation job. */
export type TestJob = { testId: string };

export const testQueue = new Queue<TestJob>("test-generation", {
  connection: producerRedis,
});
