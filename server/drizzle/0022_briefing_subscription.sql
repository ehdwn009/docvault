ALTER TABLE `briefing_runs` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `deadline_at` integer;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `remote_started_at` integer;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `dropped_items` text;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `generator` text;--> statement-breakpoint
CREATE UNIQUE INDEX `briefing_runs_job_id_unique` ON `briefing_runs` (`job_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_mode` text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_token_hash` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_token_prefix` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_token_created_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_token_last_used_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_trigger_enc` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_last_ping` text;