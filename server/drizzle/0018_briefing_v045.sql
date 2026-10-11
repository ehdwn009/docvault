ALTER TABLE `briefing_runs` ADD `web_searches` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_file_state` ADD `flag_items` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_reader` integer DEFAULT 0 NOT NULL;