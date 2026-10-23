CREATE TABLE `kraken_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`api_key_cipher` text NOT NULL,
	`secret_cipher` text NOT NULL,
	`api_key_last4` text NOT NULL,
	`connected_at` integer NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kraken_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kraken_locks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`created_at` integer NOT NULL
);
