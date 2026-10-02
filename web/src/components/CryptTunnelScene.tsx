'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Souterrain de crypte en 3D (voir demande utilisateur : « Tu placeras à l'ouverture de la
 * cryptes, une porte qui amenera Synk à des passages secrets dans des tunnels/souterrains en 3D,
 * donnes un côté immersif [...] avec des sons, des chauves-souris qui se baladent, en créant une
 * atmosphères un peu ténébreuse, lugubre avec des torches en 3D accrochées au mur qui éclairent et
 * dont la flamme vascille [...] amènent après plusieurs pas de marche [...] (au moins l'équivalent
 * de 20 dalles) dans des dédales de pièces en 3D débouchant dans certains châteaux et donjons »).
 *
 * Monté EN REMPLACEMENT de `<Scene>`/`<Platform3DAmbientScene>` dans le même `<Canvas>` (voir
 * Platform3DWidget.tsx, exactement le même principe que `UnderwaterScene` pour la plongée totale),
 * tant que `cryptMode` est actif côté composant parent. Vue à la première personne (pas de modèle
 * Synk visible, caméra fixe à hauteur d'yeux) : plus immersif pour un couloir étroit, et évite de
 * dépendre de `SynkVoxel` (couplage inter-composants inutile ici). Le déplacement est piloté par
 * le composant parent via `progress` (nombre entier de "dalles" parcourues depuis l'entrée, 0 =
 * juste entré) à l'aide de boutons dédiés HORS `<Canvas>` (« ▲ Avancer »/« ▼ Reculer »/« Sortir »)
 * — AUCUNE réutilisation du dpad/clavier existant (trop risqué pour la navigation 2D/3D en place,
 * voir commentaire détaillé dans Platform3DWidget.tsx à l'endroit où `cryptMode` est déclaré).
 *
 * Le "monde" du souterrain défile devant une caméra fixe (même philosophie que `Scene()::tiles`,
 * qui recentre le terrain sur Synk plutôt que de déplacer la caméra) : chaque dalle `i` est bâtie à
 * `z = -i * TILE_SIZE`, et un unique groupe racine est translaté de `+displayedProgress * TILE_SIZE`
 * — quand `displayedProgress === i`, la dalle `i` se retrouve exactement sous la caméra (z=0).
 * `displayedProgress` est interpolé en douceur vers `progress` (voir useFrame ci-dessous) pour un
 * glissement fluide plutôt qu'un saut nets d'une dalle à l'autre.
 */
const TILE_SIZE = 2;
const TUNNEL_HALF_WIDTH = 1.1;
const TUNNEL_HEIGHT = 2.4;

export type CryptDestinationRoom = 'tower' | 'bedroom' | 'parchment';

/** Détermine le type de salle d'arrivée d'une crypte de façon déterministe (même id ⇒ toujours la
 * même salle) — voir demande utilisateur : « Synk au bout de ces tunnels [...] se retrouvera alors
 * en haut d'une tour [...] mais pourra aussi [...] se retrouver dans des pièces [...] avec un lit
 * [...] une autre pièce avec des chaises [...] une table [...] avec un parchemins ». */
export function cryptDestinationRoomFor(cryptId: string): CryptDestinationRoom {
  let h = 0;
  for (const c of cryptId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rooms: CryptDestinationRoom[] = ['tower', 'bedroom', 'parchment'];
  return rooms[h % rooms.length];
}

function Torch({ i, side, flicker }: { i: number; side: -1 | 1; flicker: boolean }) {
  const flameRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame((state) => {
    if (!flicker) return;
    const t = state.clock.elapsedTime * 9 + seed + i;
    const flick = 0.75 + Math.sin(t) * 0.15 + Math.sin(t * 2.7) * 0.1;
    if (lightRef.current) lightRef.current.intensity = 1.1 * flick;
    if (flameRef.current) flameRef.current.scale.setScalar(0.85 + flick * 0.25);
  });
  const x = side * TUNNEL_HALF_WIDTH;
  return (
    <group position={[x, 1.35, -i * TILE_SIZE]}>
      <mesh rotation={[0, 0, side * 0.3]} castShadow><cylinderGeometry args={[0.03, 0.035, 0.42, 6]} /><meshStandardMaterial color="#4a3728" roughness={0.9} /></mesh>
      <mesh ref={flameRef} position={[-side * 0.1, 0.26, 0]}><coneGeometry args={[0.08, 0.26, 6]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={1.4} /></mesh>
      <pointLight ref={lightRef} position={[-side * 0.1, 0.3, 0]} color="#fb923c" intensity={1.1} distance={4.5} decay={2} />
    </group>
  );
}

function TunnelBat({ anchorIndex, phase }: { anchorIndex: number; phase: number }) {
  const ref = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 1.4 + phase;
    if (ref.current) {
      ref.current.position.set(Math.sin(t) * 0.55, 1.75 + Math.sin(t * 2.3) * 0.15, -anchorIndex * TILE_SIZE + Math.cos(t * 0.7) * 0.8);
      ref.current.rotation.y = -t;
    }
    const flap = Math.sin(state.clock.elapsedTime * 18 + phase) * 0.85;
    if (wingLRef.current) wingLRef.current.rotation.z = 0.3 + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.3 - flap;
  });
  return (
    <group ref={ref}>
      <mesh scale={[0.55, 0.55, 0.85]}><sphereGeometry args={[0.06, 6, 6]} /><meshStandardMaterial color="#1c1917" roughness={0.9} /></mesh>
      <mesh ref={wingLRef} position={[-0.05, 0, 0]}><coneGeometry args={[0.14, 0.03, 3]} /><meshStandardMaterial color="#292524" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh ref={wingRRef} position={[0.05, 0, 0]}><coneGeometry args={[0.14, 0.03, 3]} /><meshStandardMaterial color="#292524" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

/** Une "dalle" de souterrain : sol + plafond + murs latéraux (voir description du module). */
function TunnelSegment({ i }: { i: number }) {
  const z = -i * TILE_SIZE;
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TUNNEL_HALF_WIDTH * 2, TILE_SIZE]} />
        <meshStandardMaterial color="#44403c" roughness={0.95} />
      </mesh>
      <mesh position={[0, TUNNEL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TUNNEL_HALF_WIDTH * 2, TILE_SIZE]} />
        <meshStandardMaterial color="#292524" roughness={1} />
      </mesh>
      <mesh position={[-TUNNEL_HALF_WIDTH, TUNNEL_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[TILE_SIZE, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#57534e" roughness={0.95} />
      </mesh>
      <mesh position={[TUNNEL_HALF_WIDTH, TUNNEL_HEIGHT / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[TILE_SIZE, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#57534e" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Salle d'arrivée "tour de donjon" — plateforme ouverte avec créneaux, vue dégagée sur un
 * paysage lointain (voir demande utilisateur « se retrouvera alors en haut d'une tour [...] à
 * regarder le paysage [...] de haut autour de lui »). */
function TowerRoom({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 0]} receiveShadow><cylinderGeometry args={[2.4, 2.4, 0.3, 16]} /><meshStandardMaterial color="#6b655a" roughness={0.9} /></mesh>
      {Array.from({ length: 16 }, (_, k) => {
        const a = (k / 16) * Math.PI * 2;
        return (
          <mesh key={k} position={[Math.cos(a) * 2.3, 0.4, Math.sin(a) * 2.3]} castShadow>
            <boxGeometry args={[0.3, 0.5, 0.3]} />
            <meshStandardMaterial color="#6b655a" roughness={0.9} />
          </mesh>
        );
      })}
      <color attach="background" args={['#1e293b']} />
      <fog attach="fog" args={['#1e293b', 6, 26]} />
      <ambientLight intensity={0.5} color="#bfdbfe" />
      <directionalLight position={[4, 8, 3]} intensity={0.6} />
    </group>
  );
}

/** Salle d'arrivée "chambre" — lit, table de chevet, armoire (voir demande utilisateur « une
 * pièce avec un lit [...] une table de chevet [...] une armoire »). */
function BedroomRoom({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[4, 4]} /><meshStandardMaterial color="#4a443a" roughness={0.95} /></mesh>
      {/* Lit */}
      <group position={[-0.9, 0, -0.5]}>
        <mesh position={[0, 0.22, 0]} castShadow><boxGeometry args={[1.1, 0.3, 1.9]} /><meshStandardMaterial color="#6b4a2a" roughness={0.85} /></mesh>
        <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[1.0, 0.16, 1.7]} /><meshStandardMaterial color="#e2e8f0" roughness={0.8} /></mesh>
        <mesh position={[0, 0.55, -0.82]} castShadow><boxGeometry args={[1.1, 0.4, 0.08]} /><meshStandardMaterial color="#6b4a2a" roughness={0.85} /></mesh>
      </group>
      {/* Table de chevet */}
      <mesh position={[-0.1, 0.22, -1.3]} castShadow><boxGeometry args={[0.4, 0.44, 0.4]} /><meshStandardMaterial color="#5a3f22" roughness={0.85} /></mesh>
      {/* Armoire */}
      <mesh position={[1.4, 0.65, -1.4]} castShadow><boxGeometry args={[0.8, 1.3, 0.5]} /><meshStandardMaterial color="#4a3320" roughness={0.85} /></mesh>
      <pointLight position={[0, 1.8, 0]} intensity={0.9} color="#fde68a" distance={5} decay={2} />
      <ambientLight intensity={0.25} color="#78716c" />
    </group>
  );
}

/** Salle d'arrivée "table au parchemin" — table + chaises + le parchemin interactif (voir demande
 * utilisateur « une autre pièce avec des chaises [...] une table [...] avec un parchemins posé
 * dessus permettant si on s'en approche et clique dessus de le lire »). `taken` masque le
 * parchemin une fois ramassé (voir markParchmentTaken côté parent, Firebase par joueur). */
function ParchmentRoom({ z, taken, onParchmentClick }: { z: number; taken: boolean; onParchmentClick: () => void }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[4, 4]} /><meshStandardMaterial color="#4a443a" roughness={0.95} /></mesh>
      {/* Table */}
      <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[1.3, 0.06, 0.8]} /><meshStandardMaterial color="#5a3f22" roughness={0.85} /></mesh>
      {[[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.2, lz]} castShadow><cylinderGeometry args={[0.04, 0.04, 0.4, 6]} /><meshStandardMaterial color="#4a3320" roughness={0.9} /></mesh>
      ))}
      {/* Chaises */}
      {[[-0.9, 0.6], [0.9, 0.6]].map(([cx, cz], i) => (
        <group key={i} position={[cx, 0, cz]}>
          <mesh position={[0, 0.22, 0]} castShadow><boxGeometry args={[0.34, 0.06, 0.34]} /><meshStandardMaterial color="#5a3f22" roughness={0.85} /></mesh>
          <mesh position={[0, 0.42, 0.16]} castShadow><boxGeometry args={[0.34, 0.4, 0.06]} /><meshStandardMaterial color="#5a3f22" roughness={0.85} /></mesh>
        </group>
      ))}
      {/* Parchemin interactif (objet 3D cliquable, voir demande utilisateur) */}
      {!taken && (
        <mesh position={[0, 0.47, 0]} rotation={[-Math.PI / 2, 0, 0.15]} onClick={(e) => { e.stopPropagation(); onParchmentClick(); }}>
          <cylinderGeometry args={[0.1, 0.1, 0.26, 10]} />
          <meshStandardMaterial color="#e8d9ad" roughness={0.85} emissive="#92752f" emissiveIntensity={0.15} />
        </mesh>
      )}
      <pointLight position={[0, 1.8, 0]} intensity={0.9} color="#fde68a" distance={5} decay={2} />
      <ambientLight intensity={0.25} color="#78716c" />
    </group>
  );
}

