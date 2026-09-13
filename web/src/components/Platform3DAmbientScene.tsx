'use client';

import { useMemo, useRef } from 'react';
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

function Moon3D({ phase }: { phase: MoonPhaseInfo }) {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => getMoonTexture(phase.key, phase.isLuneRousse), [phase.key, phase.isLuneRousse]);
  useFrame(({ camera }) => { groupRef.current?.quaternion.copy(camera.quaternion); });
  return (
    <group ref={groupRef} position={[0, 2.6, -7.5]}>
      <mesh position={[0, 0, -0.02]}>
        <circleGeometry args={[1.55, 28]} />
        <meshBasicMaterial color={phase.isLuneRousse ? '#f2c9a0' : '#bfdbfe'} transparent opacity={0.14} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[1.05, 32]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
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
  useFrame(({ camera }) => { groupRef.current?.quaternion.copy(camera.quaternion); });
  return (
    <group ref={groupRef} position={[0, 2.5, -7]}>
      <mesh>
        <circleGeometry args={[2.4, 28]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <circleGeometry args={[0.75, 24]} />
        <meshBasicMaterial color="#fff8dc" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ─────────────────────────────── Ciel étoilé + étoile filante ───────────────────────────────
function Starfield3D() {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    // Champ d'étoiles recentré sur la zone effectivement visible de la caméra par défaut du
    // widget Plateforme 3D (caméra en surplomb, forte inclinaison vers le bas — voir la scène
    // Scene() : position [0,3.2,5.6] visant [0,0.3,0]) : une distribution en dôme "plein ciel"
    // classique placerait l'essentiel des étoiles hors du frustum. On utilise donc une boîte
    // ciblée (x/y/z) calibrée empiriquement pour rester visible sans réduire drastiquement le
    // champ d'action de l'utilisateur qui peut par ailleurs orbiter la caméra (OrbitControls).
    const count = 220;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = 1.2 + Math.random() * 3.6;
      pos[i * 3 + 2] = -5 - Math.random() * 11;
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
      <pointsMaterial size={0.1} color="#f8fafc" transparent opacity={0.75} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function ShootingStar3D() {
  const groupRef = useRef<THREE.Group>(null);
  const state = useRef({ active: false, start: 0, nextAt: 2 + Math.random() * 6, from: new THREE.Vector3(), to: new THREE.Vector3() });
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const st = state.current;
    if (!st.active && t > st.nextAt) {
      st.active = true; st.start = t;
      const angle = Math.random() * Math.PI * 2;
      st.from.set(Math.cos(angle) * 6, 3.2 + Math.random() * 1.3, Math.sin(angle) * 5 - 9);
      st.to.copy(st.from).add(new THREE.Vector3((Math.random() - 0.5) * 5, -2 - Math.random() * 1.2, (Math.random() - 0.5) * 5));
    }
    if (!groupRef.current) return;
    if (!st.active) { groupRef.current.visible = false; return; }
    const elapsed = t - st.start, dur = 0.85;
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
        <cylinderGeometry args={[0.018, 0.018, 1.1, 5]} />
        <meshBasicMaterial color="#fefce8" transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// ─────────────────────────────── Nuages ───────────────────────────────
function Cloud3D({ seed, z, y }: { seed: number; z: number; y: number }) {
  const ref = useRef<THREE.Group>(null);
  const speed = 0.12 + (seed % 5) * 0.025;
  useFrame((state) => {
    if (!ref.current) return;
    const span = 20;
    ref.current.position.x = ((state.clock.elapsedTime * speed + seed * 3.3) % span) - span / 2;
  });
  const puffs = useMemo(() => {
    const n = 4 + (seed % 3);
    return Array.from({ length: n }, (_, i) => ({
      x: i * 0.55 - (n * 0.55) / 2 + Math.sin(seed + i) * 0.1,
      s: 0.55 + ((seed * 13 + i * 7) % 10) / 22,
    }));
  }, [seed]);
  return (
    <group ref={ref} position={[0, y, z]}>
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
  return <>{[0, 1, 2, 3].map((i) => <Cloud3D key={i} seed={i * 37 + 11} z={-6 - i * 1.6} y={2.6 + (i % 2) * 0.8} />)}</>;
}

// ─────────────────────────────── Pluie ───────────────────────────────
function Rain3D() {
  const ref = useRef<THREE.Points>(null);
  const count = 140;
  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = -3 - Math.random() * 9;
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
function useAmbientSoundCycle(key: AudioSourceKey, intervalSec: number, seedOffset: number, onTrigger: () => void, adminSettings: Record<AudioSourceKey, AudioSourceSetting>) {
  const lastCycleRef = useRef(-1);
  useFrame((state) => {
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
function Owl3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const headRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  const hootRef = useRef(0); // timestamp (elapsedTime) du dernier hululement, pour l'animation de tête
  const seedOffset = useMemo(() => (hashSeed('owl') % 1000) / 100, []);
  useAmbientSoundCycle('owl', 22, seedOffset, () => { hootRef.current = performance.now() / 1000; }, adminAudio);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Ruffle d'ailes discret en continu (vie), plus prononcé juste après un hululement.
    const sinceHoot = t - hootRef.current;
    const hooting = sinceHoot < 1.2;
    const flap = Math.sin(t * 2.4) * 0.05 + (hooting ? Math.sin(t * 14) * 0.18 : 0);
    if (wingLRef.current) wingLRef.current.rotation.z = 0.25 + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.25 - flap;
    if (headRef.current) headRef.current.rotation.x = hooting ? Math.sin(sinceHoot * 6) * 0.18 : Math.sin(t * 0.8) * 0.05;
  });
  return (
    <group position={[2.4, 0, -3.4]}>
      {/* Perchoir (petit poteau de bois) */}
      <mesh position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.05, 0.06, 0.64, 6]} /><meshStandardMaterial color="#5b4636" roughness={0.9} /></mesh>
      <group position={[0, 0.7, 0]}>
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
        {/* Ailes repliées, s'écartent lors du ruffle */}
        <mesh ref={wingLRef} position={[-0.2, -0.02, -0.02]} rotation={[0, 0, 0.25]}><boxGeometry args={[0.09, 0.32, 0.14]} /><meshStandardMaterial color="#57534e" roughness={0.85} /></mesh>
        <mesh ref={wingRRef} position={[0.2, -0.02, -0.02]} rotation={[0, 0, -0.25]}><boxGeometry args={[0.09, 0.32, 0.14]} /><meshStandardMaterial color="#57534e" roughness={0.85} /></mesh>
      </group>
    </group>
  );
}

// ─────────────────────────────── Loup-garou (assis, crie parfois) ───────────────────────────────
function Werewolf3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const headRef = useRef<THREE.Group>(null);
  const howlRef = useRef(0);
  const seedOffset = useMemo(() => (hashSeed('werewolf') % 1000) / 90, []);
  useAmbientSoundCycle('werewolf', 38, seedOffset, () => { howlRef.current = performance.now() / 1000; }, adminAudio);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const sinceHowl = t - howlRef.current;
    const howling = sinceHowl < 1.8;
    if (headRef.current) headRef.current.rotation.x = howling ? -0.55 + Math.sin(sinceHowl * 10) * 0.04 : Math.sin(t * 0.5) * 0.06;
  });
  const fur = '#3f3a36';
  return (
    <group position={[-2.6, 0, -4]} rotation={[0, 2.3, 0]}>
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
      {/* Pattes avant assises, posées au sol */}
      {[-0.13, 0.13].map((ex, i) => (
        <mesh key={i} position={[ex, 0.1, 0.16]} rotation={[0.5, 0, 0]} castShadow><cylinderGeometry args={[0.045, 0.05, 0.32, 6]} /><meshStandardMaterial color={fur} roughness={0.9} /></mesh>
      ))}
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

// ─────────────────────────────── Sorcière volante sur balai (jour, sifflote) ───────────────────────────────
function Witch3D({ adminAudio }: { adminAudio: Record<AudioSourceKey, AudioSourceSetting> }) {
  const groupRef = useRef<THREE.Group>(null);
  const robeRef = useRef<THREE.Mesh>(null);
  const seedOffset = useMemo(() => (hashSeed('witch') % 1000) / 95, []);
  useAmbientSoundCycle('witch', 33, seedOffset, () => {}, adminAudio);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.35;
    const span = 12;
    const x = ((t % span) - span / 2) * 0.8;
    if (groupRef.current) {
      groupRef.current.position.set(x, 2.6 + Math.sin(t * 2) * 0.3, -6 + Math.cos(t * 0.6) * 1.5);
      groupRef.current.rotation.y = Math.PI / 2;
      groupRef.current.rotation.z = 0.12 * Math.sin(t * 2);
    }
    if (robeRef.current) robeRef.current.rotation.x = 0.15 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
  });
  return (
    <group ref={groupRef}>
      {/* Balai */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.02, 0.02, 0.9, 6]} /><meshStandardMaterial color="#78350f" roughness={0.9} /></mesh>
      <mesh position={[-0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.09, 0.22, 8]} /><meshStandardMaterial color="#a16207" roughness={1} /></mesh>
      {/* Corps assis à califourchon */}
      <mesh ref={robeRef} position={[0.05, 0.14, 0]} castShadow><coneGeometry args={[0.16, 0.34, 8]} /><meshStandardMaterial color="#1e1b4b" roughness={0.85} /></mesh>
      <mesh position={[0.05, 0.32, 0]} castShadow><sphereGeometry args={[0.1, 10, 8]} /><meshStandardMaterial color="#f2c9a0" roughness={0.7} /></mesh>
      {/* Chapeau pointu à large bord */}
      <mesh position={[0.05, 0.42, 0]}><cylinderGeometry args={[0.13, 0.13, 0.015, 12]} /><meshStandardMaterial color="#1c1917" roughness={0.9} /></mesh>
      <mesh position={[0.05, 0.55, 0]}><coneGeometry args={[0.08, 0.24, 8]} /><meshStandardMaterial color="#292524" roughness={0.9} /></mesh>
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
      {elements.stars && <Starfield3D />}
      {elements.shootingStarsEnabled && <ShootingStar3D />}
      {elements.moon && moonPhase && <Moon3D phase={moonPhase} />}
      {elements.sun && <Sun3D />}
      {elements.clouds && <Clouds3D />}
      {elements.rainChancePct > 0 && Math.random() * 100 < elements.rainChancePct && <Rain3D />}
      {elements.owlHootEnabled && <Owl3D adminAudio={adminAudio} />}
      {elements.werewolfHowlEnabled && <Werewolf3D adminAudio={adminAudio} />}
      {elements.batsEnabled && <BatsSwarm3D adminAudio={adminAudio} />}
      {elements.raptorsEnabled && <RaptorsFlock3D adminAudio={adminAudio} />}
      {(elements.birds || elements.swallows) && <BirdsFlock3D adminAudio={adminAudio} />}
      {elements.boarHerdEnabled && <BoarHerd3D adminAudio={adminAudio} />}
      {elements.witchEnabled && <Witch3D adminAudio={adminAudio} />}
    </group>
  );
}
