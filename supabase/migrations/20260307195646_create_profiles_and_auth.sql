-- 1. Create public.profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

-- 2. Add constraint for role
alter table public.profiles
add constraint profiles_role_check check (role in ('admin', 'user'));

-- 3. Function and trigger on auth.users -> public.profiles
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$ language plpgsql security definer;

-- Check if trigger exists before creating to avoid errors on reapplying
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Enable RLS on public.profiles
alter table public.profiles enable row level security;

-- 5. Create policies
-- Users can view their own profile
create policy "Users can view own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id);

-- (To ensure the 'role' column is not modified by the user, we use a BEFORE UPDATE trigger)
-- RLS policies control row-level access, but restricting specific columns is best handled via a trigger.
create or replace function public.prevent_role_update()
returns trigger as $$
begin
  if new.role is distinct from old.role then
    new.role = old.role; -- Revert the change automatically (or we could raise an exception)
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists prevent_profile_role_update on public.profiles;
create trigger prevent_profile_role_update
  before update on public.profiles
  for each row execute procedure public.prevent_role_update();
