CREATE TABLE `availability` (
	`key` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`quantity` integer NOT NULL,
	`state` text NOT NULL,
	`snapshot` text,
	`token` text,
	`updated` integer NOT NULL
);
