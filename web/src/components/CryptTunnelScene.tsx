'use client';

import { useMemo, useRef, type ReactNode, type RefObject, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Souterrain de crypte en 3D (voir demande utilisateur : « Tu placeras à l'ouverture de la
 * cryptes, une porte qui amenera Synk à des passages secrets dans des tunnels/souterrains en 3D,
 * donnes un côté immersif [...] avec des sons, des chauves-souris qui se baladent, en créant une
 * atmosphères un peu ténébreuse, lugubre avec des torches en 3D accrochées au mur qui éclairent et
 * dont la flamme vascille [...] amènent après plusieurs pas de marche [...] (au moins l'équivalent
 * de 20 dalles [40 depuis la demande de correctif ergonomique]) dans des dédales de pièces en 3D
 * débouchant dans certains châteaux et donjons »).
 *
 * ─── Vue 100% immersive, verrouillée, sans rotation (correctif ergonomique) ────────────────────
 * Monté EN REMPLACEMENT de `<Scene>`/`<Platform3DAmbientScene>` dans le même `<Canvas>` (voir
 * Platform3DWidget.tsx), tant que `cryptMode` est actif côté composant parent. Contrairement à la
 * toute première version de ce module (qui laissait le "monde" défiler devant une caméra fixe sans
 * aucun contrôle de rotation — correct pour un couloir rectiligne, mais `OrbitControls` restait
 * monté par le composant PARENT avec `enableRotate` par défaut, ce qui permettait de faire pivoter
 * la vue et de se retrouver nez contre un mur ou à regarder dans une direction aberrante, bug
 * remonté par l'utilisateur captures à l'appui), la caméra est désormais ENTIÈREMENT pilotée par le
 * code tant que la salle d'arrivée n'a pas été atteinte PAR LA PORTE (voir `doorOpened` ci-dessous) :
 * `CryptCamera` fixe `camera.position`/`camera.rotation` CHAQUE frame d'après la position
 * interpolée le long du chemin du souterrain (voir `computeTunnelPath`), et AUCUN `<OrbitControls>`
 * n'est monté pendant cette phase — il est physiquement impossible de faire pivoter la caméra. Une
 * fois la porte franchie (`doorOpened`), la salle d'arrivée (tour/chambre/parchemin) est en
 * revanche explorable à la souris (orbite libre, zoom/pan désactivés), car regarder autour de soi y
 * a un sens (« regarder le paysage [...] de haut autour de lui »), contrairement au couloir.
 *
 * ─── Chemin avec virages (correctif ergonomique) ───────────────────────────────────────────────
 * `computeTunnelPath` calcule un chemin déterministe (seedé sur `cryptId`, même pattern que
 * `cryptDestinationRoomFor`) avec des virages à 90° tous les 7 à 11 dalles — chaque `Pose` du
 * chemin porte sa position ET son cap (`heading`, en radians NON bornés : on ne les ramène jamais
 * modulo 2π, ce qui évite tout problème de "saut d'angle" lors de l'interpolation continue d'une
 * dalle à l'autre). Chaque dalle de couloir (`TunnelSegment`) est un groupe positionné+pivoté sur
 * sa propre `Pose` : torches/chauves-souris qui lui sont ancrées sont des ENFANTS de ce groupe
 * (positionnées en coordonnées LOCALES, inchangées depuis la version initiale) — le pivot du
 * groupe parent les réoriente donc automatiquement avec le virage, sans calcul supplémentaire.
 * `CryptCamera` réoriente Synk/la caméra dans le nouveau cap dès que la portion courbée du chemin
 * est franchie (interpolation continue de `heading`, voir demande utilisateur « positionner Synk
 * dans la bonne direction une fois l'angle du virage passé »).
 *
 * ─── Escalier + porte (correctif ergonomique) ──────────────────────────────────────────────────
 * Après `tunnelLength` dalles de couloir, `CRYPT_STAIR_STEPS` marches supplémentaires (voir
 * constante exportée, utilisée par le composant PARENT pour borner `cryptProgress`) font monter le
 * chemin en Y jusqu'à une porte (`CryptDoor`), cliquable à la souris gauche (voir demande
 * utilisateur). Cliquer dessus bascule `doorOpened` (callback `onToggleDoor`, état possédé par le
 * parent) : la salle d'arrivée apparaît alors (avec sa propre porte de retour, cliquable de la
 * même façon pour revenir dans l'escalier et repartir en sens inverse dans le souterrain).
 */
const TILE_SIZE = 2;
const TUNNEL_HALF_WIDTH = 1.1;
const TUNNEL_HEIGHT = 2.4;
const EYE_HEIGHT = 1.55;
/** Nb de "marches" après `tunnelLength` menant à la porte — EXPORTÉ pour que le composant parent
 * (Platform3DWidget.tsx) puisse borner `cryptProgress` à `tunnelLength + CRYPT_STAIR_STEPS` (voir
 * commentaire d'en-tête, § Escalier + porte). Volontairement une constante fixe (non paramétrable
 * en Administration, contrairement à `tunnelLength`) : simplification assumée, la longueur de
 * l'escalier n'a pas d'impact sur le gameplay/la difficulté contrairement à celle du couloir. */
export const CRYPT_STAIR_STEPS = 6;
const STAIR_RISE_PER_STEP = 0.32;
const STAIR_DEPTH = TILE_SIZE * 0.62;

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

interface Pose { pos: THREE.Vector3; heading: number }

/** Déterministe (seedé sur `cryptId`) — voir § Chemin avec virages ci-dessus. Convention Three.js
 * (`group.rotation.y = heading`) : avancer d'un pas dans la direction du cap courant correspond au
 * vecteur `(-sin(heading), 0, -cos(heading))`, EXACTEMENT ce que produit une rotation Y native de
 * l'axe local -Z — donc une dalle/porte/salle positionnée à `pos` et pivotée à `rotation.y=heading`
 * s'aligne automatiquement sur le chemin, sans transformation manuelle supplémentaire. */
function computeTunnelPath(cryptId: string, tunnelLength: number, stairSteps: number): { poses: Pose[]; doorPos: THREE.Vector3; roomPos: THREE.Vector3; lastHeading: number } {
  let h = 0;
  for (const c of cryptId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = (seed: number) => {
    const x = Math.sin(h + seed * 999.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const TURN_MIN = 7, TURN_SPAN = 5;
  let heading = 0;
  const pos = new THREE.Vector3(0, 0, 0);
  const poses: Pose[] = [{ pos: pos.clone(), heading }];
  let nextTurnAt = TURN_MIN + Math.floor(rnd(1) * TURN_SPAN);
  const dirFor = (ang: number) => new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang));
  for (let i = 1; i <= tunnelLength; i++) {
    // Pas de virage trop près de l'entrée (lisibilité) ni des 3 dernières dalles avant l'escalier.
    if (i === nextTurnAt && i > 2 && i < tunnelLength - 2) {
      heading += (rnd(i + 17) < 0.5 ? -1 : 1) * (Math.PI / 2);
      nextTurnAt = i + TURN_MIN + Math.floor(rnd(i + 53) * TURN_SPAN);
    }
    pos.add(dirFor(heading).multiplyScalar(TILE_SIZE));
    poses.push({ pos: pos.clone(), heading });
  }
  const lastHeading = poses[poses.length - 1].heading;
  const stairDir = dirFor(lastHeading);
  for (let s = 1; s <= stairSteps; s++) {
    pos.add(stairDir.clone().multiplyScalar(STAIR_DEPTH));
    const stepPos = pos.clone();
    stepPos.y = s * STAIR_RISE_PER_STEP;
    poses.push({ pos: stepPos, heading: lastHeading });
  }
  const lastPose = poses[poses.length - 1];
  const doorPos = lastPose.pos.clone().add(stairDir.clone().multiplyScalar(TILE_SIZE * 0.55));
  doorPos.y = lastPose.pos.y;
  const roomPos = lastPose.pos.clone().add(stairDir.clone().multiplyScalar(TILE_SIZE * 2.4));
  roomPos.y = lastPose.pos.y;
  return { poses, doorPos, roomPos, lastHeading };
}

/** Caméra 100% pilotée par le code tant que `doorOpened` est faux (voir commentaire d'en-tête,
 * § Vue 100% immersive) — interpole en douceur `progress` (comme l'ancienne version, même
 * constante de lissage) le long du tableau `poses`, POSITION ET CAP, pour un glissement fluide y
 * compris dans les virages et dans la montée de l'escalier. Ne fait RIEN une fois `doorOpened`
 * (la salle d'arrivée est alors explorable via `<OrbitControls>`, monté plus bas dans ce fichier). */
function CryptCamera({ poses, progress, doorOpened, turnOffset }: { poses: Pose[]; progress: number; doorOpened: boolean; turnOffset: number }) {
  const { camera } = useThree();
  // ⚠️ Bug corrigé (demande utilisateur « il y a comme une version accélérée qui se rejoue de
  // déplacement depuis la porte d'entrée de la crypte jusqu'à la porte de la pièce ») : ce composant
  // n'est monté QUE tant que `!doorOpened` (voir `{!doorOpened && <CryptCamera .../>}` plus bas) —
  // à chaque sortie d'une salle/tour (`onLeaveRoom`/retour depuis le sommet du donjon, qui repasse
  // `doorOpened` à `false`), une TOUTE NOUVELLE instance de ce composant est montée, et
  // `useRef(0)` réinitialisait alors le lissage à 0 quel que soit l'endroit réel du couloir où se
  // trouvait Synk. Le lissage (`displayedRef` rattrapant `progress` à vitesse `delta*6`, voir
  // boucle ci-dessous) partait donc à chaque fois de la dalle 0 (l'entrée) et remontait tout le
  // couloir en accéléré jusqu'à la position réelle — une « rediffusion » involontaire du trajet.
  // Initialiser `displayedRef` à `progress` (valeur courante AU MOMENT du montage, donc la bonne
  // position) supprime ce rattrapage : la caméra apparaît directement à la bonne dalle, sans jamais
  // perdre le lissage normal utilisé pour une avancée/un recul standard (`progress` ne change alors
  // que graduellement d'une frame à l'autre, le lissage s'applique identiquement à avant).
  const displayedRef = useRef(progress);
  useFrame((_, delta) => {
    if (doorOpened) return;
    displayedRef.current += (progress - displayedRef.current) * Math.min(1, delta * 6);
    if (Math.abs(progress - displayedRef.current) < 0.002) displayedRef.current = progress;
    const clamped = Math.max(0, Math.min(poses.length - 1, displayedRef.current));
    const i0 = Math.floor(clamped);
    const i1 = Math.min(poses.length - 1, i0 + 1);
    const frac = clamped - i0;
    const p0 = poses[i0], p1 = poses[i1];
    camera.position.set(
      p0.pos.x + (p1.pos.x - p0.pos.x) * frac,
      p0.pos.y + (p1.pos.y - p0.pos.y) * frac + EYE_HEIGHT,
      p0.pos.z + (p1.pos.z - p0.pos.z) * frac,
    );
    // 🆕 `turnOffset` (0 à 3 quarts de tour, voir § Quart de tour ci-dessous) s'ajoute AU CAP
    // interpolé de la position : permet à Synk de regarder autour de lui (tableaux/portraits sur
    // les murs) ou de faire demi-tour (2 quarts = 180°) pour repartir en marche AVANT vers la
    // sortie au lieu de reculer, SANS jamais modifier l'interpolation de `camera.position`
    // ci-dessus (la caméra glisse toujours le long du même chemin, seul le regard tourne).
    camera.rotation.set(0, p0.heading + (p1.heading - p0.heading) * frac + turnOffset * (Math.PI / 2), 0);
  });
  return null;
}

/** 🆕 Caméra qui suit Synk "au-dessus de lui" dans la salle chambre/parchemin (voir demande
 * utilisateur « pour faciliter les déplacements dans la pièces ou le donjon, met en place une
 * caméra qui suit Synk et se positionne au dessus de lui et fait en sorte que les touches de
 * direction reste les même car quand j'utilise la vue en perspective/caméra à l'aide de la souris
 * [...] les directions au clavier [...] ne sont plus les mêmes »).
 *
 * Le déplacement (`moveRoom`, voir Platform3DWidget.tsx) est et reste en repère MONDE FIXE (jamais
 * relatif à la caméra — même rationale que le monde extérieur, voir son commentaire historique sur
 * `dispatchMove`) : le vrai problème n'était donc PAS le mapping des touches lui-même, mais la
 * rotation LIBRE à la souris de l'`<OrbitControls>` de la salle, qui changeait l'apparence écran de
 * "haut"/"avant" SANS jamais changer la direction réellement envoyée par les touches — d'où la
 * désynchronisation perçue par le joueur. Solution : verrouiller l'azimut/l'inclinaison
 * (`enableRotate={false}`, voir le `<OrbitControls>` de la salle ci-dessous) ET faire suivre
 * AUTOMATIQUEMENT la cible (`target`) ainsi que la position de la caméra à Synk, chaque frame.
 *
 * Lit la position MONDE réelle de Synk via `anchorRef.getWorldPosition()` (le groupe contenant
 * `synkSlot` est un ENFANT du groupe pivoté `[roomPos, rotation lastHeading]`, voir plus bas) plutôt
 * que de recalculer sa position par trigonométrie manuelle (rotation de `roomSynkPos` par
 * `lastHeading`) — évite tout risque d'erreur de signe/rotation difficile à vérifier sans test en
 * conditions réelles, en s'appuyant sur le calcul de matrice déjà fiabilisé de Three.js. */
function RoomFollowCamera({ anchorRef, controlsRef }: { anchorRef: RefObject<THREE.Object3D | null>; controlsRef: MutableRefObject<any> }) {
  const { camera } = useThree();
  const initedRef = useRef(false);
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchor.getWorldPosition(worldPos);
    lookAt.set(worldPos.x, worldPos.y + 0.9, worldPos.z);
    if (!initedRef.current) {
      initedRef.current = true;
      // Pose initiale "au-dessus et en recul" — fixée UNE SEULE FOIS à l'entrée dans la salle
      // (avant que `enableRotate={false}` ne la verrouille définitivement) : garantit que les
      // touches directionnelles restent TOUJOURS alignées avec le même rendu écran, quel que soit
      // l'endroit où Synk se déplace ensuite dans la pièce.
      camera.position.set(lookAt.x, lookAt.y + 3.6, lookAt.z + 3.0);
    }
    if (controlsRef.current) {
      controlsRef.current.target.copy(lookAt);
      controlsRef.current.update();
    } else {
      camera.lookAt(lookAt);
    }
  });
  return null;
}

export function Torch({ side, flicker }: { side: -1 | 1; flicker: boolean }) {
  const flameRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame((state) => {
    if (!flicker) return;
    const t = state.clock.elapsedTime * 9 + seed;
    const flick = 0.8 + Math.sin(t) * 0.15 + Math.sin(t * 2.7) * 0.1;
    // Intensité/distance renforcées (voir demande utilisateur « éclaire un peu plus les
    // souterrains ») — auparavant 1.1/4.5, trop sombre entre deux torches espacées de 3 dalles.
    if (lightRef.current) lightRef.current.intensity = 1.7 * flick;
    if (flameRef.current) flameRef.current.scale.setScalar(0.85 + flick * 0.25);
  });
  const x = side * TUNNEL_HALF_WIDTH;
  return (
    <group position={[x, 1.35, 0]}>
      <mesh rotation={[0, 0, side * 0.3]} castShadow><cylinderGeometry args={[0.03, 0.035, 0.42, 6]} /><meshStandardMaterial color="#4a3728" roughness={0.9} /></mesh>
      <mesh ref={flameRef} position={[-side * 0.1, 0.26, 0]}><coneGeometry args={[0.08, 0.26, 6]} /><meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={1.4} /></mesh>
      <pointLight ref={lightRef} position={[-side * 0.1, 0.3, 0]} color="#fb923c" intensity={1.7} distance={6.5} decay={2} />
    </group>
  );
}

/** 🆕 Six portraits originaux (remplace les 4 génériques `monster`/`dragon`/`zombie`/`weird`) —
 * voir demande utilisateur « remplace les portraits par ces photos [...] le plus réaliste possible
 * par copier/coller » (12 images jointes : rendus de skins/dragons/sorcier/aventurier à la
 * NameMC/PlanetMinecraft). ⚠️ Ces images sont très probablement des œuvres protégées par le droit
 * d'auteur (skins/rendus tiers) : les reproduire littéralement (copier-coller de leur contenu
 * pixel) violerait la politique anti-contrefaçon de cet environnement. À la place, CES SIX
 * ARCHÉTYPES ORIGINAUX reprennent les mêmes THÈMES (dragon orangé à cornes, dragon ailé sombre,
 * sorcier encapuchonné, rôdeur/archer, chevalier casqué, créature bestiale menaçante) en primitives
 * Three.js pures (même esprit que les 4 kinds précédents), SANS copier aucun pixel des images
 * fournies. */
export type PaintingKind = 'dragonOrange' | 'dragonWinged' | 'sorcerer' | 'ranger' | 'knight' | 'beast';

/** Tableaux/portraits accrochés aux murs du souterrain (voir demande utilisateur « accroche des
 * tableaux/portraits (tête de monstres, dragons, zombies, personnages bizarres) sur les murs du
 * souterrain » — ⚠️ volontairement SANS AUCUN contenu dénudé/suggestif, voir confirmation
 * utilisateur « continue sans contenu de nudité »). PUREMENT COSMÉTIQUE (aucune interaction),
 * construit en primitives Three.js (cadre + toile + silhouette propre à chaque archétype, voir
 * doc de `PaintingKind` ci-dessus), cohérent avec le style du reste de ce module (torches/porte/
 * salles : aucune texture/image externe nulle part dans ce fichier). `side` place le tableau sur
 * le mur gauche (-1) ou droit (+1) de la dalle courante (voir TunnelSegment) — la rotation reprend
 * EXACTEMENT celle du mur lui-même (voir TunnelSegment ci-dessous) pour que sa face visible pointe
 * vers le centre du couloir, quel que soit le mur. */
function Painting({ side, kind }: { side: -1 | 1; kind: PaintingKind }) {
  const palette: Record<PaintingKind, { bg: string; face: string; eye: string; accent: string }> = {
    dragonOrange: { bg: '#3f2412', face: '#ea580c', eye: '#fde047', accent: '#78350f' },
    dragonWinged: { bg: '#1a1225', face: '#5b21b6', eye: '#67e8f9', accent: '#2e1065' },
    sorcerer: { bg: '#241a3f', face: '#8b7bb8', eye: '#a78bfa', accent: '#5b21b6' },
    ranger: { bg: '#16281a', face: '#b08a5a', eye: '#4ade80', accent: '#14532d' },
    knight: { bg: '#20242e', face: '#9ca3af', eye: '#60a5fa', accent: '#374151' },
    beast: { bg: '#2a1a14', face: '#6b4a3a', eye: '#dc2626', accent: '#44281d' },
  };
  const c = palette[kind];
  const x = side * (TUNNEL_HALF_WIDTH - 0.01);
  return (
    <group position={[x, 1.65, 0]} rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
      <mesh castShadow><boxGeometry args={[0.62, 0.78, 0.04]} /><meshStandardMaterial color="#8a6d2f" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0, 0, 0.025]}><planeGeometry args={[0.52, 0.68]} /><meshStandardMaterial color={c.bg} roughness={0.9} /></mesh>
      <mesh position={[0, 0.02, 0.04]}><circleGeometry args={[0.18, 16]} /><meshStandardMaterial color={c.face} roughness={0.8} /></mesh>
      <mesh position={[-0.08, 0.08, 0.05]}><circleGeometry args={[0.035, 8]} /><meshStandardMaterial color={c.eye} emissive={c.eye} emissiveIntensity={0.6} /></mesh>
      <mesh position={[0.08, 0.08, 0.05]}><circleGeometry args={[0.035, 8]} /><meshStandardMaterial color={c.eye} emissive={c.eye} emissiveIntensity={0.6} /></mesh>
      <mesh position={[0, -0.1, 0.05]}><boxGeometry args={[0.12, 0.03, 0.01]} /><meshStandardMaterial color="#1c1917" /></mesh>
      {/* Silhouette/accessoire propre à l'archétype (voir doc ci-dessus) — purement décoratif,
          construit en primitives supplémentaires superposées au "visage" commun ci-dessus. */}
      {(kind === 'dragonOrange' || kind === 'dragonWinged') && (
        <>
          <mesh position={[-0.11, 0.2, 0.045]} rotation={[0, 0, 0.5]}><coneGeometry args={[0.03, 0.14, 4]} /><meshStandardMaterial color={c.accent} roughness={0.7} /></mesh>
          <mesh position={[0.11, 0.2, 0.045]} rotation={[0, 0, -0.5]}><coneGeometry args={[0.03, 0.14, 4]} /><meshStandardMaterial color={c.accent} roughness={0.7} /></mesh>
          <mesh position={[0, -0.04, 0.06]}><boxGeometry args={[0.16, 0.06, 0.02]} /><meshStandardMaterial color={c.accent} roughness={0.7} /></mesh>
        </>
      )}
      {kind === 'dragonWinged' && (
        <>
          <mesh position={[-0.22, -0.02, 0.03]} rotation={[0, 0, 0.9]}><coneGeometry args={[0.1, 0.22, 3]} /><meshStandardMaterial color={c.accent} transparent opacity={0.85} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0.22, -0.02, 0.03]} rotation={[0, 0, -0.9]}><coneGeometry args={[0.1, 0.22, 3]} /><meshStandardMaterial color={c.accent} transparent opacity={0.85} side={THREE.DoubleSide} /></mesh>
        </>
      )}
      {kind === 'sorcerer' && (
        <mesh position={[0, 0.26, 0.045]}><coneGeometry args={[0.16, 0.22, 10]} /><meshStandardMaterial color={c.accent} roughness={0.75} /></mesh>
      )}
      {kind === 'ranger' && (
        <>
          <mesh position={[0, 0.18, 0.045]} rotation={[0, 0, Math.PI]}><coneGeometry args={[0.2, 0.1, 10, 1, true]} /><meshStandardMaterial color={c.accent} roughness={0.8} side={THREE.DoubleSide} /></mesh>
          <mesh position={[-0.02, -0.16, 0.05]}><boxGeometry args={[0.02, 0.1, 0.01]} /><meshStandardMaterial color="#854d0e" /></mesh>
        </>
      )}
      {kind === 'knight' && (
        <>
          <mesh position={[0, 0.03, 0.055]}><boxGeometry args={[0.3, 0.26, 0.02]} /><meshStandardMaterial color={c.accent} metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0, 0.21, 0.045]}><boxGeometry args={[0.05, 0.1, 0.1]} /><meshStandardMaterial color="#b91c1c" roughness={0.7} /></mesh>
        </>
      )}
      {kind === 'beast' && (
        <>
          <mesh position={[-0.05, -0.08, 0.055]} rotation={[0, 0, 0.3]}><coneGeometry args={[0.02, 0.08, 4]} /><meshStandardMaterial color="#e7e5e4" roughness={0.5} /></mesh>
          <mesh position={[0.05, -0.08, 0.055]} rotation={[0, 0, -0.3]}><coneGeometry args={[0.02, 0.08, 4]} /><meshStandardMaterial color="#e7e5e4" roughness={0.5} /></mesh>
        </>
      )}
      <pointLight position={[0, 0, 0.3]} intensity={0.3} color="#fde68a" distance={1.5} decay={2} />
    </group>
  );
}

