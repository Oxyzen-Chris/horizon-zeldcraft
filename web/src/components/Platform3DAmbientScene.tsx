'use client';

import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoonPhaseInfo, MoonPhaseKey, WorldThemeDef, AudioSourceSetting, AudioSourceKey } from '@/lib/gameState';
import { playAmbientSound, useAdminAudioSettings } from '@/lib/audio';

/**
 * Décor d'ambiance jour/nuit — VERSION 3D (objets Three.js réels dans la scène, PAS une surcouche
 * DOM/CSS) : voir demande utilisateur « il faut que tu crées des objets 3D proches de la réalité
 * dans le widget Plateforme 3D car cela n'a pas de sens de mettre des icônes simples ou 2D dans un
 * environnement tri-dimensionnel ». Remplace l'ancien `Platform3DAmbientOverlay.tsx` (overlay DOM,
 * conservé UNIQUEMENT pour le widget "Mapmonde" qui reste, lui, un plan 2D vu de haut — voir
 * WorldMapAmbientOverlay.tsx, où des icônes restent cohérentes avec le reste du rendu top-down).
 *
 * Style visuel : mêmes conventions "voxel" (primitives Three.js : box/sphere/cone/cylinder,
 * `useFrame` pour l'animation, décalage aléatoire déterministe par créature via `hashSeed`) que
 * `SynkVoxel`/`NpcVoxel`/`DragonMarker` dans Platform3DWidget.tsx, pour rester visuellement
 * cohérent avec le reste du jeu (esprit Minecraft Dungeons/voxel) plutôt que d'importer des modèles
 * 3D externes tiers (risque de droit d'auteur/licence incertaine, hors de portée sans pipeline
 * d'assets dédié — voir ROADMAP.md § Phase 3 sur le choix React Three Fiber natif).
 *
 * Lune/soleil/étoiles sont des éléments de "skybox" positionnés loin de la caméra (comme dans la
 * quasi-totalité des moteurs 3D, où le ciel ne suit pas la translation du joueur) ; les créatures
 * terrestres/volantes (hibou, loup-garou, chauve-souris, rapaces, oiseaux, sangliers, sorcière)
 * évoluent, elles, dans le volume visible autour de Synk.
 */

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Enveloppe les éléments de "remplissage" du ciel (étoiles, étoile filante, nuages, pluie, lune,
 * soleil) à une position FIXE dans le monde (ancrée sur l'origine locale de Synk, qui ne bouge
 * jamais — voir plus bas).
 *
 * 🔧 RÉGRESSION #4 (celle-ci remplace une version antérieure qui translatait AVEC la caméra) :
 * l'utilisateur a signalé qu'en dézoomant ou en tournant la caméra (plage de zoom élargie par le
 * correctif caméra précédent, 1,3-20 unités au lieu de 3-11), « la lune comme le soleil se
 * retrouve au milieu du décor », « planté dans le décor », et « les étoiles passent au-dessus du
 * château [...] alors qu'ils devraient être derrière en arrière-plan peu importe la rotation de la
 * caméra ». Cause : cette version précédente faisait translater le groupe avec `camera.position`
 * (jamais tourner) — une technique de "skybox à parallaxe quasi nulle" qui semblait fonctionner
 * tant que la caméra restait proche de sa position par défaut, mais qui recale en réalité la
 * position ABSOLUE de la lune/des étoiles à chaque déplacement de la caméra (zoom OU orbite) : à
 * une distance de zoom différente ou un angle d'orbite différent, la même ancre locale (ex.
 * `MOON_ANCHOR`) retombe à un endroit du monde plus proche du décor (voire dedans), au lieu de
 * rester à distance constante du décor (qui est, lui, positionné par rapport à Synk/l'origine, pas
 * par rapport à la caméra).
 *
 * Correctif : Synk étant TOUJOURS rendu à l'origine locale `[0, y, 0]` (le monde défile autour de
 * lui, voir `Platform3DWidget.tsx`), une position vraiment FIXE dans le monde revient à une
 * position fixe par rapport à Synk — il suffit donc de ne plus jamais déplacer ce groupe (identité,
 * aucune translation) et d'éloigner suffisamment chaque ancre (voir `SKY_SAFE_MIN_DISTANCE`
 * ci-dessous) pour qu'elle reste, par construction géométrique, toujours plus profonde que le
 * décor (rayon max `VIEW_RADIUS≈7` tuiles, soit ≈9,9 unités en diagonale) et que la caméra elle-même
 * (distance max désormais 20, voir `Platform3DWidget.tsx::CAMERA_MAX_DISTANCE`) ne peut jamais la
 * dépasser. Conséquence acceptée : la lune/le soleil (ancres ponctuelles, pas une distribution
 * omnidirectionnelle) peuvent sortir du cadre si le joueur oriente la caméra à l'opposé — comportement
 * RÉALISTE (comme un vrai ciel), et ce n'était pas le problème signalé (qui portait sur le mauvais
 * ordre de profondeur, pas sur la disponibilité permanente). Les étoiles/nuages restent, eux,
 * répartis sur 360° autour de l'origine (voir Starfield3D/Clouds3D ci-dessous) donc toujours
 * visibles dans une partie du ciel quelle que soit l'orientation de la caméra.
 */
function SkyFollowGroup({ children }: { children: ReactNode }) {
  return <group>{children}</group>;
}

// Marge de sécurité géométrique (voir commentaire de SkyFollowGroup ci-dessus) : distance minimale
// (depuis l'origine/Synk) à laquelle un élément de ciel DOIT être placé pour ne jamais pouvoir être
// dépassé par la caméra (`CAMERA_MAX_DISTANCE=20`, `Platform3DWidget.tsx`) ni par le décor le plus
// éloigné (`VIEW_RADIUS≈7` tuiles ⇒ ≈9,9 unités en diagonale) — avec une marge confortable.
const SKY_SAFE_MIN_DISTANCE = 40;

