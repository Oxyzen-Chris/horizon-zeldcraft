'use client';

/**
 * Pixel-art des Familiers Dragon — même technique que `SynkSkin.tsx` (grille 16×16 rendue en
 * <rect> SVG), une seule silhouette de dragonnet chibi partagée, recolorée par palette selon le
 * "type" chromatique/métallique (lore inspiré des dragons classiques façon D&D, cohérent avec le
 * commentaire de `scripts/migrateFamiliarsToFirebase.mjs`) :
 *   Chromatiques (malfaisants) : Blanc (froid, le moins rusé), Noir (acide/marais, sournois),
 *   Vert (gaz toxique, manipulateur), Bleu (foudre/désert, fier et territorial),
 *   Rouge (feu/volcan, le plus redouté et arrogant).
 *   Métalliques (bienveillants) : Or (feu, noble protecteur — familier de départ à 5000 XP),
 *   Argent (froid, sage, ami des humains, forme humaine), Bronze (foudre, côtier, curieux/joueur).
 */

export type DragonKind = 'gold' | 'white' | 'black' | 'green' | 'blue' | 'red' | 'silver' | 'bronze';

type Pixel = { x: number; y: number; c: string };

// Silhouette unique (dragonnet chibi, profil, ailes dépliées) partagée par tous les types.
const DRAGON_PIXELS: Pixel[] = [
  // cornes
  { x: 6, y: 1, c: 'H' }, { x: 9, y: 1, c: 'H' },
  // tête
  { x: 5, y: 2, c: 'B' }, { x: 6, y: 2, c: 'B' }, { x: 7, y: 2, c: 'B' },
  { x: 8, y: 2, c: 'B' }, { x: 9, y: 2, c: 'B' }, { x: 10, y: 2, c: 'B' },
  { x: 4, y: 2, c: 'A' }, // souffle élémentaire (accent devant le museau)
  // aile (haut)
  { x: 1, y: 2, c: 'W' }, { x: 2, y: 2, c: 'W' }, { x: 2, y: 3, c: 'W' }, { x: 3, y: 3, c: 'W' },
  // tête (bas) + œil
  { x: 5, y: 3, c: 'B' }, { x: 6, y: 3, c: 'B' }, { x: 7, y: 3, c: 'E' }, { x: 8, y: 3, c: 'B' },
  { x: 9, y: 3, c: 'B' }, { x: 10, y: 3, c: 'B' }, { x: 11, y: 3, c: 'B' },
  // aile (milieu)
  { x: 1, y: 4, c: 'W' }, { x: 2, y: 4, c: 'W' }, { x: 3, y: 4, c: 'W' },
  // cou
  { x: 5, y: 4, c: 'B' }, { x: 6, y: 4, c: 'B' }, { x: 7, y: 4, c: 'B' }, { x: 8, y: 4, c: 'B' },
  { x: 9, y: 4, c: 'B' }, { x: 10, y: 4, c: 'B' }, { x: 11, y: 4, c: 'B' }, { x: 12, y: 4, c: 'B' },
  // aile (bas)
  { x: 2, y: 5, c: 'W' }, { x: 3, y: 5, c: 'W' },
  // corps (dos)
  { x: 5, y: 5, c: 'B' }, { x: 6, y: 5, c: 'B' }, { x: 7, y: 5, c: 'B' }, { x: 8, y: 5, c: 'B' },
  { x: 9, y: 5, c: 'B' }, { x: 10, y: 5, c: 'B' }, { x: 11, y: 5, c: 'B' }, { x: 12, y: 5, c: 'B' }, { x: 13, y: 5, c: 'B' },
  { x: 6, y: 6, c: 'B' }, { x: 7, y: 6, c: 'B' }, { x: 8, y: 6, c: 'B' }, { x: 9, y: 6, c: 'B' },
  { x: 10, y: 6, c: 'B' }, { x: 11, y: 6, c: 'B' }, { x: 12, y: 6, c: 'B' }, { x: 13, y: 6, c: 'B' }, { x: 14, y: 6, c: 'B' },
  // ventre (clair)
  { x: 6, y: 7, c: 'L' }, { x: 7, y: 7, c: 'L' }, { x: 8, y: 7, c: 'L' }, { x: 9, y: 7, c: 'L' },
  { x: 10, y: 7, c: 'L' }, { x: 11, y: 7, c: 'L' }, { x: 12, y: 7, c: 'L' }, { x: 13, y: 7, c: 'B' }, { x: 14, y: 7, c: 'B' },
  { x: 7, y: 8, c: 'L' }, { x: 8, y: 8, c: 'L' }, { x: 9, y: 8, c: 'L' }, { x: 10, y: 8, c: 'L' },
  { x: 11, y: 8, c: 'L' }, { x: 12, y: 8, c: 'L' }, { x: 13, y: 8, c: 'T' }, { x: 14, y: 8, c: 'T' }, { x: 15, y: 8, c: 'T' },
  // queue
  { x: 14, y: 9, c: 'T' }, { x: 15, y: 9, c: 'T' },
  // pattes
  { x: 7, y: 9, c: 'D' }, { x: 8, y: 9, c: 'D' }, { x: 11, y: 9, c: 'D' }, { x: 12, y: 9, c: 'D' },
  { x: 7, y: 10, c: 'D' }, { x: 8, y: 10, c: 'D' }, { x: 11, y: 10, c: 'D' }, { x: 12, y: 10, c: 'D' },
];

