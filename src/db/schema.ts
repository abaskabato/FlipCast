import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  index,
  uniqueIndex,
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

  // Where the account came from, recorded once just after sign-up: the link's
  // tag (?ref= or ?utm_source=, e.g. "tiktok") and the referring site's host.
  signupSource: text('signup_source'),
  signupReferrer: text('signup_referrer'),
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
// ---------------------------------------------------------------------------
// Publishing to social platforms
// ---------------------------------------------------------------------------

export const SOCIAL_PLATFORMS = ['youtube', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * A YouTube channel or TikTok account a user connected with OAuth.
 *
 * Tokens are stored encrypted (AES-256-GCM, see src/lib/social/crypto.ts) with
 * a key that lives only in the environment, so a database leak alone does not
 * hand anyone the ability to post as our users.
 */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<SocialPlatform>().notNull(),
    /** YouTube channel ID or TikTok open_id. */
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    scope: text('scope'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('social_accounts_user_id_idx').on(t.userId),
    uniq: uniqueIndex('social_accounts_user_platform_external_uq').on(t.userId, t.platform, t.externalId),
  }),
);

export const POST_STATUSES = [
  'uploading', // the browser is sending the video
  'scheduled', // waiting for its time (YouTube holds it, or our scheduler will)
  'posting', // the scheduler is sending it to the platform
  'processing', // the platform is processing it
  'posted',
  'failed',
  'canceled',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * One publish of a rendered clip to one account, now or at a set time.
 *
 * `blobPathname` is only set for TikTok posts scheduled for later: TikTok's API
 * cannot schedule, so the rendered clip waits in private Blob storage and is
 * deleted once posted or canceled. Everything else uploads straight from the
 * user's browser to the platform and is never stored by us.
 */
export const scheduledPosts = pgTable(
  'scheduled_posts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    socialAccountId: text('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<SocialPlatform>().notNull(),
    status: text('status').$type<PostStatus>().notNull(),
    /** NULL means "as soon as it is uploaded". */
    scheduledAt: timestamp('scheduled_at'),
    title: text('title').notNull(),
    description: text('description'),
    /** Platform privacy value, e.g. 'public' or 'PUBLIC_TO_EVERYONE'. */
    privacy: text('privacy').notNull(),
    /** Platform-specific options (TikTok interaction toggles, disclosure). */
    options: text('options'),
    sizeBytes: integer('size_bytes'),
    blobPathname: text('blob_pathname'),
    /** YouTube video ID or TikTok publish_id. */
    externalId: text('external_id'),
    /** Public link once known. */
    url: text('url'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    postedAt: timestamp('posted_at'),
  },
  (t) => ({
    userIdx: index('scheduled_posts_user_id_idx').on(t.userId),
    dueIdx: index('scheduled_posts_due_idx').on(t.status, t.scheduledAt),
  }),
);
