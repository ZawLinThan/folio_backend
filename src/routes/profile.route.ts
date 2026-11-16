import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index.js";
import { profiles } from "../db/schema.js";

const router = Router();

const profileName = (metadata: Record<string, unknown>, email?: string) => {
  for (const value of [metadata.full_name, metadata.name, metadata.user_name]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 255);
    }
  }

  return email?.split("@")[0]?.trim().slice(0, 255) || "Student";
};

async function ensureProfile(user: NonNullable<Express.Request["user"]>) {
  await db.insert(profiles).values({
    id: user.id,
    name: profileName(user.user_metadata, user.email),
  }).onConflictDoNothing();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id));
  return profile;
}

router.get("/", async (req, res) => {
  try {
    res.json(await ensureProfile(req.user!));
  } catch {
    res.status(500).json({ error: "Unable to load profile" });
  }
});

const updateSchema = z.strictObject({
  preferredName: z.string().trim().max(255).nullable(),
});

router.patch("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Preferred name must be at most 255 characters" });
    return;
  }

  try {
    await ensureProfile(req.user!);
    const [profile] = await db.update(profiles).set({
      name: parsed.data.preferredName || "Student",
      updatedAt: new Date(),
    }).where(eq(profiles.id, req.user!.id)).returning();
    res.json(profile);
  } catch {
    res.status(500).json({ error: "Unable to save profile" });
  }
});

export default router;
