CREATE TABLE "user_mailbox_order" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mailbox_ids" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_mailbox_order" ADD CONSTRAINT "user_mailbox_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
