'use client';

import { useEffect, useState } from 'react';
import {
  AUDIO_SOURCE_KEYS, DEFAULT_AUDIO_SETTINGS, subscribeAudioSettings,
  type AudioSourceKey, type AudioSourceSetting,
} from './gameState';

/**
 * Module audio des créatures d'ambiance 3D de la Plateforme 3D (voir Platform3DAmbientScene.tsx et
 * demande utilisateur « créeras un module audio/son pour donner vie [...] à ces rapaces, aigles,
 * vautours, faucons, sorcière sur son balai, sangliers, oiseaux, hirondelles, hibou, loup-garou,
 * marcassins »). Deux niveaux de réglage, cumulatifs (les deux doivent autoriser le son) :
 *   1. Réglage ADMIN (`catalog/audioSettings/{key}`, voir gameState.ts) : activé/désactivé par
 *      défaut, volume par défaut, URL audio personnalisée optionnelle.
 *   2. Réglage JOUEUR (localStorage, ce fichier) : volume général + sourdine/volume par créature,
 *      persistant par navigateur — voir AudioWidget.tsx.
 *
 * Par défaut (aucune URL admin), un son court est SYNTHÉTISÉ via Web Audio API (oscillateurs +
 * enveloppe de gain) — volontairement choisi plutôt que d'héberger des fichiers audio tiers
 * récupérés sur internet, pour éviter tout risque de lien mort ou de droit d'auteur incertain, et
 * garantir que le jeu fonctionne immédiatement sans dépendance réseau. Si l'admin renseigne une
 * URL personnalisée, elle est jouée via un `<audio>` HTML classique à la place.
 *
 * Politique de lecture automatique des navigateurs : un `AudioContext` ne peut démarrer qu'après un
 * premier geste utilisateur — voir `unlockAudioOnFirstGesture()`, appelé une fois au montage de
 * `game/page.tsx`.
 */

const MASTER_KEY = 'zc.audio.master'; // { enabled: boolean; volume: number(0-100) }
const SOURCES_KEY = 'zc.audio.sources'; // Partial<Record<AudioSourceKey, { enabled: boolean; volume: number }>>

interface MasterPrefs { enabled: boolean; volume: number; }
type SourcePrefs = Partial<Record<AudioSourceKey, { enabled: boolean; volume: number }>>;

function readMasterPrefs(): MasterPrefs {
  if (typeof window === 'undefined') return { enabled: true, volume: 70 };
  try {
    const raw = window.localStorage.getItem(MASTER_KEY);
    if (raw) return { enabled: true, volume: 70, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { enabled: true, volume: 70 };
}
function writeMasterPrefs(p: MasterPrefs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MASTER_KEY, JSON.stringify(p));
}
function readSourcePrefs(): SourcePrefs {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SOURCES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}
function writeSourcePrefs(p: SourcePrefs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOURCES_KEY, JSON.stringify(p));
}

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

/** À appeler une fois après un premier clic/tap n'importe où dans l'app (les navigateurs bloquent
 * `AudioContext` tant qu'aucun geste utilisateur n'a eu lieu) — voir game/page.tsx. */
export function unlockAudioOnFirstGesture() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/** Enveloppe simple (attaque rapide / relâchement progressif) appliquée à un ou plusieurs
 * oscillateurs pour obtenir un son "organique" plutôt qu'un bip carré désagréable. */
function synth(ctx: AudioContext, dest: GainNode, spec: { freqStart: number; freqEnd: number; duration: number; type: OscillatorType; delay?: number }) {
  const t0 = ctx.currentTime + (spec.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freqStart, t0);
  osc.frequency.linearRampToValueAtTime(spec.freqEnd, t0 + spec.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + Math.min(0.05, spec.duration * 0.2));
  gain.gain.linearRampToValueAtTime(0, t0 + spec.duration);
  osc.connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + spec.duration + 0.05);
}

/** Bruit blanc filtré (utile pour battements d'ailes/froissement) — buffer court rejoué une fois. */
function noiseBurst(ctx: AudioContext, dest: GainNode, duration: number, delay = 0) {
  const t0 = ctx.currentTime + delay;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, t0);
  gain.gain.linearRampToValueAtTime(0, t0 + duration);
  src.connect(filter).connect(gain).connect(dest);
  src.start(t0);
}

/** Un "patch" synthétisé par créature — volontairement stylisé/évocateur plutôt que réaliste
 * (contrainte du synthétiseur Web Audio), reconnaissable sans être désagréable. */
