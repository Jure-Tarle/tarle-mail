CREATE TABLE "provider_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"day" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_usage_provider_day_idx" ON "provider_usage" USING btree ("provider","day");--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "brevo_api_key" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "mailjet_config" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_config" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "provider_limits" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "sending_fallback" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_jobs" ADD COLUMN "provider" text;
