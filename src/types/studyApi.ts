/** Lifecycle of a document from upload through ingestion. */
export type DocumentStatus =
  "pending" | "queued" | "processing" | "ready" | "failed";

/** Backend JSON contracts; maintained independently from frontend types.
 * Timestamps are serialized ISO strings, unlike database Date values. */
export type Course = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  semester: string | null;
  createdAt: string;
  updatedAt: string;
};
/** A notebook that groups study documents, optionally within a course. */
export type NoteBook = {
  id: string;
  userId: string;
  noteBookName: string;
  courseId: string | null;
};
/** A stored document and its ingestion state. */
export type Document = {
  id: string;
  userId: string;
  name: string;
  originalName: string;
  r2Key: string;
  fileType: string;
  fileSize: number;
  hasMathFormula: boolean;
  status: DocumentStatus;
  errorMessage: string | null;
  courseId: string | null;
  notebookId: string | null;
  createdAt: string;
  updatedAt: string;
};
/** A collection of flashcards, optionally linked to a document and course. */
export type FlashcardSet = {
  id: string;
  userId: string;
  documentId: string | null;
  title: string;
  courseId: string | null;
  createdAt: string;
  updatedAt: string;
};
/** A flashcard with its spaced-repetition scheduling state. */
export type Flashcard = {
  id: string;
  setId: string;
  front: string;
  back: string;
  sourceChunkId: string | null;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
};
/** Test generation metadata; question content is fetched separately. */
export type Test = {
  id: string;
  userId: string;
  title: string | null;
  notebookId: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  referenceFileId: string | null;
  createdAt: string;
  updatedAt: string;
};
/** Exact shape declared in backend/src/types/index.ts. */
export type SuccessfulPresignedUrlResponse = {
  uploadUrl: string;
  key: string;
  expiresIn: number;
};
/** Standard error payload returned by the API. */
export type ApiError = { error: string };
/** Request body for creating a course. */
export type CreateCourseInput = Pick<Course, "name" | "code" | "semester">;
/** Request body for creating a notebook. */
export type CreateNotebookInput = Pick<NoteBook, "noteBookName"> & {
  courseId: string;
};
/** Request body for creating a flashcard set. */
export type CreateSetInput = Pick<FlashcardSet, "title"> & {
  courseId: string | null;
};
/** Request body for creating or updating a flashcard. */
export type CardInput = Pick<Flashcard, "front" | "back">;
/** Request for POST /api/flashcards/generate. */
export type GenerateFlashcardsInput = CreateSetInput & {
  documentId: string;
  count: number;
};
/** Request for POST /api/tests/generate. */
export type GenerateTestInput = {
  title: string;
  notebookId: string;
  mode: "notebook" | "reference";
  referenceFileId: string | null;
  referenceUrl: string | null;
};
/** Generated question content, persisted separately from Test metadata. */
export type TestQuestion = {
  id: string;
  prompt: string;
  answer: string;
  options: string[];
};
/** Generated test content: instructions and questions for a test. */
export type TestContent = {
  testId: string;
  instructions: string;
  questions: TestQuestion[];
};
