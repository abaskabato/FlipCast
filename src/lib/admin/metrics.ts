import 'server-only';

import { pool } from '@/db';

/**
 * Launch metrics for the private /admin page, straight from the tables the
 * app already writes (users and render jobs). No tracking scripts: the site's
 * COEP header would block most of them, and this needs none.
 */

/** Whether `email` may see /admin (ADMIN_EMAILS, comma-separated). */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

export type Metrics = {
  totals: { users: number; activated: number; renders: number; failed: number; minutes: number; signups7: number; active7: number };
  /** Of users who signed up at least 7 days ago: how many started a render on a later day that week. */
  retention: { cohort: number; returned: number };
  daily: { day: string; signups: number; renders: number; failed: number; active: number }[];
  tiers: { tier: string; users: number }[];
  tracking: { mode: string; renders: number }[];
  failures: { at: Date; error: string | null; mode: string; seconds: number | null; size: string | null }[];
  /** Sign-ups in the last 30 days by where they came from, and how many rendered. */
  sources: { source: string; referrer: string | null; users: number; activated: number }[];
  /** Errors from users' browsers in the last 7 days, grouped by message. */
  deviceErrors: { kind: string; message: string; count: number; users: number; lastSeen: Date; browser: string | null }[];
};

const num = (v: unknown) => Number(v ?? 0);

export async function getMetrics(): Promise<Metrics> {
  const [totals, retention, daily, tiers, tracking, failures, sources, deviceErrors] = await Promise.all([
    pool.query(`
      select
        (select count(*) from "user") as users,
        (select count(distinct user_id) from video_jobs where status = 'completed') as activated,
        (select count(*) from video_jobs where status = 'completed') as renders,
        (select count(*) from video_jobs where status = 'failed') as failed,
        (select coalesce(sum(source_duration_seconds), 0) / 60 from video_jobs where status = 'completed') as minutes,
        (select count(*) from "user" where created_at > now() - interval '7 days') as signups7,
        (select count(distinct user_id) from video_jobs where created_at > now() - interval '7 days') as active7`),
    pool.query(`
      select
        count(*) as cohort,
        count(*) filter (where exists (
          select 1 from video_jobs j
          where j.user_id = u.id
            and j.created_at::date > u.created_at::date
            and j.created_at <= u.created_at + interval '7 days'
        )) as returned
      from "user" u
      where u.created_at <= now() - interval '7 days'`),
    pool.query(`
      with d as (
        select generate_series(current_date - 13, current_date, interval '1 day')::date as day
      )
      select
        to_char(d.day, 'Dy DD Mon') as day,
        (select count(*) from "user" u where u.created_at::date = d.day) as signups,
        (select count(*) from video_jobs j where j.created_at::date = d.day and j.status = 'completed') as renders,
        (select count(*) from video_jobs j where j.created_at::date = d.day and j.status = 'failed') as failed,
        (select count(distinct j.user_id) from video_jobs j where j.created_at::date = d.day) as active
      from d
      order by d.day desc`),
    pool.query(`select subscription_tier as tier, count(*) as users from "user" group by subscription_tier order by 2 desc`),
    pool.query(`select tracking_mode as mode, count(*) as renders from video_jobs where status = 'completed' group by tracking_mode order by 2 desc`),
    pool.query(`
      select created_at as at, error, tracking_mode as mode, source_duration_seconds as seconds,
             case when source_width is not null then source_width || '×' || source_height end as size
      from video_jobs where status = 'failed' order by created_at desc limit 15`),
    pool.query(`
      select
        coalesce(u.signup_source, 'not recorded') as source,
        u.signup_referrer as referrer,
        count(*) as users,
        count(*) filter (where exists (select 1 from video_jobs j where j.user_id = u.id and j.status = 'completed')) as activated
      from "user" u
      where u.created_at > now() - interval '30 days'
      group by 1, 2
      order by 3 desc
      limit 30`),
    pool.query(`
      select kind, message, count(*) as count, count(distinct user_id) as users, max(created_at) as last_seen,
             (array_agg(user_agent order by created_at desc))[1] as browser
      from client_errors
      where created_at > now() - interval '7 days'
      group by kind, message
      order by count(*) desc, max(created_at) desc
      limit 20`),
  ]);
  const t = totals.rows[0];
  return {
    totals: {
      users: num(t.users),
      activated: num(t.activated),
      renders: num(t.renders),
      failed: num(t.failed),
      minutes: Math.round(num(t.minutes)),
      signups7: num(t.signups7),
      active7: num(t.active7),
    },
    retention: { cohort: num(retention.rows[0].cohort), returned: num(retention.rows[0].returned) },
    daily: daily.rows.map((r) => ({ day: r.day, signups: num(r.signups), renders: num(r.renders), failed: num(r.failed), active: num(r.active) })),
    tiers: tiers.rows.map((r) => ({ tier: r.tier, users: num(r.users) })),
    tracking: tracking.rows.map((r) => ({ mode: r.mode, renders: num(r.renders) })),
    failures: failures.rows.map((r) => ({ at: r.at, error: r.error, mode: r.mode, seconds: r.seconds === null ? null : num(r.seconds), size: r.size })),
    sources: sources.rows.map((r) => ({ source: r.source, referrer: r.referrer, users: num(r.users), activated: num(r.activated) })),
    deviceErrors: deviceErrors.rows.map((r) => ({ kind: r.kind, message: r.message, count: num(r.count), users: num(r.users), lastSeen: r.last_seen, browser: r.browser })),
  };
}
