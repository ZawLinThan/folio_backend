import { pgSchema, uuid } from "drizzle-orm/pg-core";

// Reference only. Supabase Auth owns the physical auth.users table.
export const authUsers = pgSchema("auth").table("users", {
  id: uuid("id").primaryKey(),
});
