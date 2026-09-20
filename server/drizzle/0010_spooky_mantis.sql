ALTER TABLE `user_file_state` ADD `next_review_at` integer;--> statement-breakpoint
ALTER TABLE `user_file_state` ADD `review_interval_days` integer DEFAULT 0 NOT NULL;