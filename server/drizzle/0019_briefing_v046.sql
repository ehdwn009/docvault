ALTER TABLE `briefing_runs` ADD `opus_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `opus_output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `briefing_runs` ADD `stage_usage` text;