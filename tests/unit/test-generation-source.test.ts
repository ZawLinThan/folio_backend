import { expect, it, jest } from "@jest/globals";

jest.mock("../../src/config/openRouterAI.js", () => ({
  chatStructured: jest.fn(),
}));

import { compactTestSource } from "../../src/services/test-generation.service.js";

it("removes only exact overlap from adjacent chunks in one document", () => {
  const result = compactTestSource(
    [
      {
        documentId: "a",
        documentName: "Notes",
        chunkIndex: 0,
        content: "First topic. Shared boundary text.",
      },
      {
        documentId: "a",
        documentName: "Notes",
        chunkIndex: 1,
        content: "Shared boundary text. Second topic.",
      },
      {
        documentId: "b",
        documentName: "Other",
        chunkIndex: 0,
        content: "Shared boundary text. Different document.",
      },
    ],
    1000,
  );

  expect(result.match(/Shared boundary text\./g)).toHaveLength(2);
  expect(result).toContain("Second topic.");
  expect(result).toContain("Different document.");
});

it("respects the model context limit after removing overlap", () => {
  const result = compactTestSource(
    [
      {
        documentId: "a",
        documentName: "Notes",
        chunkIndex: 0,
        content: "A".repeat(100),
      },
      {
        documentId: "a",
        documentName: "Notes",
        chunkIndex: 1,
        content: "B".repeat(100),
      },
    ],
    60,
  );

  expect(result.length).toBeLessThanOrEqual(60);
});
