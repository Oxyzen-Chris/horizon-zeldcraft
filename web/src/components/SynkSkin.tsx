'use client';

import { STAGE_NAMES } from '@/lib/contract';

/**
 * Skins pixel-art de Synk — jeune héros façon Link (BOTW/TOTK), habillé façon Minecraft (grille
 * de blocs 16×16). Il grandit en guerrier/mage dresseur de dragons au fil des 5 stades de
 * progression déjà en place on-chain (mêmes stades que l'ancien "Voxlyn" : seul l'habillage
 * visuel change, le calcul de stade reste on-chain et inchangé — voir HorizonZeldCraft.sol).
 *
 * Progression visuelle :
 *   egg      → Jeune Adulte        : tunique simple, sans arme (départ de l'aventure)
 *   hatched  → Adulte Novice       : + épée (peu de pouvoir, premiers pas de combattant)
 *   juvenile → Adulte Aguerri      : + bouclier (expérience de combat)
 *   adult    → Adulte Puissant     : + cape/aura magique (dons de magicien)
 *   ancient  → Maître Dresseur     : + couronne + silhouette de dragon (familier, plein pouvoir)
 */

type Pixel = { x: number; y: number; c: string };

// Grille de base 16×16 (silhouette humanoïde : cheveux, visage, tunique, jambes, bottes)
const BASE: string[] = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....SSESSESS....',
  '....SSSSSSSS....',
  '...TTTTTTTTTT...',
  '..TTTTTTTTTTTT..',
  '..TTTTTTTTTTTT..',
  '..TTTTGTTTTTT...',
  '....TT....TT....',
  '....BB....BB....',
  '....BB....BB....',
  '....BB....BB....',
  '....DD....DD....',
  '................',
];

const SWORD: Pixel[] = [
  { x: 14, y: 6, c: 'G' },
  { x: 14, y: 7, c: 'W' },
  { x: 14, y: 8, c: 'W' },
  { x: 14, y: 9, c: 'W' },
  { x: 14, y: 10, c: 'W' },
];

const SHIELD: Pixel[] = [
  { x: 1, y: 7, c: 'R' },
  { x: 1, y: 8, c: 'R' },
  { x: 1, y: 9, c: 'R' },
  { x: 0, y: 8, c: 'R' },
];

const CAPE_AURA: Pixel[] = [
  { x: 3, y: 11, c: 'C' },
  { x: 3, y: 12, c: 'C' },
  { x: 3, y: 13, c: 'C' },
  { x: 12, y: 11, c: 'C' },
  { x: 12, y: 12, c: 'C' },
  { x: 12, y: 13, c: 'C' },
  { x: 5, y: 0, c: 'A' },
  { x: 10, y: 0, c: 'A' },
];

const CROWN_DRAGON: Pixel[] = [
  { x: 6, y: 0, c: 'K' },
  { x: 7, y: 0, c: 'K' },
  { x: 8, y: 0, c: 'K' },
  { x: 9, y: 0, c: 'K' },
  { x: 14, y: 0, c: 'X' },
  { x: 13, y: 1, c: 'X' },
  { x: 14, y: 1, c: 'X' },
  { x: 15, y: 1, c: 'X' },
  { x: 14, y: 2, c: 'X' },
];

const STAGE_OVERLAYS: Record<string, Pixel[]> = {
  egg: [],
  hatched: [...SWORD],
  juvenile: [...SWORD, ...SHIELD],
  adult: [...SWORD, ...SHIELD, ...CAPE_AURA],
  ancient: [...SWORD, ...SHIELD, ...CAPE_AURA, ...CROWN_DRAGON],
};

// Couleur de tunique progressive (verte → émeraude profonde) pour marquer la montée en puissance
const STAGE_TUNIC: Record<string, string> = {
  egg: '#3f9142',
  hatched: '#379a45',
  juvenile: '#22823a',
  adult: '#166534',
  ancient: '#15803d',
};

const BASE_PALETTE: Record<string, string> = {
  H: '#8a5a2b', // cheveux
  S: '#f2c99d', // peau
  E: '#1e293b', // yeux
  T: '#3f9142', // tunique (écrasé par STAGE_TUNIC)
  G: '#d4af37', // ceinture / garde d'épée (or)
  B: '#5b3a1e', // jambes
  D: '#2b1b0e', // bottes
  W: '#cbd5e1', // lame d'épée (acier)
  R: '#7f1d1d', // bouclier
  C: '#6d28d9', // cape / aura magique
  A: '#fde68a', // halo doré
  K: '#eab308', // couronne
  X: '#dc2626', // silhouette de dragon (familier)
};

export function SynkSkin({ stage, size = 200 }: { stage: number; size?: number }) {
  const stageName = STAGE_NAMES[stage] || 'egg';
  const overlay = STAGE_OVERLAYS[stageName] ?? [];
  const palette: Record<string, string> = { ...BASE_PALETTE, T: STAGE_TUNIC[stageName] ?? BASE_PALETTE.T };

  // Fusionne la grille de base avec les overlays du stade courant (arme/bouclier/cape/couronne)
  const grid = BASE.map((row) => row.split(''));
  for (const p of overlay) {
    if (grid[p.y]) grid[p.y][p.x] = p.c;
  }

  return (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
      <defs>
        <radialGradient id={`synk-glow-${stage}`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={palette.T} stopOpacity="0.35" />
          <stop offset="100%" stopColor={palette.T} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="16" height="16" fill={`url(#synk-glow-${stage})`} />
      {grid.map((row, y) =>
        row.map((c, x) => {
          if (c === '.' || !palette[c]) return null;
          return <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={palette[c]} />;
        }),
      )}
    </svg>
  );
}