// ─────────────────────────────── Texture lune (canvas → phases réelles) ───────────────────────
const MOON_ILLUM: Record<MoonPhaseKey, number> = {
  new: 0, waxing_crescent: 0.25, first_quarter: 0.5, waxing_gibbous: 0.75,
  full: 1, waning_gibbous: 0.75, last_quarter: 0.5, waning_crescent: 0.25,
};
const MOON_WAXING: Record<MoonPhaseKey, boolean> = {
  new: true, waxing_crescent: true, first_quarter: true, waxing_gibbous: true,
  full: true, waning_gibbous: false, last_quarter: false, waning_crescent: false,
};
const moonTextureCache = new Map<string, THREE.CanvasTexture>();
/** Dessine la phase de lune EXACTE (croissant/quartier/gibbeuse/pleine/nouvelle) via l'algorithme
 * classique du "terminateur elliptique" : disque plein assombri en base, demi-disque éclairé du
 * côté croissant/décroissant, puis une ellipse ajoute (phase gibbeuse) ou retire (phase croissant)
 * de la lumière selon la fraction illuminée — voir MOON_ILLUM/MOON_WAXING ci-dessus. Teinte
 * cuivrée en "lune rousse" (voir demande utilisateur, `isLuneRousseWindow` dans gameState.ts). */
function getMoonTexture(phase: MoonPhaseKey, luneRousse: boolean): THREE.CanvasTexture {
  const cacheKey = `${phase}:${luneRousse}`;
  const cached = moonTextureCache.get(cacheKey);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const darkColor = '#1e2333';
  const lightColor = luneRousse ? '#f2c9a0' : '#f5f2e6';
  ctx.fillStyle = darkColor;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  const illum = MOON_ILLUM[phase];
  const dir = MOON_WAXING[phase] ? 1 : -1;
  if (illum > 0) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, dir < 0);
    ctx.closePath();
    ctx.fill();
    const rx = Math.abs(illum - 0.5) * 2 * r;
    if (illum > 0.5) {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2); ctx.fill();
    } else if (illum < 0.5) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Quelques cratères discrets pour le relief.
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    [[cx - 22, cy - 8, 8], [cx + 14, cy + 16, 6], [cx - 4, cy + 26, 5], [cx + 20, cy - 20, 5]].forEach(([x, y, rr]) => {
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  moonTextureCache.set(cacheKey, tex);
  return tex;
}

// Position FIXE de la lune/du soleil (voir Sun3D ci-dessous), au sein de `SkyFollowGroup` (qui ne
// translate plus du tout depuis la régression #4, voir commentaire détaillé plus haut — il s'agit
// donc d'une position ABSOLUE dans le monde, ancrée par rapport à Synk/l'origine).
// 🔧 CORRECTIF (régression #1) : une première tentative avait placé l'ancre à très haute altitude/
// distance (y=18, ~33 unités) — hors du champ de vision par défaut (plus aucune lune/soleil
// visible, y compris en se déplaçant).
// 🔧 CORRECTIF (régression #2, cf. capture utilisateur « je ne vois que la base grisée du cercle
// tout en haut du widget ») : la 2e tentative (y=6-6.5, ~14 unités de distance) restait ENCORE hors
// cadre par défaut. Calcul precis via la géométrie de la caméra `Platform3DWidget.tsx`
// (`position:[0,3.2,5.6]`, `fov:45°`, `OrbitControls target:[0,0.3,0]`, donc axe de visée penché
// ~27° VERS LE BAS) : le champ de vision vertical ne couvre que ±22,5° autour de cet axe déjà
// incliné vers le sol — un point à la fois ÉLEVÉ (grand Y) ET LOINTAIN (grand |Z|) sort
// nécessairement de ce cône. Ancre recalculée à ~19° de l'axe de visée (Az≈-8, y≈2).
// 🔧 CORRECTIF (régression #3, cf. « la lune doit être en arrière-plan [...] pas devant ») : ancre
// repoussée à Az=-16/-15 pour rester plus profonde que le décor (portée max ~7 tuiles) — mais
// toujours positionnée par TRANSLATION AVEC LA CAMÉRA (voir ancienne version de `SkyFollowGroup`).
// 🔧 CORRECTIF (régression #4, cf. « en dézoomant [...] la lune [...] se retrouve au milieu du
// décor [...] planté dans le décor [...] devraient être derrière en arrière-plan peu importe la
// rotation de la caméra ») : la régression #3 restait valable uniquement pour un zoom/angle proche
// des réglages par défaut de l'époque (`maxDistance=11`) — une fois le zoom élargi à 20 (voir
// correctif caméra "lever la tête"), une ancre à seulement ~16 unités de la caméra pouvait se
// retrouver, selon le zoom/l'angle d'orbite courant, plus proche que le décor lui-même (la
// translation suivait `camera.position`, qui varie beaucoup plus largement désormais). Solution :
// l'ancre devient une position ABSOLUE fixe (plus de translation du tout, voir `SkyFollowGroup`),
// recalculée à une distance ≥ `SKY_SAFE_MIN_DISTANCE` (40) de l'origine — garantissant
// géométriquement qu'elle reste toujours plus profonde que le décor (≤~9,9 unités) ET que la
// portée maximale de la caméra (20 unités), quels que soient le zoom/l'angle. Direction conservée
// identique à l'ancienne ancre relative à la caméra par défaut (pour ne pas changer le cadrage par
// défaut), simplement étendue à une distance ~4,3× plus grande (~68-70 unités depuis l'origine) ;
// rayons agrandis dans la même proportion (voir Moon3D/Sun3D ci-dessous) pour conserver une taille
// apparente cohérente à l'écran.
const MOON_ANCHOR: [number, number, number] = [-18, 7, -67];
const SUN_ANCHOR: [number, number, number] = [21, 8, -63];

function Moon3D({ phase }: { phase: MoonPhaseInfo }) {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => getMoonTexture(phase.key, phase.isLuneRousse), [phase.key, phase.isLuneRousse]);
  // Seule l'ORIENTATION (billboard face-caméra, pour que le disque plat reste toujours visible de
  // face) est recalculée chaque frame — jamais la POSITION, qui reste celle de MOON_ANCHOR ci-dessus
  // (fixe dans le repère de SkyFollowGroup, donc fixe dans le monde par rapport à Synk).
  useFrame(({ camera }) => { groupRef.current?.lookAt(camera.position); });
  return (
    <group ref={groupRef} position={MOON_ANCHOR}>
      <mesh position={[0, 0, -0.02]}>
        <circleGeometry args={[8.6, 28]} />
        <meshBasicMaterial color={phase.isLuneRousse ? '#f2c9a0' : '#bfdbfe'} transparent opacity={0.14} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[6.0, 32]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite />
      </mesh>
    </group>
  );
}

