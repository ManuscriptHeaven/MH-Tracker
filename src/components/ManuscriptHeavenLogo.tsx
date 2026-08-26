import React from 'react';
import { cn } from '../lib/utils';

interface ManuscriptHeavenLogoProps {
  className?: string;
  variant?: 'full' | 'monogram' | 'emblem' | 'invoice-header';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  darkTheme?: boolean;
}

export function ManuscriptHeavenLogo({
  className,
  variant = 'full',
  size = 'md',
  darkTheme = false,
}: ManuscriptHeavenLogoProps) {
  // SVG Monogram with Feather Quill
  const QuillMonogram = ({ sizePx = 40 }: { sizePx?: number }) => (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      <defs>
        <linearGradient id="mhGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#DFCA96" />
          <stop offset="35%" stopColor="#C8A96B" />
          <stop offset="70%" stopColor="#B38938" />
          <stop offset="100%" stopColor="#8E6A23" />
        </linearGradient>
        <linearGradient id="featherGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#B38938" />
          <stop offset="50%" stopColor="#D8BE7D" />
          <stop offset="100%" stopColor="#EAD8A4" />
        </linearGradient>
      </defs>

      {/* Serif 'M' Letter Left Stems */}
      <path
        d="M18 96V32H28L46 72L50 64L32 24H10V32H16V96H10V104H32V96H24V42L44 86H50L56 72L36 32V96H18Z"
        fill="url(#mhGoldGrad)"
      />

      {/* Feather Quill sweeping through M */}
      <path
        d="M42 98C46 88 52 74 58 58C64 42 74 24 88 12C85 24 82 38 78 52C74 66 68 80 62 92C58 100 50 106 42 108C40 108 40 104 42 98Z"
        fill="url(#featherGrad)"
      />
      {/* Quill Vanes / Barbs Texture Lines */}
      <path
        d="M62 40C68 34 76 28 84 22M58 54C66 48 74 42 80 36M54 68C60 62 68 56 74 50M50 82C56 76 62 70 68 64"
        stroke="#8E6A23"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.6"
      />

      {/* Serif 'H' Letter Right Stems */}
      <path
        d="M74 104H96V96H90V70H108V96H102V104H124V96H118V32H124V24H102V32H108V62H90V32H96V24H74V32H80V96H74V104Z"
        fill="url(#mhGoldGrad)"
      />
    </svg>
  );

  if (variant === 'emblem') {
    return (
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full bg-[#181818] border-2 border-gold/70 shadow-lg flex-shrink-0',
          size === 'sm' && 'h-10 w-10',
          size === 'md' && 'h-14 w-14',
          size === 'lg' && 'h-20 w-20',
          size === 'xl' && 'h-28 w-28',
          className,
        )}
      >
        <QuillMonogram
          sizePx={
            size === 'sm' ? 26 : size === 'md' ? 38 : size === 'lg' ? 56 : 76
          }
        />
      </div>
    );
  }

  if (variant === 'monogram') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <QuillMonogram
          sizePx={
            size === 'sm' ? 28 : size === 'md' ? 40 : size === 'lg' ? 56 : 72
          }
        />
      </div>
    );
  }

  if (variant === 'invoice-header') {
    return (
      <div className={cn('flex items-center gap-3.5', className)}>
        <QuillMonogram sizePx={54} />
        <div className="border-l border-[#d8ccb8] pl-3.5">
          <h2 className="font-serif text-xl font-bold tracking-tight text-[#1a1a1a] uppercase">
            MANUSCRIPT HEAVEN
          </h2>
          <p className="text-[10px] tracking-[0.22em] font-semibold text-[#8b6f38] uppercase mt-0.5">
            PUBLISHING & FORMATTING SERVICES
          </p>
        </div>
      </div>
    );
  }

  // Default 'full' variant
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink border border-gold/40 shadow-sm flex-shrink-0">
        <QuillMonogram sizePx={32} />
      </div>
      <div>
        <p
          className={cn(
            'font-serif text-lg font-bold tracking-tight leading-tight',
            darkTheme ? 'text-white' : 'text-ink',
          )}
        >
          Manuscript Heaven
        </p>
        <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-gold">
          Project Tracker
        </p>
      </div>
    </div>
  );
}
