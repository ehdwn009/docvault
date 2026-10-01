CREATE TABLE `briefing_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`trigger` text NOT NULL,
	`slot` text NOT NULL,
	`edition_date` text NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`since_at` integer NOT NULL,
	`until_at` integer NOT NULL,
	`file_id` integer,
	`source_count` integer DEFAULT 0 NOT NULL,
	`failed_sources` text,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`haiku_input_tokens` integer DEFAULT 0 NOT NULL,
	`haiku_output_tokens` integer DEFAULT 0 NOT NULL,
	`sonnet_input_tokens` integer DEFAULT 0 NOT NULL,
	`sonnet_output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `briefing_runs_owner_started_idx` ON `briefing_runs` (`owner_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `briefing_auto` integer DEFAULT 0 NOT NULL;