// ─────────────────────────────── Soleil ───────────────────────────────
let sunTextureCache: THREE.CanvasTexture | null = null;
function getSunGlowTexture(): THREE.CanvasTexture {
  if (sunTextureCache) return sunTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,250,220,0.95)');
  grad.addColorStop(0.35, 'rgba(255,225,140,0.55)');
  grad.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sunTextureCache = new THREE.CanvasTexture(canvas);
  return sunTextureCache;
}
function Sun3D() {
  const groupRef = useRef<THREE.Group>(null);
  const tex = useMemo(getSunGlowTexture, []);
  // Même position FIXE (SUN_ANCHOR, voir commentaire détaillé sur MOON_ANCHOR ci-dessus) — seule
  // l'orientation billboard est mise à jour chaque frame, jamais la position.
  useFrame(({ camera }) => { groupRef.current?.lookAt(camera.position); });
  return (
    <group ref={groupRef} position={SUN_ANCHOR}>
      <mesh>
        <circleGeometry args={[13.8, 28]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <circleGeometry args={[4.3, 24]} />
        <meshBasicMaterial color="#fff8dc" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ─────────────────────────────── Ciel étoilé + étoile filante ───────────────────────────────
function Starfield3D() {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    // Distribution sur 360° d'azimut autour de l'origine (au lieu d'une boîte orientée uniquement
    // face à la caméra par défaut) — garantit qu'il y a toujours des étoiles visibles quel que soit
    // l'angle/zoom de la caméra (corrige le bug « quand je tourne l'angle de vue [...] il n'y a
    // plus rien dans le ciel »). 🔧 Régression #4 : rayon/altitude repoussés très au-delà de
    // `SKY_SAFE_MIN_DISTANCE` (40, voir `SkyFollowGroup`) — les étoiles sont désormais des points
    // fixes du monde (plus de translation avec la caméra), il faut donc qu'elles soient
    // intrinsèquement assez loin de l'origine pour rester toujours plus profondes que le décor et
    // la caméra, quel que soit le zoom/l'angle d'orbite (au lieu de ~6-16 unités, qui pouvait finir
    // plus proche de la caméra que le décor une fois le zoom élargi à 20).
    const count = 320;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 42 + Math.random() * 22;
      pos[i * 3 + 0] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = 14 + Math.random() * 24;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
    }
    return pos;
  }, []);
  useFrame((state) => {
    const mat = pointsRef.current?.material as THREE.PointsMaterial | undefined;
    if (mat) mat.opacity = 0.6 + Math.sin(state.clock.elapsedTime * 0.6) * 0.18;
  });
  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.28} color="#f8fafc" transparent opacity={0.75} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function ShootingStar3D() {
  const groupRef = useRef<THREE.Group>(null);
  const state = useRef({ active: false, start: 0, nextAt: 2 + Math.random() * 6, from: new THREE.Vector3(), to: new THREE.Vector3() });
  // 🔧 Trajectoire remontée plus HAUT et plus LOIN dans le ciel (demande utilisateur : « fait en
  // sorte que les étoiles filantes passent au-dessus dans le ciel et au lointain »), puis repoussée
  // ENCORE plus loin lors de la régression #4 (voir `SkyFollowGroup`/`SKY_SAFE_MIN_DISTANCE`) pour
  // rester, comme les étoiles fixes/la lune/le soleil, toujours au-delà du décor et de la portée de
  // la caméra — rayon/altitude/amplitude du déplacement mis à l'échelle en conséquence (~×3) pour
  // conserver une trajectoire/trainée visuellement significative à cette distance accrue.
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const st = state.current;
    if (!st.active && t > st.nextAt) {
      st.active = true; st.start = t;
      const angle = Math.random() * Math.PI * 2;
      const radius = 46 + Math.random() * 16;
      st.from.set(Math.cos(angle) * radius, 24 + Math.random() * 8, Math.sin(angle) * radius);
      st.to.copy(st.from).add(new THREE.Vector3((Math.random() - 0.5) * 30 - Math.cos(angle) * 12, -3.6 - Math.random() * 2.4, (Math.random() - 0.5) * 30 - Math.sin(angle) * 12));
    }
    if (!groupRef.current) return;
    if (!st.active) { groupRef.current.visible = false; return; }
    const elapsed = t - st.start, dur = 1.1;
    if (elapsed > dur) {
      st.active = false; st.nextAt = t + 9 + Math.random() * 14;
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;
    const p = elapsed / dur;
    groupRef.current.position.lerpVectors(st.from, st.to, p);
    const mesh = groupRef.current.children[0] as THREE.Mesh | undefined;
    const mat = mesh?.material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85);
  });
  return (
    <group ref={groupRef} visible={false}>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.05, 0.05, 3.3, 5]} />
        <meshBasicMaterial color="#fefce8" transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// ─────────────────────────────── Nuages ───────────────────────────────
function Cloud3D({ seed, x0, z0, y }: { seed: number; x0: number; z0: number; y: number }) {
  const ref = useRef<THREE.Group>(null);
  const speed = 0.12 + (seed % 5) * 0.025;
  useFrame((state) => {
    if (!ref.current) return;
    const span = 90;
    const drift = ((state.clock.elapsedTime * speed + seed * 3.3) % span) - span / 2;
    ref.current.position.x = x0 + drift;
  });
  const puffs = useMemo(() => {
    const n = 4 + (seed % 3);
    return Array.from({ length: n }, (_, i) => ({
      x: i * 0.55 - (n * 0.55) / 2 + Math.sin(seed + i) * 0.1,
      s: 0.55 + ((seed * 13 + i * 7) % 10) / 22,
    }));
  }, [seed]);
  return (
    <group ref={ref} position={[x0, y, z0]} scale={4.2}>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, 0, 0]} scale={[p.s, p.s * 0.62, p.s]}>
          <sphereGeometry args={[0.62, 8, 6]} />
          <meshStandardMaterial color="#f1f5f9" transparent opacity={0.82} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}
