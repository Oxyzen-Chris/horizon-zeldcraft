'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import {
  getMapPoiDefs, getWorldDefs, setPlayerMapPos, subscribePlayerMapPos, getUnlockedWorldIds,
  getVisitedMapPoiIds, visitMapPoi, discoverWorldOffchain, getInventoryOnce, getRepRules,
  getOrCreatePlayer, computePlayerDiceBonus, rollD20, applyEffect, getCurrentSeason, RKEY, DEFAULT_MAP_ID,
  getAllMapMarkers,
  type MapPoiDef, type WorldDef, type RepRules, type Season, type MapMarker,
} from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';
import { useWindowZIndex } from '@/lib/windowZOrder';
import { ConfirmDialog } from './ConfirmDialog';
import { SynkSkin } from './SynkSkin';

const POS_KEY = 'zc.mapWidgetPos';
const SIZE_KEY = 'zc.mapWidgetSize';
const COLLAPSED_KEY = 'zc.mapWidgetCollapsed';
interface Pos { x: number; y: number }
interface Size { w: number; h: number }

const MIN_W = 340, MIN_H = 260, MAX_W = 960, MAX_H = 720;
const BASE_W = 720, BASE_H = 480; // dimensions logiques de la carte (avant zoom) — voir rendu ci-dessous
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Emoji par défaut d'un POI selon son type (repli si l'admin ne fournit pas d'icône). */
const POI_TYPE_FALLBACK_ICON: Record<string, string> = {
  plain: '🌾', stream: '💧', lake: '🌊', mountain: '⛰️', forest: '🌲', cave: '🕳️', beach: '🏖️',
  waterfall: '💦', village_ally: '🏘️', village_enemy: '🏚️', path: '🥾', bridge: '🌉',
  tavern: '🍺', stable: '🐴', hut: '🛖',
};

/**
 * Mapmonde du territoire de Synk — carte permanente flottante, style vieux parchemin, zoomable et
 * redimensionnable (glisser le coin ⤡ en bas à droite). Affiche les points d'intérêt (terrain/
 * décor, paramétrables en Administration → « Carte »), les 10 mondes (portails, verrouillés tant
 * que l'XP requis n'est pas atteint) et la position de Synk, qui se déplace librement en cliquant
 * sur la carte (petit bonus d'XP la première fois qu'un POI est découvert par hasard).
 *
 * Voyage vers un monde : instantané si l'engin requis (`WorldDef.vehicleItemId`) est dans la
 * besace ; sinon proposé à pied (plus long, risque de rencontre nocturne hostile — voir
 * RepRules.travel*). Évolutif : `mapId` fixé sur DEFAULT_MAP_ID pour l'instant, mais toute
 * l'infrastructure (MapDef/MapPoiDef) supporte déjà plusieurs cartes à l'avenir.
 */
