-- Migration: 20261103000004_avatar_storage_and_profile_management.sql
-- Description: Provision avatars storage bucket, RLS policies for avatars, and company profile enhancements.

-- 1. Avatars Storage Bucket (Public read, authenticated owner write/delete)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    5242880, -- 5MB limit
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS Policies for avatars
DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;

CREATE POLICY "avatars_public_select"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'avatars');

CREATE POLICY "avatars_user_insert"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "avatars_user_update"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "avatars_user_delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3. Company Profile Schema Enhancements (Allow client users to configure company profile & logo)
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS description text;

-- 4. Enable Authenticated Users to Insert Company and Claim Initial Ownership
DROP POLICY IF EXISTS "companies_insert_authenticated" ON public.companies;
CREATE POLICY "companies_insert_authenticated"
    ON public.companies
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "company_members_insert_owner" ON public.company_members;
CREATE POLICY "company_members_insert_owner"
    ON public.company_members
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

GRANT INSERT ON public.companies TO authenticated;
GRANT INSERT ON public.company_members TO authenticated;
