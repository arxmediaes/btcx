import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { userId: text('user_id').primaryKey(), payload: text('payload').notNull(), revision: integer('revision').notNull().default(0), updatedAt: integer('updated_at').notNull() });

/**
 * One encrypted Binance credential set per signed-in owner.
 * The browser never receives the secret; the Worker decrypts it only for a
 * signed request to Binance. Withdrawals and order endpoints are deliberately
 * not part of this first connection phase.
 */
export const binanceConnections = sqliteTable('binance_connections', {
  userId: text('user_id').primaryKey(),
  apiKeyCipher: text('api_key_cipher').notNull(),
  secretCipher: text('secret_cipher').notNull(),
  environment: text('environment').notNull().default('futures_live'),
  apiKeyLast4: text('api_key_last4').notNull(),
  connectedAt: integer('connected_at').notNull(),
  lastCheckedAt: integer('last_checked_at'),
  status: text('status').notNull().default('connected'),
  lastError: text('last_error'),
});

export const krakenConnections = sqliteTable('kraken_connections', {
  accountUid: text('account_uid').notNull(),
  userId: text('user_id').primaryKey(),
  apiKeyCipher: text('api_key_cipher').notNull(),
  secretCipher: text('secret_cipher').notNull(),
  apiKeyLast4: text('api_key_last4').notNull(),
  connectedAt: integer('connected_at').notNull(),
  settings: text('settings').notNull().default('{}'),
});
// Durable deduplication and execution journal, independent of Binance.
export const krakenExecutions = sqliteTable('kraken_executions', {
  accountUid: text('account_uid').notNull(),
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  status: text('status').notNull(),
  payload: text('payload').notNull(),
});
export const krakenLocks = sqliteTable('kraken_locks', {
  userId: text('user_id').primaryKey(),
  executionId: text('execution_id').notNull(),
  createdAt: integer('created_at').notNull(),
});