export function WorldMapWidget({ playerXp }: { playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { z, bringToFront } = useWindowZIndex();

  const [collapsed, setCollapsed] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);
  const [size, setSize] = useState<Size>({ w: 460, h: 360 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [pois, setPois] = useState<MapPoiDef[]>([]);
  const [worlds, setWorlds] = useState<WorldDef[]>([]);
  const [unlockedWorlds, setUnlockedWorlds] = useState<Set<string>>(new Set());
  const [visitedPois, setVisitedPois] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<RepRules | null>(null);
  const [mapPos, setMapPos] = useState<Pos>({ x: 50, y: 88 });
  const [season, setSeason] = useState<Season | null>(null);
  // Marqueurs PNJ/trésors/familiers/quêtes localisés (voir gameState.ts::getAllMapMarkers) — POI
  // terrain et mondes restent gérés séparément ci-dessus (logique de découverte/déverrouillage).
  const [entityMarkers, setEntityMarkers] = useState<MapMarker[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  const [travelConfirm, setTravelConfirm] = useState<WorldDef | null>(null);
  const [traveling, setTraveling] = useState<{ world: WorldDef; progress: number } | null>(null);

  // Refs miroir des états ci-dessus — utilisés dans le scan de découverte (voir runDiscoveryScan)
  // pour éviter les fermetures (closures) obsolètes dans l'écouteur temps réel de position.
  const poisRef = useRef<MapPoiDef[]>([]);
  const visitedRef = useRef<Set<string>>(new Set());
  const rulesRef = useRef<RepRules | null>(null);
  const seasonRef = useRef<Season | null>(null);
  useEffect(() => { poisRef.current = pois; }, [pois]);
  useEffect(() => { visitedRef.current = visitedPois; }, [visitedPois]);
  useEffect(() => { rulesRef.current = rules; }, [rules]);
  useEffect(() => { seasonRef.current = season; }, [season]);

  useEffect(() => {
    setCollapsed((localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1');
    const savedPos = localStorage.getItem(POS_KEY);
    if (savedPos) { try { setPos(JSON.parse(savedPos)); } catch { /* ignore */ } }
    else if (typeof window !== 'undefined') setPos({ x: 24, y: Math.max(20, window.innerHeight - 400) });
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize) { try { setSize(JSON.parse(savedSize)); } catch { /* ignore */ } }
  }, []);

  useEffect(() => {
    getMapPoiDefs(DEFAULT_MAP_ID).then(setPois).catch(() => {});
    getWorldDefs().then(setWorlds).catch(() => {});
    getRepRules().then(setRules).catch(() => {});
    getCurrentSeason().then(setSeason).catch(() => {});
    getAllMapMarkers(DEFAULT_MAP_ID).then(list => setEntityMarkers(list.filter(m => m.kind === 'npc' || m.kind === 'treasure' || m.kind === 'familiar' || m.kind === 'quest'))).catch(() => {});
  }, []);

  const refreshPlayerBits = useCallback(() => {
    if (!address) return;
    getUnlockedWorldIds(address).then(setUnlockedWorlds).catch(() => {});
    getVisitedMapPoiIds(address).then(setVisitedPois).catch(() => {});
  }, [address]);
  useEffect(() => { refreshPlayerBits(); }, [refreshPlayerBits]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 5000); };

  // Un POI tagué `season` reste masqué/non-découvrable hors de sa saison tant qu'il n'a pas déjà
  // été découvert par ce joueur (voir gameState.ts::MapPoiDef.season).
  const visiblePois = pois.filter(p => !p.season || p.season === season || visitedPois.has(RKEY(p.id)));

  // Découverte fortuite d'un POI proche (rayon 6%) — appelée à chaque changement de position,
  // quelle que soit son origine (clic sur la carte ICI, ou flèches/pavé directionnel dans le
  // widget Plateforme 2D isométrique — voir subscribePlayerMapPos ci-dessous). `visitMapPoi` est
  // idempotent côté serveur (vérifie « déjà visité » avant d'attribuer l'XP), donc sans risque
  // même si le scan tourne plusieurs fois pour la même position.
  const runDiscoveryScan = useCallback(async (xPct: number, yPct: number) => {
    if (!address) return;
    const visible = poisRef.current.filter(p => !p.season || p.season === seasonRef.current || visitedRef.current.has(RKEY(p.id)));
    for (const poi of visible) {
      if (visitedRef.current.has(RKEY(poi.id))) continue;
      const d = Math.hypot(poi.x - xPct, poi.y - yPct);
      if (d <= 6) {
        const res = await visitMapPoi(address, poi, rulesRef.current?.mapPoiDiscoveryXp ?? 5);
        if (res === 'discovered') {
          visitedRef.current = new Set(visitedRef.current).add(RKEY(poi.id));
          setVisitedPois(new Set(visitedRef.current));
          showToast(`🧭 ${t('map.discovered')} : ${poi.icon} ${poi.name} (+${rulesRef.current?.mapPoiDiscoveryXp ?? 5} XP)`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, t]);

  // Écoute temps réel de la position de Synk (voir gameState.ts::subscribePlayerMapPos) : se
  // synchronise instantanément avec les déplacements effectués depuis le widget Plateforme 2D
  // isométrique (flèches clavier ou pavé directionnel virtuel — voir GameCanvas2D.tsx), et
  // réciproquement les clics sur cette carte s'y reflètent en direct.
  useEffect(() => {
    if (!address) return;
    return subscribePlayerMapPos(address, p => {
      if (p && p.mapId === DEFAULT_MAP_ID) {
        setMapPos({ x: p.x, y: p.y });
        runDiscoveryScan(p.x, p.y);
      }
    });
  }, [address, runDiscoveryScan]);

  // ─── Drag (déplacement de la fenêtre) ───
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  };
  const onHeaderPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };

  // ─── Redimensionnement (glisser le coin ⤡) ───
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;
    setSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dx)),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dy)),
    });
  };
  const onResizePointerUp = () => {
    if (!resizing) return;
    setResizing(false);
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => { localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1'); return !prev; });
  };

  // ─── Déplacement libre de Synk (clic sur la carte) ───
  // Le scan de découverte de POI proches est désormais géré par l'écouteur temps réel
  // subscribePlayerMapPos (voir plus haut), déclenché par cette écriture elle-même — ainsi le
  // même code de découverte s'applique quel que soit le widget à l'origine du déplacement.
  const moveSynkTo = async (xPct: number, yPct: number) => {
    if (!address) return;
    setMapPos({ x: xPct, y: yPct });
    await setPlayerMapPos(address, DEFAULT_MAP_ID, xPct, yPct);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!canvasRef.current || traveling) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;
    moveSynkTo(xPct, yPct);
  };

  // ─── Voyage vers un monde ───
  const instantTravel = async (w: WorldDef, vehicleName: string) => {
    await discoverWorldOffchain(address!, w);
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    setMapPos({ x, y });
    await setPlayerMapPos(address!, DEFAULT_MAP_ID, x, y);
    setUnlockedWorlds(prev => new Set(prev).add(RKEY(w.id)));
    showToast(`🎈 ${t('map.travelFast', { name: localizeName(t, w.i18nKey, w.name), vehicle: vehicleName })}`);
  };

  const onClickWorld = async (e: React.MouseEvent, w: WorldDef) => {
    e.stopPropagation();
    if (!address || !rules) return;
    if (playerXp < w.xpRequired) {
      showToast(`🔒 ${t('map.locked', { xp: w.xpRequired })}`);
      return;
    }
    const inv = await getInventoryOnce(address);
    const vehicle = w.vehicleItemId
      ? inv.find(i => i.itemId === w.vehicleItemId && i.qty > 0)
      : inv.find(i => i.category === 'vehicle' && i.qty > 0);
    if (vehicle) {
      await instantTravel(w, vehicle.name);
    } else {
      setTravelConfirm(w);
    }
  };

  const onConfirmWalk = async () => {
    const w = travelConfirm;
    setTravelConfirm(null);
    if (!w || !address) return;
    setTraveling({ world: w, progress: 0 });
    const durationMs = Math.max(1, rules?.travelWalkDurationSec ?? 6) * 1000;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await sleep(durationMs / steps);
      setTraveling(prev => (prev ? { ...prev, progress: i / steps } : prev));
    }
    let msg = '';
    const chance = rules?.travelNightEncounterChancePct ?? 30;
    if (Math.random() * 100 < chance) {
      const player = await getOrCreatePlayer(address);
      const bonus = computePlayerDiceBonus(player, rules!);
      const playerRoll = rollD20();
      const monsterForce = 5 + Math.floor(Math.random() * 40);
      const monsterBonus = Math.round(Math.min(1, monsterForce / 45) * 12);
      const monsterRoll = rollD20();
      const win = (playerRoll + bonus) > (monsterRoll + monsterBonus);
      if (win) {
        msg = `⚔️ ${t('map.nightEncounterWin')}`;
      } else {
        const dmg = rules?.travelNightMonsterDamage ?? 15;
        await applyEffect(address, { hp: -dmg });
        msg = `💥 ${t('map.nightEncounterLose', { dmg })}`;
      }
    }
    await discoverWorldOffchain(address, w);
    const x = w.mapX ?? 50, y = w.mapY ?? 50;
    setMapPos({ x, y });
    await setPlayerMapPos(address, DEFAULT_MAP_ID, x, y);
    setUnlockedWorlds(prev => new Set(prev).add(RKEY(w.id)));
    setTraveling(null);
    showToast(`${msg ? msg + ' — ' : '🥾 '}${t('map.arrived', { name: localizeName(t, w.i18nKey, w.name) })}`);
  };

  if (!address || !pos) return null;

  if (collapsed) {
    return (
      <button
        className="fixed z-40 w-14 h-14 rounded-full bg-amber-950 border-2 border-amber-600 text-2xl shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: pos.y, zIndex: z }}
        onPointerDownCapture={bringToFront}
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
        onClick={() => !dragging && toggleCollapsed()}
        title={t('map.title')}
      >🗺️</button>
    );
  }

  const scaledW = BASE_W * zoom, scaledH = BASE_H * zoom;

  return (
    <div
      className="fixed z-40 bg-amber-950 border-2 border-amber-700 rounded-xl shadow-2xl select-none flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }}
      onPointerDownCapture={bringToFront}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-900/60 rounded-t-xl cursor-move shrink-0"
        onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp}
      >
        <span className="text-sm font-semibold text-amber-100">🗺️ {t('map.title')}</span>
        <div className="flex items-center gap-1">
          <button className="text-xs px-1.5 py-0.5 bg-amber-800/60 rounded hover:bg-amber-700" onClick={() => setZoom(z2 => Math.max(0.6, +(z2 - 0.2).toFixed(1)))}>🔍-</button>
          <span className="text-[10px] text-amber-300 w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button className="text-xs px-1.5 py-0.5 bg-amber-800/60 rounded hover:bg-amber-700" onClick={() => setZoom(z2 => Math.min(2.6, +(z2 + 0.2).toFixed(1)))}>🔍+</button>
          <button className="text-xs opacity-70 hover:opacity-100 ml-1" onClick={toggleCollapsed}>✕</button>
        </div>
      </div>

      {/* Zone défilable/zoomable de la carte — style vieux parchemin */}
      <div className="relative flex-1 overflow-auto rounded-b-xl" style={{
        background: 'radial-gradient(ellipse at 30% 20%, #e8d3a0 0%, #d8bd82 35%, #c4a465 65%, #a9884f 100%)',
      }}>
        <div
          ref={canvasRef}
          onClick={onCanvasClick}
          className="relative cursor-crosshair"
          style={{
            width: scaledW, height: scaledH,
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(120,90,40,0.05) 0px, rgba(120,90,40,0.05) 2px, transparent 2px, transparent 40px), repeating-linear-gradient(90deg, rgba(120,90,40,0.05) 0px, rgba(120,90,40,0.05) 2px, transparent 2px, transparent 40px)',
            boxShadow: 'inset 0 0 60px 20px rgba(90,60,20,0.35)',
          }}
        >
          <p className="absolute top-1 left-2 text-[10px] italic text-amber-900/60 pointer-events-none" style={{ fontFamily: 'serif' }}>
            {t('map.parchmentCaption')}
          </p>

          {/* Points d'intérêt (terrain/décor) */}
          {visiblePois.map(poi => (
            <div
              key={poi.id}
              title={poi.name}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${poi.x}%`, top: `${poi.y}%` }}
            >
              <span style={{ fontSize: 14 + zoom * 6 }}>{poi.icon || POI_TYPE_FALLBACK_ICON[poi.type] || '📍'}</span>
              {zoom >= 1.2 && <span className="text-[9px] text-amber-950/80 font-semibold whitespace-nowrap" style={{ fontFamily: 'serif' }}>{poi.name}</span>}
            </div>
          ))}

          {/* PNJ, trésors, familiers et quêtes révélées par PNJ, localisés sur la carte (voir
              gameState.ts::getAllMapMarkers/poiFallbackPos) — informatif seulement (survol = nom). */}
          {entityMarkers.map(m => (
            <div key={`${m.kind}-${m.id}`} title={`${m.icon} ${localizeName(t, m.i18nKey, m.name)}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              <span style={{ fontSize: 13 + zoom * 5 }}>{m.icon}</span>
            </div>
          ))}

          {/* Mondes (portails) */}
          {worlds.map(w => {
            const locked = playerXp < w.xpRequired;
            return (
              <button
                key={w.id}
                onClick={(e) => onClickWorld(e, w)}
                title={locked ? `🔒 ${t('map.locked', { xp: w.xpRequired })}` : localizeName(t, w.i18nKey, w.name)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded-full border-2 shadow-md ${
                  locked ? 'border-slate-600 bg-slate-800/70 opacity-60' : 'border-fuchsia-400 bg-fuchsia-950/70 animate-pulse'
                }`}
                style={{ left: `${w.mapX ?? 50}%`, top: `${w.mapY ?? 50}%`, width: 20 + zoom * 10, height: 20 + zoom * 10 }}
              >
                <span style={{ fontSize: 10 + zoom * 6 }}>{locked ? '🔒' : '🌀'}</span>
              </button>
            );
          })}

          {/* Position de Synk */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-700 ease-out flex flex-col items-center"
            style={{ left: `${mapPos.x}%`, top: `${mapPos.y}%` }}
          >
            <SynkSkin stage={0} size={18 + zoom * 10} />
          </div>
        </div>
      </div>

      {/* Coin de redimensionnement */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize text-amber-400/70 flex items-center justify-center text-[10px]"
        onPointerDown={onResizePointerDown} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp}
      >⤡</div>

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-amber-500 rounded px-3 py-1.5 text-xs text-amber-100 shadow-xl max-w-[90%] text-center">
          {toast}
        </div>
      )}

      {traveling && (
        <div className="absolute inset-x-3 bottom-3 bg-slate-900/95 border border-amber-500 rounded p-2 text-xs text-amber-100">
          <p className="mb-1">🥾 {t('map.walking', { name: localizeName(t, traveling.world.i18nKey, traveling.world.name) })}</p>
          <div className="h-1.5 bg-slate-700 rounded overflow-hidden">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${traveling.progress * 100}%` }} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!travelConfirm}
        title={t('map.travelConfirmTitle')}
        message={travelConfirm ? t('map.travelConfirmMsg', { name: localizeName(t, travelConfirm.i18nKey, travelConfirm.name) }) : ''}
        onConfirm={onConfirmWalk}
        onCancel={() => setTravelConfirm(null)}
      />
    </div>
  );
}