function Clouds3D() {
  // 8 nuages répartis sur 360° d'azimut (au lieu de 4 uniquement face à la caméra par défaut) —
  // corrige le même bug que Starfield3D/Rain3D ci-dessus/dessous : le ciel se vidait au dézoom/à la
  // rotation. 🔧 Régression #4 : rayon/altitude repoussés au-delà de `SKY_SAFE_MIN_DISTANCE` (voir
  // `SkyFollowGroup`) et mis à l'échelle (×4,2, voir `Cloud3D`) pour rester toujours derrière le
  // décor tout en restant visuellement lisibles à cette distance accrue. `x0`/`z0` fixent l'azimut
  // de dérive de chaque nuage (voir Cloud3D).
  return <>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const angle = (i / 8) * Math.PI * 2;
    const radius = 44 + (i % 3) * 8;
    return <Cloud3D key={i} seed={i * 37 + 11} x0={Math.cos(angle) * radius} z0={Math.sin(angle) * radius} y={15 + (i % 2) * 3} />;
  })}</>;
}

// ─────────────────────────────── Pluie ───────────────────────────────
function Rain3D() {
  const ref = useRef<THREE.Points>(null);
  const count = 180;
  const { positions, speeds } = useMemo(() => {
    // Distribution sur une zone circulaire pleine (360°) autour de l'origine — voir Starfield3D/
    // Clouds3D ci-dessus pour le même correctif (ancienne boîte orientée uniquement face à la
    // caméra par défaut, invisible dès rotation/dézoom).
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 9;
      pos[i * 3 + 0] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      spd[i] = 4.5 + Math.random() * 3;
    }
    return { positions: pos, speeds: spd };
  }, []);
  useFrame((_state, delta) => {
    const geo = ref.current?.geometry;
    if (!geo) return;
    const attr = geo.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speeds[i] * delta;
      if (arr[i * 3 + 1] < -1) arr[i * 3 + 1] = 4;
    }
    attr.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.045} color="#93c5fd" transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// ─────────────────────────────── Aide : joue un son d'ambiance périodique déphasé ───────────────────────────────
function useAmbientSoundCycle(key: AudioSourceKey, intervalSec: number, seedOffset: number, onTrigger: () => void, adminSettings: Record<AudioSourceKey, AudioSourceSetting>, enabled: boolean = true) {
  const lastCycleRef = useRef(-1);
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime + seedOffset;
    const cycle = Math.floor(t / intervalSec);
    if (cycle !== lastCycleRef.current) {
      lastCycleRef.current = cycle;
      onTrigger();
      playAmbientSound(key, adminSettings);
    }
  });
}

// ─────────────────────────────── Hibou (posé, hulule parfois) ───────────────────────────────
/**
 * Depuis la conversion du hibou/loup-garou en faune errante réelle (voir lib/roamingActors.ts::
 * WildlifeActorState/ensureWildlifeSpawns, et Platform3DWidget.tsx::MarkerBlock::isWildlife), ce
 * composant N'A PLUS de position locale fixe : il est désormais positionné/orienté par le groupe
 * parent (MarkerBlock), au même titre qu'un PNJ/familier errant. `seedKey` (id d'errance unique,
 * ex. "owl-3") permet de déphaser le cycle de hululement de chaque instance (au lieu qu'elles
 * hululent toutes en même temps), et `soundEnabled` reprend le réglage Administration du thème
 * (WorldThemeDef.elements.owlHootEnabled) qui gate UNIQUEMENT le cycle sonore — jamais la présence
 * ou le déplacement de la créature (voir demande utilisateur : « seulement les PNJ à proximité [...]
 * doivent clignoter [...] » appliquée par analogie : la faune doit exister/se déplacer en continu).
 */
export function Owl3D({ adminAudio, soundEnabled = true, seedKey, moving }: {
  adminAudio: Record<AudioSourceKey, AudioSourceSetting>; soundEnabled?: boolean; seedKey?: string; moving?: boolean;
}) {
  const headRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null); // permet le tangage/l'altitude de vol, voir useFrame
  const hootRef = useRef(0); // timestamp (elapsedTime) du dernier hululement, pour l'animation de tête
  const seedOffset = useMemo(() => (hashSeed(seedKey || 'owl') % 1000) / 100, [seedKey]);
  useAmbientSoundCycle('owl', 22, seedOffset, () => { hootRef.current = performance.now() / 1000; }, adminAudio, soundEnabled);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const sinceHoot = t - hootRef.current;
    const hooting = sinceHoot < 1.2;
    // En vol (`moving`) : grand battement d'ailes ample et rapide, synchronisé avec le déplacement —
    // corrige la demande utilisateur « il doit voler, déployer ses ailes [...] fait en sorte qu'il
    // batte des ailes tout en étant synchronisé avec son déplacement ». Posé : ailes repliées, léger
    // ruffle de vie occasionnellement accentué par un hululement (`hooting`).
    const flapFreq = moving ? 9 : 2.4;
    const flapAmp = moving ? 0.95 : 0.05;
    const baseAngle = moving ? 0.12 : 0.25;
    const flap = Math.sin(t * flapFreq) * flapAmp + (hooting ? Math.sin(t * 14) * 0.18 : 0);
    if (wingLRef.current) wingLRef.current.rotation.z = baseAngle + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -baseAngle - flap;
    if (headRef.current) headRef.current.rotation.x = hooting ? Math.sin(sinceHoot * 6) * 0.18 : Math.sin(t * 0.8) * 0.05;
    // Légère prise d'altitude + tangage vers l'avant en vol (posture de vol crédible), corps stable
    // et posé une fois immobile.
    if (bodyRef.current) {
      bodyRef.current.position.y = moving ? 0.95 + Math.sin(t * flapFreq * 0.5) * 0.05 : 0.7;
      bodyRef.current.rotation.x = moving ? -0.18 + Math.sin(t * flapFreq) * 0.05 : 0;
    }
  });
  return (
    <group>
      {/* Perchoir (petit poteau de bois) — masqué en vol : corrige la demande utilisateur « il
          pourra effectivement se poser quelques instants sur un morceau de bois mais quand il
          repart [...] le bâton [...] ne doit pas le suivre » (le perchoir reste un décor immobile,
          il n'est plus rendu tant que le hibou est en déplacement). */}
      {!moving && (
        <mesh position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.05, 0.06, 0.64, 6]} /><meshStandardMaterial color="#5b4636" roughness={0.9} /></mesh>
      )}
      <group ref={bodyRef} position={[0, 0.7, 0]}>
        {/* Corps ovoïde */}
        <mesh castShadow scale={[0.85, 1, 0.8]}><sphereGeometry args={[0.22, 10, 8]} /><meshStandardMaterial color="#78716c" roughness={0.8} /></mesh>
        {/* Ventre plus clair */}
        <mesh position={[0, -0.02, 0.14]} scale={[0.6, 0.75, 0.4]}><sphereGeometry args={[0.2, 8, 6]} /><meshStandardMaterial color="#d6d3d1" roughness={0.9} /></mesh>
        <group ref={headRef} position={[0, 0.2, 0.02]}>
          <mesh castShadow><sphereGeometry args={[0.15, 10, 8]} /><meshStandardMaterial color="#78716c" roughness={0.8} /></mesh>
          {/* Grands yeux ronds (caractéristique hibou) */}
          {[-0.06, 0.06].map((ex, i) => (
            <group key={i} position={[ex, 0.02, 0.12]}>
              <mesh><sphereGeometry args={[0.055, 8, 8]} /><meshStandardMaterial color="#fde68a" emissive="#fde68a" emissiveIntensity={0.35} /></mesh>
              <mesh position={[0, 0, 0.045]}><sphereGeometry args={[0.026, 6, 6]} /><meshStandardMaterial color="#1c1917" /></mesh>
            </group>
          ))}
          {/* Bec */}
          <mesh position={[0, -0.04, 0.15]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.035, 0.08, 6]} /><meshStandardMaterial color="#d97706" /></mesh>
          {/* Aigrettes (petites touffes d'oreilles) */}
          {[-0.07, 0.07].map((ex, i) => (
            <mesh key={i} position={[ex, 0.14, -0.01]} rotation={[0.3, 0, ex > 0 ? -0.25 : 0.25]}><coneGeometry args={[0.025, 0.09, 4]} /><meshStandardMaterial color="#57534e" /></mesh>
          ))}
        </group>
        {/* Ailes repliées, s'écartent lors du ruffle ou se déploient largement en vol */}
        <mesh ref={wingLRef} position={[-0.2, -0.02, -0.02]} rotation={[0, 0, 0.25]}><boxGeometry args={[0.09, 0.32, 0.14]} /><meshStandardMaterial color="#57534e" roughness={0.85} /></mesh>
        <mesh ref={wingRRef} position={[0.2, -0.02, -0.02]} rotation={[0, 0, -0.25]}><boxGeometry args={[0.09, 0.32, 0.14]} /><meshStandardMaterial color="#57534e" roughness={0.85} /></mesh>
      </group>
    </group>
  );
}

