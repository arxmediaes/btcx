CREATE TABLE `binance_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`api_key_cipher` text NOT NULL,
	`secret_cipher` text NOT NULL,
	`environment` text DEFAULT 'futures_live' NOT NULL,
	`api_key_last4` text NOT NULL,
	`connected_at` integer NOT NULL,
	`last_checked_at` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error` text
);
