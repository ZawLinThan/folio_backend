import { env } from "./src/config/env.js";
import { defineConfig } from "drizzle-kit";

if (!env) {
  throw new Error("env.ts is not defined or failed to load. Please check your environment configuration.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