// ─────────────────────────────── Loup-garou (assis, crie parfois) ───────────────────────────────
/** Voir le commentaire détaillé sur Owl3D ci-dessus (même conversion en faune errante réelle). */
export function Werewolf3D({ adminAudio, soundEnabled = true, seedKey, moving }: {
  adminAudio: Record<AudioSourceKey, AudioSourceSetting>; soundEnabled?: boolean; seedKey?: string; moving?: boolean;
}) {
  const headRef = useRef<THREE.Group>(null);
  const howlRef = useRef(0);
  // 4 pattes (2 avant + 2 arrière, voir demande utilisateur « anime ses 4 pattes proportionnellement
  // à son déplacement afin de rester réaliste » — l'ancienne version n'en affichait que 2).
  const legFLRef = useRef<THREE.Mesh>(null);
  const legFRRef = useRef<THREE.Mesh>(null);
  const legRLRef = useRef<THREE.Mesh>(null);
  const legRRRef = useRef<THREE.Mesh>(null);
  const seedOffset = useMemo(() => (hashSeed(seedKey || 'werewolf') % 1000) / 90, [seedKey]);
  useAmbientSoundCycle('werewolf', 38, seedOffset, () => { howlRef.current = performance.now() / 1000; }, adminAudio, soundEnabled);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const sinceHowl = t - howlRef.current;
    const howling = sinceHowl < 1.8;
    if (headRef.current) headRef.current.rotation.x = howling ? -0.55 + Math.sin(sinceHowl * 10) * 0.04 : Math.sin(t * (moving ? 3 : 0.5)) * 0.06;
    // Démarche au trot (diagonale) : avant-gauche/arrière-droite en phase, avant-droite/
    // arrière-gauche en opposition de phase — amplitude PROPORTIONNELLE au déplacement réel
    // (nulle à l'arrêt, l'angle de base "assis" est alors conservé) plutôt qu'une animation
    // continue indépendante de `moving`.
    const walkFreq = 6.5, walkAmp = 0.55;
    const swingA = moving ? Math.sin(t * walkFreq) * walkAmp : 0;
    const swingB = moving ? Math.sin(t * walkFreq + Math.PI) * walkAmp : 0;
    if (legFLRef.current) legFLRef.current.rotation.x = 0.5 + swingA;
    if (legFRRef.current) legFRRef.current.rotation.x = 0.5 + swingB;
    if (legRLRef.current) legRLRef.current.rotation.x = -0.4 + swingB;
    if (legRRRef.current) legRRRef.current.rotation.x = -0.4 + swingA;
  });
  const fur = '#3f3a36';
  return (
    <group>
      {/* Position assise : bassin bas, torse redressé */}
      <mesh position={[0, 0.22, -0.05]} castShadow><cylinderGeometry args={[0.16, 0.2, 0.28, 8]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <mesh position={[0, 0.5, 0]} castShadow scale={[0.9, 1.1, 0.85]}><sphereGeometry args={[0.19, 10, 8]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <group ref={headRef} position={[0, 0.78, 0.04]}>
        <mesh castShadow scale={[0.9, 0.9, 1.05]}><sphereGeometry args={[0.15, 10, 8]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
        <mesh position={[0, -0.05, 0.16]} castShadow><boxGeometry args={[0.11, 0.09, 0.14]} /><meshStandardMaterial color="#292524" roughness={0.9} /></mesh>
        {/* Oreilles pointues */}
        {[-0.09, 0.09].map((ex, i) => (
          <mesh key={i} position={[ex, 0.13, -0.02]} rotation={[0.15, 0, ex > 0 ? -0.2 : 0.2]}><coneGeometry args={[0.045, 0.13, 4]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
        ))}
        {/* Yeux jaunes luminescents (nuit) */}
        {[-0.05, 0.05].map((ex, i) => (
          <mesh key={i} position={[ex, 0.02, 0.14]}><sphereGeometry args={[0.022, 6, 6]} /><meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={0.8} /></mesh>
        ))}
      </group>
      {/* Pattes avant */}
      <mesh ref={legFLRef} position={[-0.13, 0.1, 0.16]} rotation={[0.5, 0, 0]} castShadow><cylinderGeometry args={[0.045, 0.05, 0.32, 6]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <mesh ref={legFRRef} position={[0.13, 0.1, 0.16]} rotation={[0.5, 0, 0]} castShadow><cylinderGeometry args={[0.045, 0.05, 0.32, 6]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      {/* Pattes arrière (nouvelles — corrige « je devrais voir ses jambes » côté quadrupède : 4
          pattes visibles au lieu de 2) */}
      <mesh ref={legRLRef} position={[-0.13, 0.08, -0.18]} rotation={[-0.4, 0, 0]} castShadow><cylinderGeometry args={[0.05, 0.055, 0.3, 6]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      <mesh ref={legRRRef} position={[0.13, 0.08, -0.18]} rotation={[-0.4, 0, 0]} castShadow><cylinderGeometry args={[0.05, 0.055, 0.3, 6]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
    </group>
  );
}

// ─────────────────────────────── Chauve-souris (essaim volant, nuit) ───────────────────────────────
function Bat3D({ radius, height, speed, phase }: { radius: number; height: number; speed: number; phase: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed + phase;
    if (groupRef.current) {
      const x = Math.cos(t) * radius, z = Math.sin(t) * radius * 0.7 - 6;
      groupRef.current.position.set(x, height + Math.sin(t * 3) * 0.3, z);
      groupRef.current.rotation.y = -t + Math.PI / 2;
    }
    const flap = Math.sin(state.clock.elapsedTime * 16 + phase) * 0.9;
    if (wingLRef.current) wingLRef.current.rotation.z = 0.3 + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.3 - flap;
  });
  return (
    <group ref={groupRef}>
      <mesh castShadow scale={[0.6, 0.6, 0.9]}><sphereGeometry args={[0.07, 6, 6]} /><meshStandardMaterial color="#1c1917" roughness={0.9} /></mesh>
      <mesh ref={wingLRef} position={[-0.06, 0, 0]}><coneGeometry args={[0.16, 0.04, 3]} /><meshStandardMaterial color="#292524" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh ref={wingRRef} position={[0.06, 0, 0]}><coneGeometry args={[0.16, 0.04, 3]} /><meshStandardMaterial color="#292524" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}
function BatsSwarm3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const seedOffset = useMemo(() => (hashSeed('bat') % 1000) / 110, []);
  useAmbientSoundCycle('bat', 17, seedOffset, () => {}, adminAudio);
  return (
    <>
      <Bat3D radius={2.2} height={2.5} speed={0.9} phase={0} />
      <Bat3D radius={1.8} height={2.2} speed={-1.15} phase={2.1} />
      <Bat3D radius={2.6} height={2.8} speed={0.75} phase={4.4} />
    </>
  );
}

// ─────────────────────────────── Rapaces (aigle/vautour/faucon, tournoient, jour) ───────────────────────────────
function Raptor3D({ radius, height, speed, phase, size, color }: { radius: number; height: number; speed: number; phase: number; size: number; color: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed + phase;
    if (groupRef.current) {
      const x = Math.cos(t) * radius, z = Math.sin(t) * radius - 7;
      groupRef.current.position.set(x, height, z);
      groupRef.current.rotation.y = -t + Math.PI / 2;
      // Virage penché (banking) façon planeur, plus réaliste qu'un vol parfaitement à plat.
      groupRef.current.rotation.z = 0.28 * Math.sign(speed);
    }
    // Battement d'ailes lent (plané, pas un battement d'oiseau rapide) + petit flottement.
    const glide = Math.sin(state.clock.elapsedTime * 1.1 + phase) * 0.06;
    if (wingLRef.current) wingLRef.current.rotation.z = 0.08 + glide;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.08 - glide;
  });
  return (
    <group ref={groupRef} scale={size}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.06, 0.18, 4, 8]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      <mesh position={[0, 0, 0.14]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.04, 0.09, 6]} /><meshStandardMaterial color="#eab308" /></mesh>
      <mesh ref={wingLRef} position={[-0.05, 0, 0]}><boxGeometry args={[0.42, 0.02, 0.14]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
      <mesh ref={wingRRef} position={[0.05, 0, 0]}><boxGeometry args={[0.42, 0.02, 0.14]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
      <mesh position={[0, 0, -0.16]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.06, 0.14, 3]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
    </group>
  );
}
function RaptorsFlock3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const seedOffset = useMemo(() => (hashSeed('raptor') % 1000) / 100, []);
  useAmbientSoundCycle('raptor', 26, seedOffset, () => {}, adminAudio);
  return (
    <>
      <Raptor3D radius={2.2} height={2.6} speed={0.55} phase={0} size={1.15} color="#78350f" />
      <Raptor3D radius={1.8} height={2.3} speed={-0.7} phase={2.6} size={0.85} color="#57534e" />
    </>
  );
}

// ─────────────────────────────── Oiseaux/hirondelles (petit vol groupé, jour) ───────────────────────────────
function Bird3D({ radius, height, speed, phase, color }: { radius: number; height: number; speed: number; phase: number; color: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed + phase;
    if (groupRef.current) {
      const x = Math.cos(t) * radius, z = Math.sin(t * 1.3) * radius * 0.6 - 6.5;
      groupRef.current.position.set(x, height + Math.sin(t * 2) * 0.4, z);
      groupRef.current.rotation.y = -t + Math.PI / 2;
    }
    const flap = Math.sin(state.clock.elapsedTime * 11 + phase) * 0.7;
    if (wingLRef.current) wingLRef.current.rotation.z = 0.2 + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.2 - flap;
  });
  return (
    <group ref={groupRef}>
      <mesh castShadow scale={[0.7, 0.7, 1.1]}><sphereGeometry args={[0.045, 6, 6]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
      <mesh ref={wingLRef} position={[-0.03, 0, 0]}><coneGeometry args={[0.08, 0.025, 3]} /><meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} /></mesh>
      <mesh ref={wingRRef} position={[0.03, 0, 0]}><coneGeometry args={[0.08, 0.025, 3]} /><meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}
function BirdsFlock3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const seedOffset = useMemo(() => (hashSeed('bird') % 1000) / 130, []);
  useAmbientSoundCycle('bird', 14, seedOffset, () => {}, adminAudio);
  const flock = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    radius: 1.4 + (i % 3) * 0.35, height: 2.2 + (i % 2) * 0.4, speed: 1.3 + i * 0.12, phase: i * 1.3,
    color: i % 2 === 0 ? '#1e293b' : '#334155',
  })), []);
  return <>{flock.map((b, i) => <Bird3D key={i} {...b} />)}</>;
}

