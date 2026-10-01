CREATE TABLE "job_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"ratio" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "max_usage_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "max_usage_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "usage_period_start" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "render_engine" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "source_width" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "source_height" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "source_duration_seconds" real;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "source_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "reserved_seconds" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_outputs" ADD CONSTRAINT "job_outputs_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_outputs_job_id_idx" ON "job_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "video_jobs_user_id_idx" ON "video_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_jobs_status_idx" ON "video_jobs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "video_jobs" DROP COLUMN "storage_path";--> statement-breakpoint
ALTER TABLE "video_jobs" DROP COLUMN "aspect_ratio_output";--> statement-breakpoint
ALTER TABLE "video_jobs" DROP COLUMN "download_url";