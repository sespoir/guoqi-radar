ALTER TABLE `jobs` ADD `verification_level` text DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `discovery_channel` text DEFAULT 'official_site' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `discovery_url` text;--> statement-breakpoint
CREATE INDEX `jobs_verification_level_idx` ON `jobs` (`verification_level`);--> statement-breakpoint
CREATE INDEX `jobs_discovery_channel_idx` ON `jobs` (`discovery_channel`);