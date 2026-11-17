CREATE TABLE `user_mailbox_order` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mailbox_ids` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
