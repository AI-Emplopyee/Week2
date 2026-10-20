CREATE TABLE `ai_processing_jobs` (
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_version` integer NOT NULL,
	`sha256` text NOT NULL,
	`page` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`available_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`elapsed_ms` integer,
	`error` text,
	PRIMARY KEY(`workspace_id`, `document_id`, `document_version`, `sha256`, `page`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_processing_jobs_active` ON `ai_processing_jobs` (`workspace_id`,`state`,`lease_until`);