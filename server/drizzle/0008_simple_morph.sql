CREATE TABLE `card_threads` (
	`card_file_id` integer NOT NULL,
	`thread_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_file_id`, `thread_id`),
	FOREIGN KEY (`card_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `ask_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `files` ADD `kind` text DEFAULT 'doc' NOT NULL;