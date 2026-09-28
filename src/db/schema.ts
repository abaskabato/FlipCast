import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

// Better Auth core tables (singular names expected by the adapter)
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Flipcast billing / usage fields
  subscriptionTier: text('subscription_tier').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  monthlyUsageSeconds: integer('monthly_usage_seconds').notNull().default(0),
  maxUsageLimit: integer('max_usage_limit').notNull().default(180),
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

// Flipcast app table
export const videoJobs = pgTable('video_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  originalName: text('original_name').notNull(),
  storagePath: text('storage_path').notNull(),
  status: text('status').notNull().default('pending'),
  aspectRatioOutput: text('aspect_ratio_output').notNull().default('9:16'),
  trackingMode: text('tracking_mode').notNull().default('auto_center'),
  downloadUrl: text('download_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
