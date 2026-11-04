CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `deferred_push` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notify_prefs` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `quiet_hours` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegram_chat_id` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegram_link_code` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `telegram_link_expires_at` integer;