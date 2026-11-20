CREATE TABLE `trade_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`period` text NOT NULL,
	`owner_id` integer NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`deadline_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`remote_started_at` integer,
	`finished_at` integer,
	`report` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_jobs_job_id_unique` ON `trade_jobs` (`job_id`);--> statement-breakpoint
CREATE INDEX `trade_jobs_period` ON `trade_jobs` (`period`);--> statement-breakpoint
ALTER TABLE `trade_releases` ADD `analysis_json` text;--> statement-breakpoint
ALTER TABLE `trade_releases` ADD `analysis_file_id` integer REFERENCES files(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `trade_releases` ADD `analysis_at` integer;