export function CryptTunnelScene({
  cryptId, progress, tunnelLength, torchFlickerEnabled, batCount, parchmentTaken, onParchmentClick,
}: {
  cryptId: string;
  /** Nombre entier de dalles parcourues depuis l'entrée (0 = entrée), piloté par le composant
   * parent via les boutons « ▲ Avancer »/« ▼ Reculer » (hors `<Canvas>`). */
  progress: number;
  tunnelLength: number;
  torchFlickerEnabled: boolean;
  batCount: number;
  /** true si CE joueur a déjà ramassé le parchemin de cette crypte (voir getTakenParchmentIds/
   * subscribeTakenParchmentIds dans gameState.ts) — sans effet si la salle d'arrivée n'est pas
   * `'parchment'` (voir cryptDestinationRoomFor). */
  parchmentTaken: boolean;
  onParchmentClick: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const displayedProgressRef = useRef(0);
  const room = useMemo(() => cryptDestinationRoomFor(cryptId), [cryptId]);
  const torchIndices = useMemo(() => Array.from({ length: tunnelLength + 1 }, (_, i) => i).filter(i => i % 3 === 1), [tunnelLength]);
  const batSeeds = useMemo(() => Array.from({ length: Math.max(0, batCount) }, (_, i) => ({
    anchor: 2 + (i * 7) % Math.max(3, tunnelLength - 1), phase: i * 1.7,
  })), [batCount, tunnelLength]);
  useFrame((_, delta) => {
    displayedProgressRef.current += (progress - displayedProgressRef.current) * Math.min(1, delta * 6);
    if (Math.abs(progress - displayedProgressRef.current) < 0.002) displayedProgressRef.current = progress;
    if (rootRef.current) rootRef.current.position.z = displayedProgressRef.current * TILE_SIZE;
  });
  const roomZ = -tunnelLength * TILE_SIZE;
  return (
    <>
      <color attach="background" args={['#0c0a09']} />
      <fog attach="fog" args={['#0c0a09', 1.5, 9]} />
      <ambientLight intensity={0.12} color="#78716c" />
      <group ref={rootRef}>
        {Array.from({ length: tunnelLength }, (_, i) => <TunnelSegment key={`seg-${i}`} i={i} />)}
        {torchIndices.map(i => (
          <group key={`torch-${i}`}>
            <Torch i={i} side={-1} flicker={torchFlickerEnabled} />
            <Torch i={i} side={1} flicker={torchFlickerEnabled} />
          </group>
        ))}
        {batSeeds.map((b, i) => <TunnelBat key={`bat-${i}`} anchorIndex={b.anchor} phase={b.phase} />)}
        {room === 'tower' && <TowerRoom z={roomZ} />}
        {room === 'bedroom' && <BedroomRoom z={roomZ} />}
        {room === 'parchment' && <ParchmentRoom z={roomZ} taken={parchmentTaken} onParchmentClick={onParchmentClick} />}
      </group>
      {/* Caméra fixe à hauteur d'yeux (vue à la première personne) — voir commentaire d'en-tête du
          module : le "monde" défile devant elle plutôt que l'inverse. Un léger `look-around` reste
          possible grâce à `OrbitControls` (rotation seule, zoom/pan désactivés) monté par le
          composant parent comme pour `UnderwaterScene`. */}
    </>
  );
}
