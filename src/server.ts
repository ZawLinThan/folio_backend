import "./config/sentry.js";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import { env } from "./config/env.js";
import notebooksRouter from "./routes/notebooks.route.js";
import documentsRouter from "./routes/documents.route.js";
import chatRouter from "./routes/chat.route.js";
import flashcardsRouter from "./routes/flashcards.route.js";
import coursesRouter from "./routes/courses.route.js";
import testsRouter from "./routes/tests.route.js";
import profileRouter from "./routes/profile.route.js";
import { protectRoute } from "./middleware/protectRoute.js";

const app = express();
const port = 3000;

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({ message: "Server is running" });
});

app.use("/api/notebooks", protectRoute, notebooksRouter);
app.use("/api/documents", protectRoute, documentsRouter);
app.use("/api/chat", protectRoute, chatRouter);
app.use("/api/flashcards", protectRoute, flashcardsRouter);
app.use("/api/tests", protectRoute, testsRouter);
app.use("/api/courses", protectRoute, coursesRouter);
app.use("/api/profile", protectRoute, profileRouter);

Sentry.setupExpressErrorHandler(app);

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  },
);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default app;
