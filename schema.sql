-- سیدا: طرح اولیه پایگاه داده Supabase
-- این فایل را در Supabase Dashboard > SQL Editor اجرا کنید.
-- سیاست‌ها دسترسی‌ها را محدود می‌کنند؛ کلید service_role را هرگز در برنامه مرورگر قرار ندهید.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  grade text not null default 'دهم',
  major text not null default 'تجربی',
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages(room_id, created_at);
create index if not exists room_members_user_idx on public.room_members(user_id);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- ساخت پروفایل خودکار پس از ثبت‌نام
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, grade, major, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'grade', 'دهم'),
    coalesce(new.raw_user_meta_data ->> 'major', 'تجربی'),
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- پروفایل‌ها: کاربر فقط پروفایل خودش را می‌خواند؛ ویرایش مستقیم از سمت کاربر مجاز نیست.
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_select_approved_peers" on public.profiles;
create policy "profiles_select_approved_peers" on public.profiles
for select to authenticated using (
  exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'approved')
  and status = 'approved'
);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update to authenticated using (false) with check (false);

-- فقط کاربران تأییدشده گروه‌ها را می‌بینند.
drop policy if exists "approved_users_read_rooms" on public.rooms;
create policy "approved_users_read_rooms" on public.rooms
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
);

-- کاربران تأییدشده می‌توانند عضو گروه شوند؛ فقط عضویت برای خودشان.
drop policy if exists "approved_users_join_rooms" on public.room_members;
create policy "approved_users_join_rooms" on public.room_members
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
);

drop policy if exists "members_read_memberships" on public.room_members;
create policy "members_read_memberships" on public.room_members
for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
);

-- پیام‌ها فقط برای اعضای تأییدشده گروه قابل خواندن/ارسال است.
drop policy if exists "members_read_messages" on public.messages;
create policy "members_read_messages" on public.messages
for select to authenticated using (
  exists (
    select 1 from public.profiles p
    join public.room_members rm on rm.user_id = p.id
    where p.id = auth.uid() and p.status = 'approved' and rm.room_id = messages.room_id
  )
);

drop policy if exists "members_send_messages" on public.messages;
create policy "members_send_messages" on public.messages
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    join public.room_members rm on rm.user_id = p.id
    where p.id = auth.uid() and p.status = 'approved' and rm.room_id = messages.room_id
  )
);

-- گروه‌های نمونه؛ تکرار اجرای فایل گروه تکراری ایجاد نمی‌کند.
insert into public.rooms (name, description) values
  ('اطلاعیه‌های مدرسه', 'اطلاعیه‌های رسمی مدیر مدرسه'),
  ('دهم تجربی', 'گروه آموزشی پایه دهم رشته تجربی'),
  ('دهم انسانی', 'گروه آموزشی پایه دهم رشته انسانی'),
  ('دهم ریاضی', 'گروه آموزشی پایه دهم رشته ریاضی'),
  ('یازدهم تجربی', 'گروه آموزشی پایه یازدهم رشته تجربی'),
  ('یازدهم انسانی', 'گروه آموزشی پایه یازدهم رشته انسانی'),
  ('یازدهم ریاضی', 'گروه آموزشی پایه یازدهم رشته ریاضی'),
  ('دوازدهم تجربی', 'گروه آموزشی پایه دوازدهم رشته تجربی'),
  ('دوازدهم انسانی', 'گروه آموزشی پایه دوازدهم رشته انسانی'),
  ('دوازدهم ریاضی', 'گروه آموزشی پایه دوازدهم رشته ریاضی')
on conflict (name) do nothing;

-- فعال‌سازی انتشار realtime برای پیام‌ها (در صورت نبودن در publication اضافه می‌شود)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime not found; enable Realtime for public.messages in Supabase dashboard.';
end $$;

-- راهنمای مدیر:
-- پس از ساخت حساب، در Table Editor > profiles مقدار status همان حساب را از pending به approved تغییر دهید.
-- برای افزودن کاربران به گروه، بعد از تأییدشان در room_members یک ردیف با room_id و user_id مربوطه بسازید.
-- برای نسخه عملیاتی، مدیریت نقش مدیر، عضویت و تأییدها را با پنل مدیریتی امن و سیاست‌های RLS اختصاصی پیاده‌سازی کنید.