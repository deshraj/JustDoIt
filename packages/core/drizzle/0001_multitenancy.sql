CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` text,
	`email` text,
	`name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_unique` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
INSERT INTO `users` (`id`, `github_id`, `email`, `name`, `avatar_url`, `created_at`, `updated_at`)
VALUES ('local-user', NULL, NULL, 'Local User', NULL, (strftime('%s','now') * 1000), (strftime('%s','now') * 1000));
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `time_entries_user_idx` ON `time_entries` (`user_id`);--> statement-breakpoint
ALTER TABLE `reminders` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `reminders_user_idx` ON `reminders` (`user_id`);--> statement-breakpoint
ALTER TABLE `activity_log` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `activity_log_user_idx` ON `activity_log` (`user_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `attachments_user_idx` ON `attachments` (`user_id`);--> statement-breakpoint
ALTER TABLE `saved_filters` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `saved_filters_user_idx` ON `saved_filters` (`user_id`);--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
DROP INDEX `tags_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_id_name_unique` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `tags_user_idx` ON `tags` (`user_id`);
