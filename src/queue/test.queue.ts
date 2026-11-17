import { Queue } from "bullmq";

import { producerRedis } from "../config/redis.js";

/**
 *
 */
export type TestJob = { testId: string };

export const testQueue = new Queue<TestJob>("test-generation", {
  connection: producerRedis,
});