function playSynth(key: AudioSourceKey, ctx: AudioContext, dest: GainNode) {
  switch (key) {
    case 'owl': // Hululement grave "hou-hou" (deux notes descendantes espacées)
      synth(ctx, dest, { freqStart: 420, freqEnd: 260, duration: 0.5, type: 'sine' });
      synth(ctx, dest, { freqStart: 380, freqEnd: 230, duration: 0.55, type: 'sine', delay: 0.55 });
      break;
    case 'werewolf': // Cri montant puis longue tenue descendante
      synth(ctx, dest, { freqStart: 180, freqEnd: 520, duration: 0.6, type: 'sawtooth' });
      synth(ctx, dest, { freqStart: 520, freqEnd: 140, duration: 1.4, type: 'sawtooth', delay: 0.55 });
      break;
    case 'bat': // Cliquetis aigus rapides (écholocation stylisée)
      for (let i = 0; i < 4; i++) synth(ctx, dest, { freqStart: 3800, freqEnd: 3000, duration: 0.05, type: 'square', delay: i * 0.09 });
      break;
    case 'raptor': // Cri perçant descendant (aigle/faucon)
      synth(ctx, dest, { freqStart: 1800, freqEnd: 900, duration: 0.45, type: 'sawtooth' });
      break;
    case 'bird': // Pépiement bref à 3 notes
      synth(ctx, dest, { freqStart: 2200, freqEnd: 2600, duration: 0.09, type: 'sine' });
      synth(ctx, dest, { freqStart: 2600, freqEnd: 2100, duration: 0.09, type: 'sine', delay: 0.12 });
      synth(ctx, dest, { freqStart: 2400, freqEnd: 2800, duration: 0.09, type: 'sine', delay: 0.24 });
      break;
    case 'boar': // Grognement grave court
      synth(ctx, dest, { freqStart: 140, freqEnd: 90, duration: 0.3, type: 'square' });
      noiseBurst(ctx, dest, 0.2);
      break;
    case 'witch': // Sifflotement léger à 4 notes (mélodie ludique)
      [660, 740, 880, 740].forEach((f, i) => synth(ctx, dest, { freqStart: f, freqEnd: f, duration: 0.16, type: 'sine', delay: i * 0.18 }));
      break;
  }
}

const audioElementCache = new Map<string, HTMLAudioElement>();

/** Joue le son d'une créature d'ambiance, en respectant : réglage admin (activé + volume par
 * défaut + URL éventuelle), réglage joueur (sourdine générale/par créature + volumes), et l'état
 * "déverrouillé" du contexte audio (sinon, ne fait rien silencieusement — pas d'erreur bloquante). */
export function playAmbientSound(key: AudioSourceKey, adminSettings?: Partial<Record<AudioSourceKey, AudioSourceSetting>>) {
  if (typeof window === 'undefined') return;
  const master = readMasterPrefs();
  if (!master.enabled || master.volume <= 0) return;
  const sourcePrefs = readSourcePrefs()[key];
  if (sourcePrefs && sourcePrefs.enabled === false) return;
  const admin = (adminSettings?.[key]) ?? DEFAULT_AUDIO_SETTINGS[key];
  if (!admin.enabled) return;
  const sourceVolume = (sourcePrefs?.volume ?? admin.volume) / 100;
  const finalVolume = Math.max(0, Math.min(1, sourceVolume * (master.volume / 100)));
  if (finalVolume <= 0) return;

  if (admin.url) {
    // Son personnalisé hébergé par l'admin — lecture via <audio> classique, un élément réutilisé
    // par clé pour éviter de recréer un `HTMLAudioElement` à chaque appel.
    let el = audioElementCache.get(key);
    if (!el) { el = new Audio(); el.preload = 'auto'; audioElementCache.set(key, el); }
    if (el.src !== admin.url) el.src = admin.url;
    el.volume = finalVolume;
    el.currentTime = 0;
    el.play().catch(() => { /* autoplay bloqué ou source invalide — silencieux, non bloquant */ });
    return;
  }

  const ctx = getCtx();
  if (!ctx || ctx.state === 'suspended') return; // pas encore déverrouillé par un geste utilisateur
  const dest = ctx.createGain();
  dest.gain.value = finalVolume;
  dest.connect(ctx.destination);
  try { playSynth(key, ctx, dest); } catch { /* synthèse best-effort, jamais bloquant pour le jeu */ }
}

/** Hook réactif pour AudioWidget.tsx : expose les préférences joueur (master + par créature) avec
 * setters qui persistent en localStorage, et les réglages admin (lecture seule, temps réel). */
export function useAudioPrefs() {
  const [master, setMasterState] = useState<MasterPrefs>(() => readMasterPrefs());
  const [sources, setSourcesState] = useState<SourcePrefs>(() => readSourcePrefs());
  const [adminSettings, setAdminSettings] = useState<Record<AudioSourceKey, AudioSourceSetting>>(DEFAULT_AUDIO_SETTINGS);

  useEffect(() => subscribeAudioSettings(setAdminSettings), []);

  const setMaster = (p: Partial<MasterPrefs>) => {
    setMasterState(prev => { const next = { ...prev, ...p }; writeMasterPrefs(next); return next; });
  };
  const setSource = (key: AudioSourceKey, p: Partial<{ enabled: boolean; volume: number }>) => {
    setSourcesState(prev => {
      const cur = prev[key] ?? { enabled: true, volume: adminSettings[key]?.volume ?? DEFAULT_AUDIO_SETTINGS[key].volume };
      const next = { ...prev, [key]: { ...cur, ...p } };
      writeSourcePrefs(next);
      return next;
    });
  };

  return { master, setMaster, sources, setSource, adminSettings, keys: AUDIO_SOURCE_KEYS };
}

/** Version non-réactive utilisée par Platform3DAmbientScene.tsx (pas besoin de re-render, juste de
 * lire les derniers réglages admin au moment de jouer un son). */
export function useAdminAudioSettings(): Record<AudioSourceKey, AudioSourceSetting> {
  const [adminSettings, setAdminSettings] = useState<Record<AudioSourceKey, AudioSourceSetting>>(DEFAULT_AUDIO_SETTINGS);
  useEffect(() => subscribeAudioSettings(setAdminSettings), []);
  return adminSettings;
}

export type { AudioSourceKey };
