CREATE TABLE `agent_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`label` text NOT NULL,
	`secret` text NOT NULL,
	`hint` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`cooldown_until` integer,
	`last_error` text,
	`last_failure_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
