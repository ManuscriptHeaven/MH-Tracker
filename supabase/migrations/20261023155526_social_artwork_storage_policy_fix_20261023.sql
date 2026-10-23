-- Correct storage.objects name qualification inside nested brand ownership check.
-- The first pilot policy accidentally resolved bare "name" as social_brands.name.
drop policy if exists social_artwork_private_insert on storage.objects;
create policy social_artwork_private_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'social-artwork-private'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and (select public.phase6_app_actor_class()) = 'admin'
  and storage.objects.name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
  and exists (
    select 1 from public.social_brands b
    where b.id = case
      when (storage.foldername(storage.objects.name))[2]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(storage.objects.name))[2])::uuid
      else null::uuid end
    and b.owner_id = (select auth.uid())
  )
);
