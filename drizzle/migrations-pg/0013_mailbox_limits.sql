ALTER TABLE "messages" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
CREATE INDEX "messages_size_bytes_idx" ON "messages" USING btree ("size_bytes");--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "storage_limit_bytes" bigint;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "daily_send_limit" bigint;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_mailbox_storage_limit_bytes" bigint;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_mailbox_daily_send_limit" bigint;
