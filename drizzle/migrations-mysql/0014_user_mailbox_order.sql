CREATE TABLE `user_mailbox_order` (
	`user_id` varchar(191) NOT NULL,
	`mailbox_ids` longtext NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `user_mailbox_order_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `user_mailbox_order` ADD CONSTRAINT `user_mailbox_order_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
