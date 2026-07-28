CREATE TABLE `agent_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '全国' NOT NULL,
	`education` text DEFAULT '详见公告' NOT NULL,
	`job_type` text DEFAULT '招聘公告' NOT NULL,
	`category` text DEFAULT '信息技术' NOT NULL,
	`published_at` text,
	`deadline` text,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`summary` text NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`relevance_score` integer DEFAULT 50 NOT NULL,
	`content_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`collected_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_url_unique` ON `jobs` (`source_url`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_collected_at_idx` ON `jobs` (`collected_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE TABLE `source_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`status` text NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_runs_finished_at_idx` ON `source_runs` (`finished_at`);