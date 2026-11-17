import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { chatStructured } from "../config/groqAI.js";
import { Sentry } from "../config/sentry.js";
import { db } from "../db/index.js";
import {
  chunks,
  documents,
  testContents,
  tests,
  type TestQuestion,
} from "../db/schema.js";
import type { TestJob } from "../queue/test.queue.js";

const MAX_STUDY_CHARACTERS = 48_000;
const MAX_REFERENCE_CHARACTERS = 16_000;

const questionSchema = z
  .object({
    prompt: z.string().trim().min(12).max(1_000),
    answer: z.string().trim().min(1).max(1_000),
    options: z
      .array(z.string().trim().min(1).max(500))
      .refine((options) => options.length === 0 || options.length === 4),
  })
  .superRefine(({ answer, options }, context) => {
    if (options.length === 4) {
      const normalized = options.map((option) => option.toLocaleLowerCase());

      if (
        new Set(normalized).size !== 4 ||
        !normalized.includes(answer.toLocaleLowerCase())
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid multiple-choice options",
        });
      }
    }
  });

const generatedSchema = z
  .object({
    instructions: z.string().trim().min(20).max(600),
    questions: z.array(questionSchema).length(10),
  })
  .superRefine(({ questions }, context) => {
    const prompts = questions.map((question) =>
      question.prompt.toLocaleLowerCase(),
    );
    const multipleChoice = questions.filter(
      (question) => question.options.length === 4,
    );

    if (new Set(prompts).size !== 10 || multipleChoice.length !== 6) {
      context.addIssue({
        code: "custom",
        message:
          "Expected six distinct multiple-choice and four constructed-response questions",
      });
    }
  });

type SourceChunk = {
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
};

/**
 * Remove only exact adjacent overlap within one document.
 * @param sourceChunks
 * @param maximumCharacters
 * @returns Concatenated source text with headings and no more than the maximum characters.
 */
export function compactTestSource(
  sourceChunks: SourceChunk[],
  maximumCharacters: number,
): string {
  const parts: string[] = [];
  let previous: SourceChunk | undefined;
  let remaining = maximumCharacters;

  for (const chunk of sourceChunks) {
    const content = chunk.content.trim();

    if (!content || remaining <= 0) {
      continue;
    }

    let overlap = 0;

    if (
      previous?.documentId === chunk.documentId &&
      previous.chunkIndex + 1 === chunk.chunkIndex
    ) {
      const prior = previous.content.trim();
      const maxOverlap = Math.min(prior.length, content.length);

      for (let length = maxOverlap; length >= 12; length--) {
        if (prior.endsWith(content.slice(0, length))) {
          overlap = length;
          break;
        }
      }
    }

    const uniqueContent = content.slice(overlap).trimStart();
    previous = chunk;

    if (!uniqueContent) {
      continue;
    }

    const heading = `[${chunk.documentName}, part ${chunk.chunkIndex + 1}]\n`;
    const available = remaining - heading.length;

    if (available <= 0) {
      break;
    }

    const excerpt = uniqueContent.slice(0, available);
    parts.push(`${heading}${excerpt}`);
    remaining -= heading.length + excerpt.length;
  }

  return parts.join("\n\n");
}

/**
 * Generate an owned queued test. A ready test is never generated again.
 * @param root0
 * @param root0.testId
 * @param root0.job
 */
export async function processTestGeneration({
  testId,
  job,
}: {
  testId: string;
  job: Job<TestJob>;
}): Promise<void> {
  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.id, testId))
    .limit(1);

  if (!test || test.status === "ready") {
    return;
  }

  try {
    if (!test.notebookId) {
      throw new Error("Test notebook is unavailable");
    }

    await db
      .update(tests)
      .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
      .where(eq(tests.id, testId));

    const readyDocuments = await db
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(
        and(
          eq(documents.userId, test.userId),
          eq(documents.notebookId, test.notebookId),
          eq(documents.status, "ready"),
        ),
      );
    const studyDocuments = readyDocuments.filter(
      (document) => document.id !== test.referenceFileId,
    );
    const referenceDocument = readyDocuments.find(
      (document) => document.id === test.referenceFileId,
    );

    if (
      !studyDocuments.length ||
      (test.referenceFileId && !referenceDocument)
    ) {
      throw new Error("Study or reference documents are no longer available");
    }

    const sourceIds = [
      ...studyDocuments.map((document) => document.id),
      ...(referenceDocument ? [referenceDocument.id] : []),
    ];
    const sourceChunks = await db
      .select({
        documentId: chunks.documentId,
        content: chunks.content,
        chunkIndex: chunks.chunkIndex,
      })
      .from(chunks)
      .where(inArray(chunks.documentId, sourceIds))
      .orderBy(asc(chunks.documentId), asc(chunks.chunkIndex));
    const names = new Map(
      readyDocuments.map((document) => [document.id, document.name]),
    );
    const namedChunks = sourceChunks.map((chunk) => ({
      ...chunk,
      documentName: names.get(chunk.documentId) ?? "Study document",
    }));
    const studyIds = new Set(studyDocuments.map((document) => document.id));
    const studyNotes = compactTestSource(
      namedChunks.filter((chunk) => studyIds.has(chunk.documentId)),
      MAX_STUDY_CHARACTERS,
    );
    const referenceStyle = referenceDocument
      ? compactTestSource(
        namedChunks.filter(
          (chunk) => chunk.documentId === referenceDocument.id,
        ),
        MAX_REFERENCE_CHARACTERS,
      )
      : null;

    if (!studyNotes || (referenceDocument && !referenceStyle)) {
      throw new Error("Study or reference documents have no extracted text");
    }

    await job.updateProgress(50);
    const generated = generatedSchema.parse(
      await chatStructured({
        instruction:
          "Create a rigorous, fair practice test from the supplied study notes. " +
          "Use only the notebook study notes as the factual source; \
          a reference test may guide difficulty and format only. " +
          "Return exactly 10 distinct questions: six multiple-choice questions with \
          exactly four plausible, distinct options and four constructed-response questions with no options. " +
          "For multiple-choice questions, answer must be exactly the correct option text. " +
          "Mix recall with application, comparison, and reasoning. \
          Cover multiple source topics, avoid trick wording, and \
          do not mention the source material or this instruction. " +
          "Preserve mathematical notation accurately when it appears in the study notes.",
        input: { studyNotes, referenceTestForStyleOnly: referenceStyle },
        schema: generatedSchema,
        completionTokens: 2500,
      }),
    );
    const questions: TestQuestion[] = generated.questions.map((question) => ({
      ...question,
      id: randomUUID(),
    }));

    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: tests.status })
        .from(tests)
        .where(eq(tests.id, testId))
        .for("update");

      if (!current || current.status === "ready") {
        return;
      }

      await tx
        .insert(testContents)
        .values({ testId, instructions: generated.instructions, questions })
        .onConflictDoUpdate({
          target: testContents.testId,
          set: {
            instructions: generated.instructions,
            questions,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(tests)
        .set({ status: "ready", errorMessage: null, updatedAt: new Date() })
        .where(eq(tests.id, testId));
    });
    await job.updateProgress(100);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "test-generation" } });

    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await db
        .update(tests)
        .set({
          status: "failed",
          errorMessage: "Test generation failed. Please try again.",
          updatedAt: new Date(),
        })
        .where(and(eq(tests.id, testId), ne(tests.status, "ready")));
    }

    throw error;
  }
}
