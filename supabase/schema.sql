create extension if not exists "uuid-ossp";

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  subscription_tier text default 'free' check (subscription_tier in ('free', 'creator', 'agency')),
  stripe_customer_id text,
  monthly_usage_seconds integer default 0,
  max_usage_limit integer default 180,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.video_jobs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  original_name text not null,
  storage_path text not null,
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  aspect_ratio_output text default '9:16' check (aspect_ratio_output in ('9:16', '1:1', '16:9')),
  tracking_mode text default 'auto_center' check (tracking_mode in ('auto_center', 'manual_crop', 'smart_face')),
  download_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;
alter table public.video_jobs enable row level security;

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own jobs" on public.video_jobs for insert with check (auth.uid() = user_id);
create policy "Users can view own jobs" on public.video_jobs for select using (auth.uid() = user_id);
