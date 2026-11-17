import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.js";
import {
  documents,
  notebooks,
  testContents,
  tests,
  type Test,
} from "../db/schema.js";
import { Sentry } from "../config/sentry.js";
import { testQueue } from "../queue/test.queue.js";
import type { GenerateTestInput } from "../types/studyApi.js";

const uuidSchema = z.uuid();

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const serialiseTest = (test: Test) => ({
  ...test,
  createdAt: test.createdAt.toISOString(),
  updatedAt: test.updatedAt.toISOString(),
});

/**
 * POST /api/tests/generate
 * Verify notebook ownership and ready study notes, persist a queued test, and enqueue generation.
 * GenerateTestInput: { title, notebookId, mode, referenceFileId, referenceUrl }.
 * Respond with 202 Test metadata; fetch generated content after status becomes ready.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const generateTest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  const body = req.body as Partial<GenerateTestInput>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const notebookId =
    typeof body.notebookId === "string" ? body.notebookId.trim() : "";
  const isReferenceMode = body.mode === "reference";
  const isNotebookMode = body.mode === "notebook";

  const referenceFileId =
    typeof body.referenceFileId === "string"
      ? body.referenceFileId.trim()
      : null;
  const referenceUrl =
    typeof body.referenceUrl === "string" ? body.referenceUrl.trim() : null;

  if (
    !title ||
    title.length > 100 ||
    !uuidSchema.safeParse(notebookId).success ||
    (!isReferenceMode && !isNotebookMode)
  ) {
    res.status(400).json({ error: "Invalid test generation request" });

    return;
  }

  if (
    (isNotebookMode && (referenceFileId !== null || referenceUrl !== null)) ||
    (isReferenceMode &&
      (!referenceFileId ||
        !uuidSchema.safeParse(referenceFileId).success ||
        (referenceUrl !== null &&
          (referenceUrl.length > 2_048 || !isHttpUrl(referenceUrl)))))
  ) {
    res.status(400).json({ error: "Invalid reference test details" });

    return;
  }

  try {
    const [notebook] = await db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)))
      .limit(1);

    if (!notebook) {
      res.status(404).json({ error: "Notebook not found" });

      return;
    }

    const studyDocuments = await db
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          eq(documents.notebookId, notebook.id),
          eq(documents.status, "ready"),
        ),
      );

    // A sample test informs format and difficulty, but its answers must never
    // become the study source. Exclude it from the notebook study material.
    const readyStudyDocuments = referenceFileId
      ? studyDocuments.filter((document) => document.id !== referenceFileId)
      : studyDocuments;

    if (!readyStudyDocuments.length) {
      res
        .status(409)
        .json({ error: "No ready study documents in this notebook" });

      return;
    }

    let referenceDocument: { id: string; name: string } | undefined;

    if (isReferenceMode && referenceFileId) {
      [referenceDocument] = await db
        .select({ id: documents.id, name: documents.name })
        .from(documents)
        .where(
          and(
            eq(documents.id, referenceFileId),
            eq(documents.userId, userId),
            eq(documents.notebookId, notebook.id),
            eq(documents.status, "ready"),
          ),
        )
        .limit(1);

      if (!referenceDocument) {
        res.status(404).json({ error: "Reference document not found" });

        return;
      }
    }

    const [queuedTest] = await db
      .insert(tests)
      .values({
        userId,
        title,
        notebookId,
        referenceFileId,
        status: "queued",
      })
      .returning();

    try {
      await testQueue.add(
        "generate-test",
        { testId: queuedTest.id },
        {
          jobId: queuedTest.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (queueError) {
      await db
        .update(tests)
        .set({
          status: "failed",
          errorMessage: "Unable to queue test generation.",
          updatedAt: new Date(),
        })
        .where(eq(tests.id, queuedTest.id));
      throw queueError;
    }

    res.status(202).json(serialiseTest(queuedTest));
  } catch (error) {
    Sentry.captureException(error, {
      tags: { area: "test-generation" },
    });
    res.status(500).json({ error: "Failed to generate test" });
  }
};

/**
 * GET /api/tests
 * List tests belonging to req.user.id.
 * No request body.
 * Respond with 200 Test[]; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getAllTests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  try {
    const ownedTests = await db
      .select()
      .from(tests)
      .where(eq(tests.userId, userId));

    res.status(200).json(ownedTests.map(serialiseTest));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/tests/:id
 * Read owned test metadata.
 * req.params.id.
 * Respond with 200 Test; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getSingleTestById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  const id = uuidSchema.safeParse(req.params.id);

  if (!id.success) {
    res.status(400).json({ error: "Invalid test ID" });

    return;
  }

  try {
    const [test] = await db
      .select()
      .from(tests)
      .where(and(eq(tests.id, id.data), eq(tests.userId, userId)));

    if (!test) {
      res.status(404).json({ error: "Test not found" });

      return;
    }

    res.status(200).json(serialiseTest(test));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/tests/:id/content
 * Read separately stored questions, answers, options, and instructions for an owned test.
 * req.params.id.
 * Respond with 200 TestContent without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getTestContent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  const id = uuidSchema.safeParse(req.params.id);

  if (!id.success) {
    res.status(400).json({ error: "Invalid test ID" });

    return;
  }

  try {
    const [ownedTest] = await db
      .select({ status: tests.status })
      .from(tests)
      .where(and(eq(tests.id, id.data), eq(tests.userId, userId)))
      .limit(1);

    if (!ownedTest) {
      res.status(404).json({ error: "Test not found" });

      return;
    }

    if (ownedTest.status !== "ready") {
      res.status(409).json({ error: "Test content is not ready" });

      return;
    }

    const [content] = await db
      .select({
        testId: testContents.testId,
        instructions: testContents.instructions,
        questions: testContents.questions,
      })
      .from(testContents)
      .innerJoin(tests, eq(tests.id, testContents.testId))
      .where(and(eq(tests.id, id.data), eq(tests.userId, userId)));

    if (!content) {
      res.status(404).json({ error: "Test content not found" });

      return;
    }

    res.status(200).json(content);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /api/tests/:id
 * Delete an owned test and its generated content.
 * req.params.id.
 * Respond with 204 without a body.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const deleteSingleTest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  const id = uuidSchema.safeParse(req.params.id);

  if (!id.success) {
    res.status(400).json({ error: "Invalid test ID" });

    return;
  }

  try {
    const [deleted] = await db
      .delete(tests)
      .where(and(eq(tests.id, id.data), eq(tests.userId, userId)))
      .returning({ id: tests.id });

    if (!deleted) {
      res.status(404).json({ error: "Test not found" });

      return;
    }

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};