// ─────────────────────────────── Troupeau de sangliers + marcassins (marche au sol, jour) ───────────────────────────────
function Boar3D({ x0, z0, scale, speedMul, color, phase }: { x0: number; z0: number; scale: number; speedMul: number; color: string; phase: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const legFLRef = useRef<THREE.Group>(null);
  const legFRRef = useRef<THREE.Group>(null);
  const legBLRef = useRef<THREE.Group>(null);
  const legBRRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.5 * speedMul + phase;
    const span = 11;
    const x = ((t % span) - span / 2) + x0;
    if (groupRef.current) {
      groupRef.current.position.set(x, 0, z0);
      groupRef.current.rotation.y = speedMul >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const swing = Math.sin(state.clock.elapsedTime * 7 * Math.abs(speedMul) + phase) * 0.45;
    if (legFLRef.current) legFLRef.current.rotation.x = swing;
    if (legBRRef.current) legBRRef.current.rotation.x = swing;
    if (legFRRef.current) legFRRef.current.rotation.x = -swing;
    if (legBLRef.current) legBLRef.current.rotation.x = -swing;
  });
  return (
    <group ref={groupRef} scale={scale}>
      <mesh castShadow position={[0, 0.26, 0]}><sphereGeometry args={[0.22, 10, 8]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
      <group position={[0.2, 0.28, 0]}>
        <mesh castShadow><sphereGeometry args={[0.13, 8, 8]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
        <mesh position={[0.1, -0.03, 0]} castShadow><coneGeometry args={[0.06, 0.14, 6]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>
        {[-0.045, 0.045].map((ez, i) => (
          <mesh key={i} position={[0.14, -0.06, ez]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.014, 0.05, 4]} /><meshStandardMaterial color="#e7e5e4" /></mesh>
        ))}
        {[-0.06, 0.06].map((ez, i) => (
          <mesh key={i} position={[0.08, 0.06, ez]}><sphereGeometry args={[0.02, 6, 6]} /><meshStandardMaterial color="#1c1917" /></mesh>
        ))}
      </group>
      {/* Crinière hérissée sur le dos */}
      {[-0.08, 0, 0.08].map((ex, i) => (
        <mesh key={i} position={[ex, 0.44, 0]} rotation={[0, 0, 0.1 * i]}><coneGeometry args={[0.025, 0.09, 4]} /><meshStandardMaterial color="#292524" /></mesh>
      ))}
      {([
        { ref: legFLRef, x: 0.13, z: 0.11 }, { ref: legFRRef, x: 0.13, z: -0.11 },
        { ref: legBLRef, x: -0.13, z: 0.11 }, { ref: legBRRef, x: -0.13, z: -0.11 },
      ] as const).map((leg, i) => (
        <group key={i} ref={leg.ref} position={[leg.x, 0.16, leg.z]}>
          <mesh position={[0, -0.08, 0]} castShadow><cylinderGeometry args={[0.028, 0.032, 0.16, 6]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>
        </group>
      ))}
    </group>
  );
}
function BoarHerd3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const seedOffset = useMemo(() => (hashSeed('boar') % 1000) / 105, []);
  useAmbientSoundCycle('boar', 21, seedOffset, () => {}, adminAudio);
  return (
    <>
      <Boar3D x0={0} z0={-4.5} scale={1} speedMul={1} color="#4a3728" phase={0} />
      <Boar3D x0={-0.9} z0={-4.8} scale={0.55} speedMul={1} color="#8a6d4f" phase={0.3} />
      <Boar3D x0={-1.5} z0={-4.3} scale={0.5} speedMul={1} color="#8a6d4f" phase={0.6} />
    </>
  );
}

// ─────────────────────────────── Sorcière volante sur balai (passages périodiques, sifflote) ───────────────────────────────
/**
 * 🔧 Passages PÉRIODIQUES (au lieu d'un aller-retour continu toutes les ~34 s dans un petit
 * périmètre proche du sol) — corrige la demande utilisateur : « as-tu ajouté la sorcière en 3D sur
 * son balai car je ne la vois pas passer dans le ciel au lointain ? [...] fait la passer dans les
 * nuages et devant la lune toutes les 10 minutes ». Réutilise `useAmbientSoundCycle` (même
 * mécanisme que le hululement de hibou/cri de loup-garou) pour déclencher un survol toutes les
 * `intervalSec` secondes (`WorldThemeElements.witchFlybyIntervalSec`, défaut 600 = 10 min,
 * paramétrable par thème en Administration) : au déclenchement, la sorcière devient visible et
 * traverse le ciel lointain en `FLIGHT_DURATION_SEC` secondes, à une altitude/profondeur proche de
 * `MOON_ANCHOR`/`SUN_ANCHOR` (voir plus haut) — passant ainsi visiblement devant/derrière les
 * nuages (`Clouds3D`) et à proximité immédiate de la lune/du soleil — puis redevient invisible
 * jusqu'au prochain cycle. `playAmbientSound('witch', ...)` (sifflement) est déclenché par
 * `useAmbientSoundCycle` au tout début de chaque survol.
 */
const WITCH_FLIGHT_DURATION_SEC = 14;
function Witch3D({ adminAudio, intervalSec }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting>; intervalSec: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const robeRef = useRef<THREE.Mesh>(null);
  const seedOffset = useMemo(() => (hashSeed('witch') % 1000) / 95, []);
  const flight = useRef({ active: false, start: 0 });
  useAmbientSoundCycle('witch', Math.max(30, intervalSec), seedOffset, () => { flight.current.active = true; flight.current.start = -1; }, adminAudio);
  useFrame((state) => {
    const f = flight.current;
    if (!f.active) { if (groupRef.current) groupRef.current.visible = false; return; }
    if (f.start < 0) f.start = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - f.start;
    if (elapsed > WITCH_FLIGHT_DURATION_SEC) { f.active = false; if (groupRef.current) groupRef.current.visible = false; return; }
    if (!groupRef.current) return;
    groupRef.current.visible = true;
    const p = elapsed / WITCH_FLIGHT_DURATION_SEC; // 0 → 1 sur toute la traversée
    // 🔧 Régression #4 : balayage/profondeur repoussés (×~4,3, voir MOON_ANCHOR/SUN_ANCHOR) pour
    // rester cohérente avec la nouvelle distance, bien plus grande, de la lune/du soleil — sinon
    // elle apparaîtrait bien plus proche/grande que ces derniers, rompant l'effet "silhouette
    // lointaine passant devant la lune".
    const span = 112; // largeur du balayage — traverse aussi bien MOON_ANCHOR.x (-18) que SUN_ANCHOR.x (21)
    const x = -span / 2 + span * p;
    groupRef.current.position.set(x, 7 + Math.sin(p * Math.PI) * 4.7, -65 + Math.sin(p * Math.PI * 2) * 6);
    groupRef.current.rotation.y = Math.PI / 2;
    groupRef.current.rotation.z = 0.12 * Math.sin(elapsed * 2);
    if (robeRef.current) robeRef.current.rotation.x = 0.15 + Math.sin(elapsed * 3) * 0.05;
  });
  return (
    // 🔧 Mise à l'échelle ×5,3 (régression #3) puis ×22,8 (régression #4, ×4,3 supplémentaire — voir
    // commentaire sur le balayage ci-dessus) pour suivre le recalibrage de MOON_ANCHOR/SUN_ANCHOR
    // (distance repoussée de ~16 à ~65-67 unités, désormais fixe/absolue — voir SkyFollowGroup) :
    // sans cette mise à l'échelle, sa silhouette serait, à cette distance, strictement invisible en
    // pratique. `emissive` ajouté sur la robe/le chapeau pour qu'elle reste visible en silhouette
    // même sans lumière directe (comme éclairée par la lune), au lieu de sombre-sur-sombre.
    <group ref={groupRef} visible={false} scale={22.8}>
      {/* Balai */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.02, 0.02, 0.9, 6]} /><meshStandardMaterial color="#a16207" roughness={0.9} /></mesh>
      <mesh position={[-0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.09, 0.22, 8]} /><meshStandardMaterial color="#ca8a04" roughness={1} /></mesh>
      {/* Corps assis à califourchon */}
      <mesh ref={robeRef} position={[0.05, 0.14, 0]} castShadow><coneGeometry args={[0.16, 0.34, 8]} /><meshStandardMaterial color="#3b0764" emissive="#3b0764" emissiveIntensity={0.55} roughness={0.85} /></mesh>
      <mesh position={[0.05, 0.32, 0]} castShadow><sphereGeometry args={[0.1, 10, 8]} /><meshStandardMaterial color="#f2c9a0" emissive="#f2c9a0" emissiveIntensity={0.25} roughness={0.7} /></mesh>
      {/* Chapeau pointu à large bord */}
      <mesh position={[0.05, 0.42, 0]}><cylinderGeometry args={[0.13, 0.13, 0.015, 12]} /><meshStandardMaterial color="#44403c" emissive="#44403c" emissiveIntensity={0.4} roughness={0.9} /></mesh>
      <mesh position={[0.05, 0.55, 0]}><coneGeometry args={[0.08, 0.24, 8]} /><meshStandardMaterial color="#57534e" emissive="#57534e" emissiveIntensity={0.4} roughness={0.9} /></mesh>
    </group>
  );
}

/** Composant racine — voir useWorldThemeAmbience() (isNight/theme/moonPhase, source unique de
 * vérité partagée avec WeatherPanel.tsx/WorldMapWidget.tsx). Rendu comme enfant direct de
 * `<Canvas>` (voir Platform3DWidget.tsx), PAS comme overlay DOM. */
export function Platform3DAmbientScene({ theme, moonPhase }: { isNight: boolean; theme: WorldThemeDef | null; moonPhase: MoonPhaseInfo | null }) {
  const adminAudio = useAdminAudioSettings();
  const elements = theme?.elements;
  if (!elements) return null;
  return (
    <group>
      {/* Éléments de "remplissage" du ciel — regroupés dans SkyFollowGroup (translation-only, voir
          plus haut) pour rester visibles quels que soient l'angle de vue et le zoom de la caméra. */}
      <SkyFollowGroup>
        {elements.stars && <Starfield3D />}
        {elements.shootingStarsEnabled && <ShootingStar3D />}
        {elements.clouds && <Clouds3D />}
        {elements.rainChancePct > 0 && Math.random() * 100 < elements.rainChancePct && <Rain3D />}
        {/* Lune/soleil à position FIXE (voir MOON_ANCHOR/SUN_ANCHOR) rendus DANS SkyFollowGroup afin
            de translater avec Synk (mais jamais tourner avec la caméra) — voir commentaire détaillé
            sur Moon3D ci-dessus. */}
        {elements.moon && moonPhase && <Moon3D phase={moonPhase} />}
        {elements.sun && <Sun3D />}
      </SkyFollowGroup>
      {/* Le hibou/loup-garou ne sont plus rendus ici : ce sont désormais de VRAIES entités errantes
          du monde (voir lib/roamingActors.ts::ensureWildlifeSpawns), rendues par Platform3DWidget.
          tsx::MarkerBlock au même titre qu'un PNJ/familier — corrige le bug « le loup garou et le
          hibou me suivent quand je me déplace [...] je ne peux jamais les toucher ». Le réglage
          Administration owlHootEnabled/werewolfHowlEnabled continue de gater UNIQUEMENT leur cycle
          sonore (voir Owl3D/Werewolf3D::soundEnabled), jamais leur présence/déplacement. */}
      {elements.batsEnabled && <BatsSwarm3D adminAudio={adminAudio} />}
      {elements.raptorsEnabled && <RaptorsFlock3D adminAudio={adminAudio} />}
      {(elements.birds || elements.swallows) && <BirdsFlock3D adminAudio={adminAudio} />}
      {elements.boarHerdEnabled && <BoarHerd3D adminAudio={adminAudio} />}
      {elements.witchEnabled && <Witch3D adminAudio={adminAudio} intervalSec={elements.witchFlybyIntervalSec ?? 600} />}
    </group>
  );
}
