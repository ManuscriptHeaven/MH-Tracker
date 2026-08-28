import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MessageSquare,
  Share2,
  X,
} from 'lucide-react';
import { Button, Card } from './ui';
import { roleLabels } from '../lib/constants';
import type { Role } from '../lib/types';

interface ShareableInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  recipientEmail: string;
  role: Role;
  temporaryPassword?: string;
  inviteToken?: string;
  assignedProjectTitles?: string[];
}

export function ShareableInviteModal({
  isOpen,
  onClose,
  recipientName,
  recipientEmail,
  role,
  temporaryPassword,
  inviteToken,
  assignedProjectTitles = [],
}: ShareableInviteModalProps) {
  const [copiedType, setCopiedType] = useState<'all' | 'link' | 'password' | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const loginUrl = inviteToken
    ? `${baseUrl}/?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(recipientEmail)}`
    : `${baseUrl}/?email=${encodeURIComponent(recipientEmail)}`;

  const isClient = role === 'client';
  const roleName = roleLabels[role] || role;

  const inviteMessage = isClient
    ? `📚 *Manuscript Heaven - Client Portal Access*

Dear ${recipientName},

Your access to the Manuscript Heaven Client Portal is ready. You can review your manuscript proofs, request revisions, and track progress live:

🔗 *Portal Link:* ${loginUrl}
📧 *Email:* ${recipientEmail}
${temporaryPassword ? `🔑 *Password:* ${temporaryPassword}\n` : ''}${
        assignedProjectTitles.length
          ? `📖 *Projects:* ${assignedProjectTitles.join(', ')}\n`
          : ''
      }
You can log in and manage your book projects anytime.`
    : `🌟 *Manuscript Heaven - Team Operations Access*

Hello ${recipientName},

Your team account has been set up as *${roleName}*.

🔗 *Tracker Link:* ${loginUrl}
📧 *Email:* ${recipientEmail}
${temporaryPassword ? `🔑 *Password:* ${temporaryPassword}\n` : ''}
Please sign in and change your password in the Settings page if desired.`;

  async function handleCopy(text: string, type: 'all' | 'link' | 'password') {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2500);
    } catch {
      // Fallback
    }
  }

  function handleShareWhatsApp() {
    const encoded = encodeURIComponent(inviteMessage);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  }

  function handleShareEmail() {
    const subject = encodeURIComponent(
      isClient
        ? 'Manuscript Heaven - Client Portal Access'
        : 'Manuscript Heaven - Team Operations Login'
    );
    const body = encodeURIComponent(inviteMessage);
    window.open(`mailto:${recipientEmail}?subject=${subject}&body=${body}`, '_blank');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <Card className="w-full max-w-lg bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-display text-xl font-bold text-ink">
                {isClient ? 'Client Added & Ready' : 'Employee Added & Ready'}
              </h3>
              <p className="text-xs text-muted">
                Account created in Supabase. Share the login details below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted hover:bg-ivory hover:text-ink transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Credentials Overview */}
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-border bg-ivory/60 p-3 text-sm space-y-2">
            <div className="flex justify-between items-center text-xs text-muted">
              <span>Account Type:</span>
              <span className="font-bold text-ink uppercase tracking-wider bg-gold/20 text-ink px-2 py-0.5 rounded">
                {roleName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Full Name:</span>
              <span className="font-semibold text-ink">{recipientName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Email:</span>
              <span className="font-semibold text-ink">{recipientEmail}</span>
            </div>
            {temporaryPassword && (
              <div className="flex justify-between items-center pt-1 border-t border-border/60">
                <span className="text-muted flex items-center gap-1">
                  <KeyRound className="h-3.5 w-3.5 text-gold" />
                  Password:
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-border">
                    {showPassword ? temporaryPassword : '••••••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted hover:text-ink p-1"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(temporaryPassword, 'password')}
                    className="text-xs font-semibold text-gold hover:underline flex items-center gap-1"
                  >
                    {copiedType === 'password' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedType === 'password' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Direct Link Section */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted block mb-1">
              Direct Login Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={loginUrl}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-xs font-mono text-charcoal select-all"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleCopy(loginUrl, 'link')}
                className="text-xs shrink-0 py-2"
              >
                {copiedType === 'link' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedType === 'link' ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
          </div>

          {/* Formatted Message Box */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">
                Pre-formatted Message for WhatsApp / Email
              </label>
              <button
                type="button"
                onClick={() => handleCopy(inviteMessage, 'all')}
                className="text-xs font-bold text-gold hover:underline flex items-center gap-1"
              >
                {copiedType === 'all' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    Copied Message!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Full Message
                  </>
                )}
              </button>
            </div>
            <textarea
              readOnly
              rows={5}
              value={inviteMessage}
              className="w-full rounded-md border border-border bg-linen/50 p-2.5 text-xs text-charcoal font-sans leading-relaxed select-all"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366]/10 px-3 py-2 text-xs font-bold text-[#128C7E] hover:bg-[#25D366]/20 transition"
            >
              <MessageSquare className="h-4 w-4" />
              Send via WhatsApp
            </button>
            <button
              type="button"
              onClick={handleShareEmail}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition"
            >
              <Mail className="h-4 w-4" />
              Send Email
            </button>
          </div>

          <Button type="button" onClick={onClose} className="text-xs py-2 px-4">
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}
