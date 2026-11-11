-- Migration: 20261103000010_milestone_deliveries_storage.sql
-- Description: Dedicated secure storage bucket and RLS policies for milestone delivery attachments.

-- 1. CREATE SECURE STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'milestone-deliveries',
    'milestone-deliveries',
    false,
    52428800, -- 50 MB
    ARRAY[
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'application/x-tar',
        'application/gzip',
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'text/plain',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. STORAGE RLS POLICIES
DROP POLICY IF EXISTS "milestone_deliveries_upload" ON storage.objects;
CREATE POLICY "milestone_deliveries_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'milestone-deliveries'
    AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "milestone_deliveries_select" ON storage.objects;
CREATE POLICY "milestone_deliveries_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'milestone-deliveries'
    AND auth.uid() IS NOT NULL
);

