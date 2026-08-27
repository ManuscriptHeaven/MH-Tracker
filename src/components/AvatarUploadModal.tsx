import React, { useRef, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Link as LinkIcon, Upload, User, X, Trash2 } from 'lucide-react';
import { Button, Card, Field, Modal } from './ui';
import { UserAvatar, DEFAULT_TEAM_AVATARS } from './UserAvatar';
import type { Profile } from '../lib/types';

interface AvatarUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile;
  onSaveProfile: (
    profileId: string,
    updates: { full_name?: string; avatar_url?: string | null; phone?: string | null }
  ) => Promise<string | void>;
}

export function AvatarUploadModal({
  isOpen,
  onClose,
  profile,
  onSaveProfile,
}: AvatarUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url || null);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'url' | 'presets'>('upload');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) return null;

  function handleFileSelect(file: File) {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (JPG, PNG, WEBP, GIF).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image size should be less than 5MB.');
      return;
    }

    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setAvatarUrl(result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }

  function handleApplyCustomUrl() {
    const trimmed = customUrlInput.trim();
    if (trimmed) {
      setAvatarUrl(trimmed);
      setCustomUrlInput('');
      setErrorMsg(null);
    }
  }

  async function handleSave() {
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await onSaveProfile(profile.id, {
        full_name: fullName.trim() || profile.full_name,
        avatar_url: avatarUrl,
        phone: phone.trim() || profile.phone,
      });

      setSuccessMsg('Display picture and profile updated successfully!');
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update profile.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Update Profile & Display Picture">
      <div className="space-y-6">
        {/* Current Avatar & Live Preview */}
        <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl border border-border bg-ivory/50">
          <div className="relative group">
            <UserAvatar
              profile={{ ...profile, full_name: fullName, avatar_url: avatarUrl }}
              size="2xl"
              showRoleRing
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/60 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              title="Upload new picture"
            >
              <Camera className="h-6 w-6" />
            </button>
          </div>

          <div className="flex-1 text-center sm:text-left space-y-1">
            <h3 className="font-display font-bold text-lg text-ink">{fullName || profile.full_name}</h3>
            <p className="text-xs text-muted capitalize">Role: {profile.role}</p>
            <p className="text-xs text-muted font-mono">{profile.email}</p>

            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl(null)}
                className="inline-flex items-center gap-1.5 text-xs text-danger font-semibold mt-2 hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove Custom DP (Reset)
              </button>
            )}
          </div>
        </div>

        {/* DP Choice Method Tabs */}
        <div className="space-y-3">
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                activeTab === 'upload'
                  ? 'border-gold text-ink font-bold'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Upload className="h-3.5 w-3.5" /> Upload File
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                activeTab === 'url'
                  ? 'border-gold text-ink font-bold'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <LinkIcon className="h-3.5 w-3.5" /> Image URL
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                activeTab === 'presets'
                  ? 'border-gold text-ink font-bold'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Presets Gallery
            </button>
          </div>

          {/* TAB 1: FILE UPLOAD */}
          {activeTab === 'upload' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition text-center ${
                isDragging
                  ? 'border-gold bg-gold/10'
                  : 'border-border bg-white hover:bg-ivory/50 hover:border-gold/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp, image/gif"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div className="h-12 w-12 rounded-full bg-gold/10 flex items-center justify-center text-gold mb-2">
                <Upload className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-ink">
                Click to browse or drag & drop your photo
              </p>
              <p className="text-xs text-muted mt-1">Supports PNG, JPG, WEBP, GIF up to 5MB</p>
            </div>
          )}

          {/* TAB 2: IMAGE URL */}
          {activeTab === 'url' && (
            <div className="space-y-2 bg-white p-4 rounded-xl border border-border">
              <Field
                label="Direct Image Link (URL)"
                placeholder="https://images.unsplash.com/... or https://..."
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={handleApplyCustomUrl} className="text-xs">
                Apply Link
              </Button>
            </div>
          )}

          {/* TAB 3: PRESETS GALLERY */}
          {activeTab === 'presets' && (
            <div className="space-y-2 bg-white p-4 rounded-xl border border-border">
              <p className="text-xs font-semibold text-muted mb-2">Select a professional preset avatar:</p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                {Object.entries(DEFAULT_TEAM_AVATARS).map(([key, url]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAvatarUrl(url)}
                    className={`relative rounded-full overflow-hidden border-2 transition transform hover:scale-105 ${
                      avatarUrl === url ? 'border-gold ring-2 ring-gold/40 scale-105' : 'border-transparent hover:border-gold/50'
                    }`}
                  >
                    <img src={url} alt={key} className="h-12 w-12 object-cover" />
                    {avatarUrl === url && (
                      <span className="absolute inset-0 bg-gold/40 flex items-center justify-center text-ink font-bold">
                        <Check className="h-4 w-4 stroke-[3]" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile Info Edit Fields */}
        <div className="space-y-4 pt-2 border-t border-border">
          <Field
            label="Full Name *"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Field
            label="Phone Number"
            placeholder="+1 555 0199"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {/* Alerts & Action Buttons */}
        {errorMsg && <p className="text-xs font-semibold text-danger">{errorMsg}</p>}
        {successMsg && <p className="text-xs font-semibold text-success flex items-center gap-1"><Check className="h-4 w-4" /> {successMsg}</p>}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Profile & DP'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