// Palettes par type de dragon — B: écailles, L: ventre, H: cornes, W: ailes, T: pointe de queue,
// D: pattes, A: souffle élémentaire (accent), E: œil (constant, sombre pour contraste).
const PALETTES: Record<DragonKind, Record<string, string>> = {
  gold:   { B: '#eab308', L: '#fde68a', H: '#78350f', W: '#ca8a04', T: '#fbbf24', D: '#78350f', A: '#fb923c', E: '#1c1917' },
  white:  { B: '#e2e8f0', L: '#f8fafc', H: '#94a3b8', W: '#cbd5e1', T: '#bae6fd', D: '#64748b', A: '#a5f3fc', E: '#1c1917' },
  black:  { B: '#1e293b', L: '#334155', H: '#0f172a', W: '#1e1b3a', T: '#166534', D: '#0f172a', A: '#4ade80', E: '#dc2626' },
  green:  { B: '#166534', L: '#4ade80', H: '#14532d', W: '#15803d', T: '#65a30d', D: '#052e16', A: '#84cc16', E: '#1c1917' },
  blue:   { B: '#1d4ed8', L: '#60a5fa', H: '#1e3a8a', W: '#2563eb', T: '#93c5fd', D: '#1e3a8a', A: '#fde047', E: '#1c1917' },
  red:    { B: '#b91c1c', L: '#f87171', H: '#7f1d1d', W: '#991b1b', T: '#fca5a5', D: '#450a0a', A: '#f97316', E: '#1c1917' },
  silver: { B: '#cbd5e1', L: '#f1f5f9', H: '#64748b', W: '#94a3b8', T: '#e0f2fe', D: '#475569', A: '#7dd3fc', E: '#1c1917' },
  bronze: { B: '#92400e', L: '#d97706', H: '#78350f', W: '#b45309', T: '#fbbf24', D: '#451a03', A: '#fde047', E: '#1c1917' },
};

/** Déduit le type de dragon depuis un id de familier (ex. "dragon.red" → "red"), sinon null. */
export function dragonKindFromId(id: string): DragonKind | null {
  const m = /^dragon\.(\w+)/i.exec(id);
  const kind = m?.[1]?.toLowerCase();
  return kind && kind in PALETTES ? (kind as DragonKind) : null;
}

export function DragonSkin({ kind, size = 48 }: { kind: DragonKind; size?: number }) {
  const palette = PALETTES[kind];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated', flexShrink: 0 }}>
      <defs>
        <radialGradient id={`dragon-glow-${kind}`} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor={palette.B} stopOpacity="0.3" />
          <stop offset="100%" stopColor={palette.B} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="16" height="16" fill={`url(#dragon-glow-${kind})`} />
      {DRAGON_PIXELS.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width="1" height="1" fill={palette[p.c] ?? palette.B} />
      ))}
    </svg>
  );
}
