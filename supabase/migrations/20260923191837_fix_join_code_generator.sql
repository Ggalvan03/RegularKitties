create or replace function private.new_join_code() returns text language plpgsql volatile set search_path = '' as $$
declare candidate text;
begin
  loop
    candidate := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '/+=01', 'ABCDE'), 1, 6));
    candidate := regexp_replace(candidate, '[^A-Z2-9]', 'K', 'g');
    exit when not exists(select 1 from public.rooms where join_code = candidate and status <> 'closed');
  end loop;
  return candidate;
end $$;
