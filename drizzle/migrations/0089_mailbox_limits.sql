ALTER TABLE `messages` ADD `size_bytes` integer;--> statement-breakpoint
CREATE INDEX `messages_size_bytes_idx` ON `messages` (`size_bytes`);--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `storage_limit_bytes` integer;--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `daily_send_limit` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_mailbox_storage_limit_bytes` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_mailbox_daily_send_limit` integer;
