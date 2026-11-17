CREATE TABLE `agent_api_keys` (
	`id` varchar(191) NOT NULL,
	`base_url` longtext NOT NULL,
	`label` longtext NOT NULL,
	`secret` longtext NOT NULL,
	`hint` longtext NOT NULL,
	`position` bigint NOT NULL DEFAULT 0,
	`disabled` boolean NOT NULL DEFAULT false,
	`cooldown_until` bigint,
	`last_error` longtext,
	`last_failure_at` bigint,
	`last_used_at` bigint,
	`created_at` bigint NOT NULL,
	CONSTRAINT `agent_api_keys_id` PRIMARY KEY(`id`)
);
