CREATE TABLE `provider_usage` (
	`id` varchar(191) NOT NULL,
	`provider` varchar(191) NOT NULL,
	`day` varchar(191) NOT NULL,
	`count` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `provider_usage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `provider_usage_provider_day_idx` ON `provider_usage` (`provider`,`day`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `brevo_api_key` longtext;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mailjet_config` longtext;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `smtp_config` longtext;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `provider_limits` longtext;--> statement-breakpoint
ALTER TABLE `domains` ADD `sending_fallback` longtext DEFAULT ('[]') NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_jobs` ADD `provider` longtext;
