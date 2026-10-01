import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Better Auth core tables (singular names expected by the adapter)
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),

  // Flipcast billing / usage
  subscriptionTier: text('subscription_tier').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  /** Seconds of *source* video rendered in the current quota period. */
  monthlyUsageSeconds: integer('monthly_usage_seconds').notNull().default(0),
  /** Start of the current quota window; used to roll usage over each period. */
  usagePeriodStart: timestamp('usage_period_start').notNull().defaultNow(),
  /**
   * Effective ceiling. Left NULL by default so `TIER_LIMITS[tier]` is the
   * single source of truth; set explicitly for bespoke/promo grants.
   */
  maxUsageLimit: integer('max_usage_limit'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// Flipcast app tables
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  'pending',
  'rendering',
  'completed',
  'failed',
  'canceled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * One source video in, N platform-ready outputs out ("dual-format").
 *
 * Rendering happens in the user's browser (see src/lib/video/ffmpeg-client.ts)
 * so `sourceKey` is NULL for local renders and only set when a source was
 * uploaded to object storage by the (future) server worker.
 */
export const videoJobs = pgTable(
  'video_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),

    /** NULL for in-browser renders (source never leaves the device). */
    sourceKey: text('source_key'),
    /** Where the render ran: 'browser' today, 'worker' once Oracle is live. */
    renderEngine: text('render_engine').notNull().default('browser'),

    status: text('status').$type<JobStatus>().notNull().default('pending'),
    trackingMode: text('tracking_mode').notNull().default('auto_center'),

    /** Source probe results, reported by the client before rendering. */
    sourceWidth: integer('source_width'),
    sourceHeight: integer('source_height'),
    sourceDurationSeconds: real('source_duration_seconds'),
    sourceSizeBytes: integer('source_size_bytes'),

    /** Coarse 0-100 progress so the UI can show real movement. */
    progress: integer('progress').notNull().default(0),
    error: text('error'),

    /** Seconds reserved from quota at render start (released on failure). */
    reservedSeconds: integer('reserved_seconds'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    userIdx: index('video_jobs_user_id_idx').on(t.userId),
    statusIdx: index('video_jobs_status_idx').on(t.status),
  }),
);

/**
 * One row per rendered output format. A 9:16 + 1:1 job produces two rows, so
 * history and downloads stay per-format rather than per-job.
 */
export const jobOutputs = pgTable(
  'job_outputs',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => videoJobs.id, { onDelete: 'cascade' }),
    ratio: text('ratio').notNull(),
    status: text('status').$type<JobStatus>().notNull().default('pending'),
    /** Storage key when rendered server-side; NULL for browser renders. */
    storageKey: text('storage_key'),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    progress: integer('progress').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    jobIdx: index('job_outputs_job_id_idx').on(t.jobId),
  }),
);

export type VideoJob = typeof videoJobs.$inferSelect;
export type NewVideoJob = typeof videoJobs.$inferInsert;
export type JobOutput = typeof jobOutputs.$inferSelect;
export type NewJobOutput = typeof jobOutputs.$inferInsert;