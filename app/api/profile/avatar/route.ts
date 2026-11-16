import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // 2. Read multipart file
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 5MB' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = file.type || 'image/webp';
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('jpeg')
      ? 'jpg'
      : contentType.includes('gif')
      ? 'gif'
      : 'webp';

    const fileName = `avatar-${Date.now()}.${ext}`;
    const filePath = `${user.id}/${fileName}`;

    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch (adminErr) {
      console.warn('[AvatarRoute] Admin client initialization notice:', adminErr);
    }

    let finalAvatarUrl: string | null = null;

    // 3. Ensure 'avatars' storage bucket exists in Supabase Storage
    if (adminClient) {
      try {
        const { data: bucket, error: bucketErr } = await adminClient.storage.getBucket('avatars');
        if (!bucket || bucketErr) {
          console.log('[AvatarRoute] "avatars" bucket not found in storage. Auto-provisioning...');
          await adminClient.storage.createBucket('avatars', {
            public: true,
            fileSizeLimit: 5242880,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          });
        }

        // Upload file to Supabase storage
        const { error: uploadErr } = await adminClient.storage
          .from('avatars')
          .upload(filePath, buffer, {
            contentType,
            cacheControl: '3600',
            upsert: true,
          });

        if (!uploadErr) {
          const { data: publicData } = adminClient.storage
            .from('avatars')
            .getPublicUrl(filePath);

          if (publicData?.publicUrl) {
            finalAvatarUrl = publicData.publicUrl;
          }
        } else {
          console.warn('[AvatarRoute] Supabase storage upload notice:', uploadErr.message);
        }
      } catch (storageExc) {
        console.warn('[AvatarRoute] Storage provisioning/upload exception:', storageExc);
      }
    }

    // 4. Fallback if storage bucket is completely unconfigured on remote project
    if (!finalAvatarUrl) {
      console.log('[AvatarRoute] Falling back to direct WebP base64 URI for avatar...');
      finalAvatarUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    }

    // 5. Update profiles database record
    if (adminClient) {
      await adminClient
        .from('profiles')
        .update({ avatar_url: finalAvatarUrl })
        .eq('id', user.id);
    } else {
      await supabase
        .from('profiles')
        .update({ avatar_url: finalAvatarUrl })
        .eq('id', user.id);
    }

    // 6. Revalidate cache
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    if (currentProfile?.username) {
      revalidatePath(`/freelancers/${currentProfile.username}`);
    }
    revalidatePath('/freelancers');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    revalidatePath('/');

    return NextResponse.json({
      success: true,
      avatarUrl: finalAvatarUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch {
      // non-blocking
    }

    if (adminClient) {
      await adminClient.from('profiles').update({ avatar_url: null }).eq('id', user.id);
    } else {
      await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);
    }

    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    if (currentProfile?.username) {
      revalidatePath(`/freelancers/${currentProfile.username}`);
    }
    revalidatePath('/freelancers');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    revalidatePath('/');

    return NextResponse.json({ success: true, avatarUrl: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
