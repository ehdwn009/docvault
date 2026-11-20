CREATE TABLE `trade_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`period` text NOT NULL,
	`article_id` text NOT NULL,
	`title` text NOT NULL,
	`dept` text,
	`published_date` text NOT NULL,
	`file_id` integer,
	`pdf_name` text NOT NULL,
	`pdf_sha256` text NOT NULL,
	`pdf_bytes` integer NOT NULL,
	`found_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_releases_source_period` ON `trade_releases` (`source`,`period`);