ALTER TABLE "tests" ADD COLUMN "notebook_id" uuid;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE set null ON UPDATE no action;