CREATE TABLE `provider_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_usage_provider_day_idx` ON `provider_usage` (`provider`,`day`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `brevo_api_key` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mailjet_config` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `smtp_config` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `provider_limits` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `sending_fallback` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `provider` text;
