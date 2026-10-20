import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().unique(),
  revision: integer('revision').notNull().default(0),
  stateJson: text('state_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceStateChunks = sqliteTable('workspace_state_chunks', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  snapshotId: text('snapshot_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.snapshotId, table.chunkIndex] })]);

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  userId: text('user_id'),
  role: text('role', { enum: ['owner', 'reviewer'] }).notNull(),
  invitedBy: text('invited_by').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.workspaceId, table.email] }),
  uniqueIndex('workspace_member_identity').on(table.workspaceId, table.userId),
]);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_rate_limits_expiry').on(table.expiresAt)]);

export const authRecoveryGrants = sqliteTable('auth_recovery_grants', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_recovery_grants_expiry').on(table.expiresAt)]);

export const aiProcessingJobs = sqliteTable('ai_processing_jobs', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  documentVersion: integer('document_version').notNull(),
  sha256: text('sha256').notNull(),
  page: integer('page').notNull(),
  state: text('state').notNull().default('queued'),
  leaseToken: text('lease_token'),
  leaseUntil: integer('lease_until').notNull().default(0),
  availableAt: integer('available_at').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  elapsedMs: integer('elapsed_ms'),
  error: text('error'),
}, table => [primaryKey({ columns: [table.workspaceId, table.documentId, table.documentVersion, table.sha256, table.page] }), index('ai_processing_jobs_active').on(table.workspaceId, table.state, table.leaseUntil)]);
