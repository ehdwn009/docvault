CREATE TABLE `outlook_editions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`since` text NOT NULL,
	`until` text NOT NULL,
	`file_id` integer,
	`data_json` text,
	`baseline_text` text,
	`lead` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`origin` text NOT NULL,
	`job_id` text,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outlook_editions_label_unique` ON `outlook_editions` (`label`);--> statement-breakpoint
CREATE TABLE `outlook_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`since` text NOT NULL,
	`until` text NOT NULL,
	`origin` text NOT NULL,
	`owner_id` integer NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`deadline_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`remote_started_at` integer,
	`finished_at` integer,
	`report` text,
	`edition_id` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `outlook_editions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outlook_jobs_job_id_unique` ON `outlook_jobs` (`job_id`);--> statement-breakpoint
CREATE INDEX `outlook_jobs_label` ON `outlook_jobs` (`label`);