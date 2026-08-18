ALTER TABLE `user_file_state` ADD `font_scale` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `html_font_scale` integer DEFAULT 100 NOT NULL;