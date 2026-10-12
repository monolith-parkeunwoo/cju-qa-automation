CREATE TABLE `runner` (
	`id` integer PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`input` text NOT NULL,
	`profile_version` text NOT NULL,
	`status` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`order_id` text,
	`reservation_id` text,
	`checks` text,
	`reason` text,
	`token` text,
	`slot` integer,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dedupe` ON `runs` (`owner`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `single_active_run` ON `runs` (`slot`);