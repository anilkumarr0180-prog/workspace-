'use client';

import React, { useState, useRef, ChangeEvent } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { updateProfileAvatar, removeProfileAvatar } from '@/lib/actions/profile';
import { Trash2, Loader2, UploadCloud, AlertCircle } from 'lucide-react';

interface AvatarUploaderProps {
  userId: string;
  currentAvatarUrl?: string | null;
  displayName: string;
  size?: 'md' | 'lg';
  onAvatarChanged?: (newUrl: string | null) => void;
}

/**
 * Client-side helper: crops image to 400x400 square and converts to efficient WebP blob.
 */
function processImageToSquareWebp(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const TARGET_SIZE = 400;
          canvas.width = TARGET_SIZE;
          canvas.height = TARGET_SIZE;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            return resolve(file); // fallback to raw file if context unavailable
          }

          // Calculate center crop
          const minDim = Math.min(img.width, img.height);
          const startX = (img.width - minDim) / 2;
          const startY = (img.height - minDim) / 2;

          ctx.drawImage(
            img,
            startX,
            startY,
            minDim,
            minDim,
            0,
            0,
            TARGET_SIZE,
            TARGET_SIZE
          );

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                resolve(file);
              }
            },
            'image/webp',
            0.9
          );
        } catch {
          resolve(file);
        }
      };
      img.onerror = () => reject(new Error('Failed to read image file.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to load file.'));
    reader.readAsDataURL(file);
  });
}

export default function AvatarUploader({
  userId,
  currentAvatarUrl,
  displayName,
  size = 'lg',
  onAvatarChanged,
}: AvatarUploaderProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentAvatarUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = (displayName || 'User')
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  const handleFileSelection = async (file: File) => {
    setErrorMessage(null);

    // 1. Validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage('Please choose a valid image file (JPEG, PNG, WebP, or GIF).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Image size must be less than 5MB.');
      return;
    }

    setIsUploading(true);

    try {
      // 2. Client-side square crop & compression
      const processedBlob = await processImageToSquareWebp(file);
      const fileExt = processedBlob.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'png';
      const fileName = `avatar-${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      // 3. Direct upload to Supabase Storage
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, processedBlob, {
          cacheControl: '3600',
          upsert: true,
          contentType: processedBlob.type || 'image/webp',
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // 4. Retrieve public URL
      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const newPublicUrl = publicUrlData.publicUrl;

      // 5. Update database record via Server Action (also cleans old orphaned image)
      const res = await updateProfileAvatar(newPublicUrl);
      if (!res.success) {
        throw new Error(res.error || 'Failed to save avatar URL to profile.');
      }

      setAvatarUrl(newPublicUrl);
      onAvatarChanged?.(newPublicUrl);

      // Broadcast event so Navbar updates immediately
      window.dispatchEvent(
        new CustomEvent('workspace:profile-updated', {
          detail: { avatarUrl: newPublicUrl },
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!avatarUrl || isRemoving || isUploading) return;
    setErrorMessage(null);
    setIsRemoving(true);

    try {
      const res = await removeProfileAvatar();
      if (!res.success) {
        throw new Error(res.error || 'Failed to remove avatar.');
      }

      setAvatarUrl(null);
      onAvatarChanged?.(null);

      // Broadcast event so Navbar updates immediately
      window.dispatchEvent(
        new CustomEvent('workspace:profile-updated', {
          detail: { avatarUrl: null },
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not remove avatar.';
      setErrorMessage(msg);
    } finally {
      setIsRemoving(false);
    }
  };

  const dimensionsClass = size === 'lg' ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-16 h-16 sm:w-20 sm:h-20';
  const textClass = size === 'lg' ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl';

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
      {/* Avatar Image / Placeholder with Hover Overlay */}
      <div
        className={`relative shrink-0 rounded-2xl overflow-hidden border-2 transition-all ${
          isDragOver ? 'border-emerald-500 ring-4 ring-emerald-500/20' : 'border-slate-200'
        } ${dimensionsClass}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFileSelection(file);
        }}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={120}
            height={120}
            unoptimized
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className={`w-full h-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center select-none ${textClass}`}
          >
            {initials}
          </div>
        )}

        {/* Loading overlay */}
        {(isUploading || isRemoving) && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white text-xs gap-1">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
            <span>{isUploading ? 'Uploading...' : 'Removing...'}</span>
          </div>
        )}
      </div>

      {/* Action Controls & Guidelines */}
      <div className="flex-1 space-y-2 text-center sm:text-left">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleInputChange}
          disabled={isUploading || isRemoving}
        />

        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isRemoving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UploadCloud className="w-3.5 h-3.5" />
            )}
            <span>{avatarUrl ? 'Change photo' : 'Upload photo'}</span>
          </button>

          {avatarUrl && (
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={isUploading || isRemoving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRemoving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Remove photo</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-500 leading-normal">
          Supported formats: WebP, JPEG, PNG, or GIF. Max 5MB. Automatically cropped to a square.
        </p>

        {errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-rose-600 pt-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
