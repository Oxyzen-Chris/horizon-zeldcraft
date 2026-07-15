'use client';

import { STAGE_NAMES } from '@/lib/contract';

/**
 * Skins SVG procéduraux du Voxlyn — placeholders pixel-art inspirés
 * Minecraft × BOTW × WoW. À remplacer par de vraies illustrations en Phase 2.
 */
export function VoxlynSkin({ stage, size = 200 }: { stage: number; size?: number }) {
  const stageName = STAGE_NAMES[stage] || 'egg';

  const palette = {
    egg:      { bg: '#7dd3fc', accent: '#0ea5e9', eye: '#0f172a' },
    hatched:  { bg: '#a5f3fc', accent: '#06b6d4', eye: '#1e293b' },
    juvenile: { bg: '#67e8f9', accent: '#0891b2', eye: '#0f172a' },
    adult:    { bg: '#f472b6', accent: '#db2777', eye: '#1e293b' },
    ancient:  { bg: '#fbbf24', accent: '#d97706', eye: '#7c2d12' },
  }[stageName]!;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
      <defs>
        <radialGradient id={`glow-${stage}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.bg} stopOpacity="0.6" />
          <stop offset="100%" stopColor={palette.bg} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="45" fill={`url(#glow-${stage})`} />
      {stageName === 'egg' && (
        <>
          <ellipse cx="50" cy="55" rx="22" ry="28" fill={palette.bg} stroke={palette.accent} strokeWidth="2" />
          <path d="M35 45 L45 40 L50 45 L55 40 L65 45" stroke={palette.accent} strokeWidth="1.5" fill="none" />
        </>
      )}
      {stageName === 'hatched' && (
        <>
          <ellipse cx="50" cy="60" rx="24" ry="22" fill={palette.bg} stroke={palette.accent} strokeWidth="2" />
          <circle cx="42" cy="55" r="3" fill={palette.eye} />
          <circle cx="58" cy="55" r="3" fill={palette.eye} />
          <path d="M45 68 Q50 72 55 68" stroke={palette.eye} strokeWidth="1.5" fill="none" />
        </>
      )}
      {stageName === 'juvenile' && (
        <>
          <path d="M25 55 Q35 30 50 30 Q65 30 75 55 L70 75 L30 75 Z" fill={palette.bg} stroke={palette.accent} strokeWidth="2" />
          <circle cx="42" cy="50" r="3.5" fill={palette.eye} />
          <circle cx="58" cy="50" r="3.5" fill={palette.eye} />
          <path d="M40 65 Q50 70 60 65" stroke={palette.eye} strokeWidth="1.5" fill="none" />
          <path d="M20 55 L10 45 L15 60 Z" fill={palette.accent} />
          <path d="M80 55 L90 45 L85 60 Z" fill={palette.accent} />
        </>
      )}
      {stageName === 'adult' && (
        <>
          <path d="M20 55 Q30 25 50 25 Q70 25 80 55 L72 80 L28 80 Z" fill={palette.bg} stroke={palette.accent} strokeWidth="2.5" />
          <circle cx="40" cy="48" r="4" fill={palette.eye} />
          <circle cx="60" cy="48" r="4" fill={palette.eye} />
          <circle cx="41" cy="47" r="1" fill="#fff" />
          <circle cx="61" cy="47" r="1" fill="#fff" />
          <path d="M40 68 Q50 75 60 68" stroke={palette.eye} strokeWidth="2" fill="none" />
          <path d="M15 50 L5 30 L18 55 Z" fill={palette.accent} opacity="0.9" />
          <path d="M85 50 L95 30 L82 55 Z" fill={palette.accent} opacity="0.9" />
          <path d="M45 25 L50 18 L55 25" stroke={palette.accent} strokeWidth="2" fill="none" />
        </>
      )}
      {stageName === 'ancient' && (
        <>
          <path d="M15 55 Q30 20 50 20 Q70 20 85 55 L75 85 L25 85 Z" fill={palette.bg} stroke={palette.accent} strokeWidth="3" />
          <circle cx="38" cy="45" r="4.5" fill={palette.eye} />
          <circle cx="62" cy="45" r="4.5" fill={palette.eye} />
          <circle cx="38" cy="45" r="2" fill="#fff" />
          <circle cx="62" cy="45" r="2" fill="#fff" />
          <path d="M38 68 Q50 78 62 68" stroke={palette.eye} strokeWidth="2.5" fill="none" />
          <path d="M10 45 L0 15 L15 50 Z" fill={palette.accent} />
          <path d="M90 45 L100 15 L85 50 Z" fill={palette.accent} />
          <path d="M40 20 L45 8 L50 15 L55 8 L60 20" stroke={palette.accent} strokeWidth="2.5" fill="none" />
          <circle cx="50" cy="55" r="3" fill="#fef3c7" opacity="0.8" />
        </>
      )}
    </svg>
  );
}
