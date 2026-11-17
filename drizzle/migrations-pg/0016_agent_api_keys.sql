CREATE TABLE "agent_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"label" text NOT NULL,
	"secret" text NOT NULL,
	"hint" text NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"cooldown_until" bigint,
	"last_error" text,
	"last_failure_at" bigint,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL
);