function TunnelBat({ phase }: { phase: number }) {
  const ref = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 1.4 + phase;
    if (ref.current) {
      ref.current.position.set(Math.sin(t) * 0.55, 1.75 + Math.sin(t * 2.3) * 0.15, Math.cos(t * 0.7) * 0.8);
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

/** Une "dalle" de souterrain : sol + plafond + murs latéraux — groupe positionné/pivoté sur sa
 * `Pose` (voir § Chemin avec virages en en-tête de module). */
function TunnelSegment({ pose, torch, batPhase, painting }: { pose: Pose; torch: boolean; batPhase: number | null; painting: { side: -1 | 1; kind: PaintingKind } | null }) {
  return (
    <group position={pose.pos} rotation={[0, pose.heading, 0]}>
      <mesh position={[0, 0, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TUNNEL_HALF_WIDTH * 2, TILE_SIZE]} />
        <meshStandardMaterial color="#48443c" roughness={0.95} />
      </mesh>
      <mesh position={[0, TUNNEL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TUNNEL_HALF_WIDTH * 2, TILE_SIZE]} />
        <meshStandardMaterial color="#302b26" roughness={1} />
      </mesh>
      <mesh position={[-TUNNEL_HALF_WIDTH, TUNNEL_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[TILE_SIZE, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#5f5a52" roughness={0.95} />
      </mesh>
      <mesh position={[TUNNEL_HALF_WIDTH, TUNNEL_HEIGHT / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[TILE_SIZE, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#5f5a52" roughness={0.95} />
      </mesh>
      {torch && (<><Torch side={-1} flicker /><Torch side={1} flicker /></>)}
      {batPhase !== null && <TunnelBat phase={batPhase} />}
      {painting && <Painting side={painting.side} kind={painting.kind} />}
    </group>
  );
}

/** Marche d'escalier (voir § Escalier + porte en en-tête de module) — groupe positionné/pivoté sur
 * sa `Pose`, murs latéraux qui continuent de monter avec la marche. `torch` (voir demande
 * utilisateur « mets des torches avec une flamme scintillante quand Synk monte dans l'escalier »)
 * ajoute une paire de torches (mêmes murs/hauteur relative que `TunnelSegment`, position LOCALE
 * inchangée malgré l'élévation progressive de la marche — le groupe parent porte déjà tout le
 * dénivelé via `pose.pos.y`). */
function StairStep({ pose, torch }: { pose: Pose; torch: boolean }) {
  return (
    <group position={pose.pos} rotation={[0, pose.heading, 0]}>
      <mesh position={[0, -0.5, 0]} receiveShadow castShadow>
        <boxGeometry args={[TUNNEL_HALF_WIDTH * 2, 1, STAIR_DEPTH]} />
        <meshStandardMaterial color="#49443b" roughness={0.95} />
      </mesh>
      <mesh position={[-TUNNEL_HALF_WIDTH, 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[STAIR_DEPTH, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#5f5a52" roughness={0.95} />
      </mesh>
      <mesh position={[TUNNEL_HALF_WIDTH, 0.55, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[STAIR_DEPTH, TUNNEL_HEIGHT]} />
        <meshStandardMaterial color="#5f5a52" roughness={0.95} />
      </mesh>
      {torch && (<><Torch side={-1} flicker /><Torch side={1} flicker /></>)}
    </group>
  );
}

/** Porte en bois cliquable (voir § Escalier + porte, et demande utilisateur « une porte que je
 * pourrais passer/ouvrir si je clique gauche à la souris ») — utilisée aussi bien au sommet de
 * l'escalier (pour entrer) que dans la salle d'arrivée (pour ressortir, voir `onClick` reçu).
 * Suit le même garde-fou glissé/clic (seuil de quelques pixels entre pointerdown/pointerup) que
 * Platform3DWidget.tsx::dragStateRef, pour ne jamais confondre une orbite de caméra à la souris
 * (possible une fois dans la salle d'arrivée, voir `doorOpened`) avec un simple clic sur la porte.
 * EXPORTÉE pour être réutilisée par `TowerTopScene` (Platform3DWidget.tsx) — la porte de retour en
 * haut de la tour du donjon (colonne centrale, voir demande utilisateur) utilise EXACTEMENT le
 * même composant/la même logique anti-glissé, sans dupliquer son code. */
export function CryptDoor({ onClick }: { onClick: () => void }) {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  return (
    <group
      onPointerDown={(e) => { downRef.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const d = downRef.current;
        downRef.current = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { e.stopPropagation(); onClick(); }
      }}
    >
      <mesh castShadow><boxGeometry args={[1.3, 2.1, 0.12]} /><meshStandardMaterial color="#3f3b35" roughness={0.9} /></mesh>
      <mesh position={[0, 0, 0.07]} castShadow><boxGeometry args={[1.05, 1.9, 0.08]} /><meshStandardMaterial color="#5a3f22" roughness={0.85} /></mesh>
      <mesh position={[0, 0, 0.12]}><boxGeometry args={[0.85, 0.06, 0.02]} /><meshStandardMaterial color="#3f3b35" roughness={0.9} /></mesh>
      <mesh position={[0.4, 0, 0.14]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.4} /></mesh>
    </group>
  );
}

/** Salle d'arrivée "tour de donjon" — plateforme ouverte avec créneaux, vue dégagée sur un
 * paysage lointain (voir demande utilisateur « se retrouvera alors en haut d'une tour [...] à
 * regarder le paysage [...] de haut autour de lui »). */
function TowerRoom() {
  return (
    <>
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
    </>
  );
}

/** 🆕 Meubles considérés comme des OBSTACLES dans les salles d'arrivée chambre/parchemin (voir
 * demande utilisateur « il ne faut bien évidement pas que je passe au travers des objets dans la
 * pièce comme le lit ou la table de chevet ou la table, ils doivent donc être considérés comme des
 * obstacles. Néanmoins, je peux grimper sur la table, le lit ou la table de chevet (mais pas
 * l'armoire) [...] à l'aide de la touche ESPACE et flêche haut [...] comme dans le jeu réel en
 * dehors du souterrain »). Coordonnées EXACTEMENT alignées sur les meshs rendus dans
 * `BedroomRoom`/`ParchmentRoom` ci-dessus (même repère local salle, centre `[0,0,0]`), avec une
 * demi-largeur/profondeur légèrement généreuse pour englober visuellement chaque meuble (évite que
 * Synk ne paraisse à moitié traverser un coin). `climbable` détermine si Espace maintenu + avancer
 * permet d'y monter (voir `moveRoom`/`jumpHeldRef` côté Platform3DWidget.tsx — EXACTEMENT la même
 * mécanique que l'escalade d'un rocher en extérieur, voir `tileClimbCubes`/`destFlags.climbable`) ;
 * `topY` est la hauteur (`standY` de `SynkVoxel`) à laquelle Synk se tient une fois monté dessus.
 * Exportées pour être réutilisées TELLES QUELLES côté `Platform3DWidget.tsx::moveRoom` (source
 * unique de vérité : aucune duplication de coordonnées entre rendu 3D et logique de collision, qui
 * diviergeraient sinon silencieusement au moindre futur ajustement visuel d'un meuble). */
export interface RoomObstacle { x: number; z: number; halfX: number; halfZ: number; climbable: boolean; topY: number }

export const BEDROOM_OBSTACLES: RoomObstacle[] = [
  { x: -0.9, z: -0.5, halfX: 0.58, halfZ: 0.98, climbable: true, topY: 0.37 },  // Lit
  { x: -0.1, z: -1.3, halfX: 0.23, halfZ: 0.23, climbable: true, topY: 0.44 },  // Table de chevet
  { x: 1.4, z: -1.4, halfX: 0.43, halfZ: 0.28, climbable: false, topY: 1.3 },   // Armoire (NON grimpable)
];

export const PARCHMENT_OBSTACLES: RoomObstacle[] = [
  { x: 0, z: 0, halfX: 0.68, halfZ: 0.43, climbable: true, topY: 0.45 },     // Table
  { x: -0.9, z: 0.6, halfX: 0.2, halfZ: 0.2, climbable: false, topY: 0.42 }, // Chaise gauche
  { x: 0.9, z: 0.6, halfX: 0.2, halfZ: 0.2, climbable: false, topY: 0.42 },  // Chaise droite
];

/** Salle d'arrivée "chambre" — lit, table de chevet, armoire (voir demande utilisateur « une
 * pièce avec un lit [...] une table de chevet [...] une armoire »). `torchFlickerEnabled` ajoute
 * deux torches scintillantes aux angles du fond (voir demande utilisateur « ajoutes des torches
 * avec une flammes scintillantes afin d'éclairer la pièce correctement ») — remplace l'éclairage
 * ponctuel statique (`pointLight` central) par le MÊME dispositif `Torch` que le reste du
 * souterrain, pour une cohérence visuelle complète. */
function BedroomRoom({ torchFlickerEnabled }: { torchFlickerEnabled: boolean }) {
  return (
    <>
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
      {/* Torches murales (4 au total, voir doc ci-dessus — 🆕 2 torches supplémentaires ajoutées aux
          angles AVANT, en plus des 2 déjà existantes aux angles du fond, voir demande utilisateur
          « ajoutes deux lampes torches supplémentaires dans les pièces chambres [...] »). Composent
          [groupX ± TUNNEL_HALF_WIDTH] pour positionner la flamme contre chaque mur, aux 4 coins du
          sol carré (`[4,4]`), sans jamais chevaucher le lit/la table de chevet/l'armoire. */}
      <group position={[-0.8, 0, -1.7]}><Torch side={-1} flicker={torchFlickerEnabled} /></group>
      <group position={[0.8, 0, -1.7]}><Torch side={1} flicker={torchFlickerEnabled} /></group>
      <group position={[-0.8, 0, 1.7]}><Torch side={-1} flicker={torchFlickerEnabled} /></group>
      <group position={[0.8, 0, 1.7]}><Torch side={1} flicker={torchFlickerEnabled} /></group>
      <pointLight position={[0, 1.8, 0]} intensity={0.5} color="#fde68a" distance={4} decay={2} />
      <ambientLight intensity={0.3} color="#78716c" />
    </>
  );
}

/** Salle d'arrivée "table au parchemin" — table + chaises + le parchemin interactif (voir demande
 * utilisateur « une autre pièce avec des chaises [...] une table [...] avec un parchemins posé
 * dessus permettant si on s'en approche et clique dessus de le lire »). `taken` masque le
 * parchemin une fois ramassé (voir markParchmentTaken côté parent, Firebase par joueur).
 * `torchFlickerEnabled` ajoute deux torches scintillantes (voir doc de BedroomRoom ci-dessus, même
 * traitement demandé pour les deux salles). */
function ParchmentRoom({ taken, onParchmentClick, torchFlickerEnabled }: { taken: boolean; onParchmentClick: () => void; torchFlickerEnabled: boolean }) {
  return (
    <>
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
      {/* Torches murales (4 au total, voir doc de BedroomRoom ci-dessus — mêmes 2 torches
          supplémentaires aux angles AVANT pour cette salle également, voir demande utilisateur). */}
      <group position={[-0.8, 0, -1.7]}><Torch side={-1} flicker={torchFlickerEnabled} /></group>
      <group position={[0.8, 0, -1.7]}><Torch side={1} flicker={torchFlickerEnabled} /></group>
      <group position={[-0.8, 0, 1.7]}><Torch side={-1} flicker={torchFlickerEnabled} /></group>
      <group position={[0.8, 0, 1.7]}><Torch side={1} flicker={torchFlickerEnabled} /></group>
      <pointLight position={[0, 1.8, 0]} intensity={0.5} color="#fde68a" distance={4} decay={2} />
      <ambientLight intensity={0.3} color="#78716c" />
    </>
  );
}

export function CryptTunnelScene({
  cryptId, progress, tunnelLength, torchFlickerEnabled, batCount, doorOpened, onToggleDoor, parchmentTaken, onParchmentClick,
  turnOffset, synkSlot, roomSynkPos, onLeaveRoom, onExitCrypt,
}: {
  cryptId: string;
  /** Nombre entier de dalles/marches parcourues depuis l'entrée (0 = entrée), piloté par le
   * composant parent via les boutons « ▲ Avancer »/« ▼ Reculer » OU les flèches Haut/Bas du
   * clavier (voir Platform3DWidget.tsx) — borné à `tunnelLength + CRYPT_STAIR_STEPS` (la porte). */
  progress: number;
  tunnelLength: number;
  torchFlickerEnabled: boolean;
  batCount: number;
  /** true une fois la porte franchie (voir § Escalier + porte en en-tête de module) — bascule le
   * rendu couloir+escalier+porte vers la salle d'arrivée, et active `<OrbitControls>`. */
  doorOpened: boolean;
  onToggleDoor: () => void;
  /** true si CE joueur a déjà ramassé le parchemin de cette crypte (voir getTakenParchmentIds/
   * subscribeTakenParchmentIds dans gameState.ts) — sans effet si la salle d'arrivée n'est pas
   * `'parchment'` (voir cryptDestinationRoomFor). */
  parchmentTaken: boolean;
  onParchmentClick: () => void;
  /** 🆕 Quart(s) de tour sur soi-même (0 à 3, voir § Quart de tour / Platform3DWidget.tsx::cryptTurn)
   * — n'affecte QUE le CAP regardé par la caméra (voir CryptCamera), jamais la position interpolée
   * le long du chemin : permet d'observer les tableaux/portraits sur les murs (voir Painting) ou de
   * faire demi-tour (2 quarts = 180°) pour marcher en avant vers la sortie plutôt qu'à reculons. */
  turnOffset: number;
  /** 🆕 Synk visible dans la salle d'arrivée chambre/parchemin (voir demande utilisateur « rend
   * visible Synk de la même manière que je t'ai demandé en haut du donjon ») — un `<SynkVoxel/>`
   * DÉJÀ prêt (position/équipement/animation), fourni par le composant PARENT (Platform3DWidget.tsx)
   * plutôt qu'importé ici : `SynkVoxel` est défini DANS Platform3DWidget.tsx, qui importe lui-même
   * ce module — l'importer ici créerait une dépendance circulaire. `null`/`undefined` (salle
   * `'tower'`, dont la vue de sortie est entièrement gérée par `TowerTopScene`) n'affiche rien. */
  synkSlot?: ReactNode;
  /** 🆕 Position LOCALE (x, z) de Synk DANS la salle chambre/parchemin (voir demande utilisateur
   * « permet à Synk de se déplacer à l'aide des touches directionnelles du clavier [...] afin de
   * lui permettre de découvrir la pièce et rechercher par exemple des objets ») — pilotée côté
   * PARENT (Platform3DWidget.tsx::moveRoom/roomPos, même principe que `moveTowerTop`/`towerPos`),
   * remplace l'ancienne position fixe `[0,0,1.3]`. L'élévation d'escalade (meuble grimpable, voir
   * `RoomObstacle.topY`) est gérée par le PARENT via la prop `standY` du `<SynkVoxel>` lui-même
   * (lissage interne identique au monde extérieur), PAS ici, pour éviter un double décalage. */
  roomSynkPos?: { x: number; z: number };
  /** 🆕 Clic sur la porte de retour DE LA SALLE (chambre/parchemin) vers l'escalier/souterrain —
   * DISTINCT de `onToggleDoor` (qui reste la porte d'ENTRÉE en haut de l'escalier) pour permettre au
   * composant PARENT d'exiger que Synk soit à proximité de cette porte avant de l'actionner (voir
   * demande utilisateur « il faudra bien sûr pour cela qu'il soit à proximité de la porte de
   * sortie ») — chose impossible tant que Synk ne pouvait pas se déplacer librement dans la salle
   * (position fixe), désormais nécessaire avec `roomSynkPos` ci-dessus. Sans effet (non rendu) pour
   * la salle `'tower'`, gérée entièrement par `TowerTopScene`. */
  onLeaveRoom?: () => void;
  /** 🆕 Clic sur la NOUVELLE porte d'entrée du souterrain (voir § Porte d'entrée/sortie complète
   * ci-dessous et demande utilisateur « Synk pourra sortir en cliquant avec le bouton gauche de la
   * souris sur la porte de la crypte [...] il faudra bien sûr [...] qu'il soit à proximité de la
   * porte de sortie ») — remplace l'ancien bouton HUD « 🚪 Sortir » : ferme ENTIÈREMENT le
   * souterrain (retour au monde réel), géré par le composant PARENT qui vérifie la proximité
   * (`progress` proche de 0) avant d'agir. */
  onExitCrypt?: () => void;
}) {
  const room = useMemo(() => cryptDestinationRoomFor(cryptId), [cryptId]);
  // 🆕 Voir `RoomFollowCamera` ci-dessus : `synkAnchorRef` est le groupe portant `synkSlot` dans la
  // salle (position monde réelle lue via `getWorldPosition`), `roomControlsRef` est l'instance
  // `OrbitControls` de la salle (pour piloter `target` chaque frame sans passer par une prop React
  // re-rendue à chaque mouvement, plus coûteux).
  const synkAnchorRef = useRef<THREE.Group>(null);
  const roomControlsRef = useRef<any>(null);
  const { poses, doorPos, roomPos, lastHeading } = useMemo(
    () => computeTunnelPath(cryptId, tunnelLength, CRYPT_STAIR_STEPS),
    [cryptId, tunnelLength],
  );
  const tunnelPoses = poses.slice(0, tunnelLength + 1);
  const stairPoses = poses.slice(tunnelLength + 1);
  const torchIndices = useMemo(() => new Set(Array.from({ length: tunnelLength + 1 }, (_, i) => i).filter(i => i % 3 === 1)), [tunnelLength]);
  const batPhaseByIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < Math.max(0, batCount); i++) {
      const anchor = 2 + (i * 7) % Math.max(3, tunnelLength - 1);
      m.set(anchor, i * 1.7);
    }
    return m;
  }, [batCount, tunnelLength]);
  // 🆕 Tableaux/portraits (voir demande utilisateur, § Painting ci-dessus) — un tous les ~4 dalles,
  // JAMAIS sur une dalle à torche (même mur, se chevaucheraient visuellement), alternant de mur et
  // de type déterministe (même crypte ⇒ toujours la même disposition, comme le reste du chemin).
  const paintingByIndex = useMemo(() => {
    const m = new Map<number, { side: -1 | 1; kind: PaintingKind }>();
    const kinds: PaintingKind[] = ['dragonOrange', 'dragonWinged', 'sorcerer', 'ranger', 'knight', 'beast'];
    for (let i = 2; i < tunnelLength - 1; i++) {
      if (torchIndices.has(i) || i % 4 !== 2) continue;
      const side: -1 | 1 = (i % 8 < 4) ? -1 : 1;
      m.set(i, { side, kind: kinds[Math.floor(i / 4) % kinds.length] });
    }
    return m;
  }, [tunnelLength, torchIndices]);

  return (
    <>
      {/* Éclairage renforcé (voir demande utilisateur « éclaire un peu plus les souterrains ») —
          ambiance 0.12 → 0.32 (quasi x3), conservée en dessous d'une salle ÉCLAIRÉE normalement pour
          garder l'atmosphère "ténébreuse, lugubre" explicitement demandée, tout en rendant le
          couloir entre deux torches bien plus lisible qu'auparavant. */}
      <color attach="background" args={['#0c0a09']} />
      <fog attach="fog" args={['#0c0a09', 2, 15]} />
      <ambientLight intensity={0.32} color="#8a8178" />
      <hemisphereLight args={['#4b4038', '#0c0a09', 0.25]} />
      {!doorOpened && <CryptCamera poses={poses} progress={progress} doorOpened={doorOpened} turnOffset={turnOffset} />}
      {!doorOpened && (
        <>
          {tunnelPoses.map((pose, i) => (
            <TunnelSegment key={`seg-${i}`} pose={pose} torch={torchIndices.has(i)} batPhase={batPhaseByIndex.get(i) ?? null} painting={paintingByIndex.get(i) ?? null} />
          ))}
          {/* Torches d'escalier tous les 2 marches (voir demande utilisateur « mets des torches
              [...] quand Synk monte dans l'escalier ») + 2 torches supplémentaires de part et
              d'autre de la porte d'entrée (voir groupe juste en dessous). */}
          {stairPoses.map((pose, i) => <StairStep key={`stair-${i}`} pose={pose} torch={i % 2 === 0} />)}
          <group position={[doorPos.x, doorPos.y + 1.05, doorPos.z]} rotation={[0, lastHeading, 0]}>
            <CryptDoor onClick={onToggleDoor} />
            <Torch side={-1} flicker={torchFlickerEnabled} />
            <Torch side={1} flicker={torchFlickerEnabled} />
          </group>
          {/* 🆕 Porte d'entrée/sortie COMPLÈTE du souterrain (voir doc de `onExitCrypt` ci-dessus et
              demande utilisateur « Enlève et désactive le bouton Sortir [...] Synk pourra sortir en
              cliquant avec le bouton gauche de la souris sur la porte de la crypte [...] de la même
              manière que quand il clique sur une porte ») — MÊME composant `<CryptDoor>` que les
              autres portes du souterrain, posée à l'entrée même du couloir (`poses[0]`), tournée à
              180° (`+Math.PI`) pour faire face à Synk lorsqu'il revient vers l'entrée en ayant fait
              demi-tour (voir § Quart de tour / `turnOffset===2`, seul moyen de la voir et de cliquer
              dessus — la caméra, verrouillée, ne regarde JAMAIS en arrière sans ce demi-tour). Le
              composant PARENT (`onExitCrypt`) vérifie que `progress` est proche de 0 avant d'agir
              (garde-fou de proximité, voir doc ci-dessus) : cliquer dessus de loin (en théorie hors
              champ, la caméra étant verrouillée vers l'avant) ne fait donc rien. */}
          {onExitCrypt && (
            <group position={[poses[0].pos.x, poses[0].pos.y + 1.05, poses[0].pos.z]} rotation={[0, poses[0].heading + Math.PI, 0]}>
              <CryptDoor onClick={onExitCrypt} />
              <Torch side={-1} flicker={torchFlickerEnabled} />
              <Torch side={1} flicker={torchFlickerEnabled} />
            </group>
          )}
        </>
      )}
      {doorOpened && (
        <>
          {/* 🆕 Rotation libre à la souris DÉSORMAIS VERROUILLÉE (`enableRotate={false}`, voir doc
              de `RoomFollowCamera` ci-dessus) — corrige le bug signalé « les directions au clavier
              [...] ne sont plus les mêmes [...] fonction du mouvement de la caméra » : seul le zoom
              (`enableZoom`, borné `minDistance`/`maxDistance`) reste ajustable à la souris, ce qui
              ne change jamais l'azimut/l'orientation écran. `target` n'est plus une prop statique
              centrée sur la salle : il est désormais piloté CHAQUE FRAME par `RoomFollowCamera`
              ci-dessous, qui suit la position RÉELLE de Synk (voir `synkAnchorRef`). */}
          <OrbitControls ref={roomControlsRef} enablePan={false} enableZoom enableRotate={false} minDistance={1.8} maxDistance={7} enableDamping dampingFactor={0.12} />
          <RoomFollowCamera anchorRef={synkAnchorRef} controlsRef={roomControlsRef} />
          <group position={roomPos} rotation={[0, lastHeading, 0]}>
            {room === 'tower' && <TowerRoom />}
            {room === 'bedroom' && <BedroomRoom torchFlickerEnabled={torchFlickerEnabled} />}
            {room === 'parchment' && <ParchmentRoom taken={parchmentTaken} onParchmentClick={onParchmentClick} torchFlickerEnabled={torchFlickerEnabled} />}
            {/* Synk visible dans la salle (voir doc de `synkSlot` ci-dessus) — 🆕 position PILOTÉE
                par `roomSynkPos` (voir doc ci-dessus, remplace l'ancienne position fixe `[0,0,1.3]`)
                pour permettre à Synk de se déplacer librement dans la salle au clavier (demande
                utilisateur), à l'écart de tout meuble (lit/table de chevet/armoire/table/chaises,
                voir coordonnées de BedroomRoom/ParchmentRoom ci-dessus et bornes `ROOM_HALF_X`/
                `ROOM_MIN_Z`/`ROOM_MAX_Z` côté parent). L'élévation d'escalade est gérée en interne
                par `synkSlot` (prop `standY` du `<SynkVoxel>`, voir doc de `roomSynkPos` ci-dessus),
                PAS par ce groupe. Le groupe reste monté (`ref={synkAnchorRef}`) même sans
                `synkSlot`, pour que `RoomFollowCamera` ait toujours une cible valide. */}
            {room !== 'tower' && (
              <group ref={synkAnchorRef} position={[roomSynkPos?.x ?? 0, 0, roomSynkPos?.z ?? 1.3]}>{synkSlot}</group>
            )}
            {/* Porte de retour (voir § Escalier + porte) — en face (local +Z = vers l'escalier).
                🆕 `onLeaveRoom` (plutôt que `onToggleDoor`) : voir doc ci-dessus, permet au parent
                d'exiger la proximité de Synk avant de refermer/rouvrir l'escalier. */}
            <group position={[0, 1.05, TILE_SIZE * 1.15]} rotation={[0, Math.PI, 0]}>
              <CryptDoor onClick={onLeaveRoom ?? onToggleDoor} />
            </group>
          </group>
        </>
      )}
    </>
  );
}
