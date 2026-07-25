'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getNpcDefs, meetNpcOffchain, getMetNpcIds,
  getFamiliarDefs, tameFamiliar, subscribeFamiliars, familiarKeyOf, getInventoryOnce,
  getTreasureDefs, openTreasureOffchain, getFoundTreasureIds,
  getQuestDefs, submitQuestAnswerOffchain, getUnlockedQuestIds, unlockQuestForPlayer, getSolvedQuest,
  getWorldDefs, discoverWorldOffchain, getUnlockedWorldIds,
  getHutRestRemainingMs, RKEY,
  type MapMarker, type RepRules, type NpcDef, type FamiliarDef, type TreasureDef, type QuestDef, type WorldDef,
} from '@/lib/gameState';
import { useI18n, localizeName, itemLabel } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';

type Marker = MapMarker;

/** Formatte un délai en ms sous forme compacte "2h05" / "45 min" — abréviations universelles,
 * volontairement non traduites (voir usage identique dans d'autres jeux multilingues). */
function formatRemaining(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

/**
 * Pop-up d'interaction déclenché en cliquant sur un marqueur (PNJ, familier/dragon, trésor,
 * quête, monde, hutte) alors que Synk se trouve sur sa case ou une case adjacente, dans le
 * widget Plateforme 2D isométrique (voir GameCanvas2D.tsx). Réutilise directement les mêmes
 * fonctions hors-chaîne que NpcList/FamiliarsList/TreasureList/QuestList/WorldMapWidget pour ne
 * jamais dupliquer la logique de jeu — uniquement une présentation compacte adaptée au clic
 * in-widget.
 */
export function PoiInteractionModal({
  marker, address, playerXp, rules, onClose, onRequestHutRest,
}: {
  marker: Marker | null;
  address?: string;
  playerXp: number;
  rules: RepRules | null;
  onClose: () => void;
  onRequestHutRest: () => void;
}) {
  const { t } = useI18n();

  if (!marker || typeof document === 'undefined') return null;

  const label = localizeName(t, marker.i18nKey, marker.name);

  let body: React.ReactNode;
  if (marker.kind === 'npc') body = <NpcBody marker={marker} address={address} />;
  else if (marker.kind === 'familiar') body = <FamiliarBody marker={marker} address={address} playerXp={playerXp} />;
  else if (marker.kind === 'treasure') body = <TreasureBody marker={marker} address={address} playerXp={playerXp} />;
  else if (marker.kind === 'quest') body = <QuestBody marker={marker} address={address} playerXp={playerXp} rules={rules} />;
  else if (marker.kind === 'world') body = <WorldBody marker={marker} address={address} playerXp={playerXp} />;
  else body = <HutBody address={address} rules={rules} onRequestHutRest={() => { onClose(); onRequestHutRest(); }} />;

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[90] p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border-2 border-cyan-500 rounded-xl p-5 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-cyan-300">{marker.icon} {label}</h3>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={onClose}>✕</button>
        </div>
        {body}
        <button className="btn-secondary text-xs w-full mt-4" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────── PNJ ───────────────────────────────────────────
function NpcBody({ marker, address }: { marker: Marker; address?: string }) {
  const { t } = useI18n();
  const [def, setDef] = useState<NpcDef | null>(null);
  const [met, setMet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    getNpcDefs().then((all) => setDef(all.find((n) => n.id === marker.id) ?? null)).catch(() => setDef(null));
    if (address) getMetNpcIds(address).then((ids) => setMet(ids.has(RKEY(marker.id)))).catch(() => {});
  }, [marker.id, address]);

  if (!def) return <p className="text-sm text-slate-400">⏳</p>;

  const meet = async () => {
    if (!address || busy) return;
    setBusy(true);
    try {
      const res = await meetNpcOffchain(address, def);
      if (res === 'met') {
        setMet(true);
        setFeedback(t('game.npcs.xpReward', { v: def.xpReward }));
        if (def.questId) setFeedback((f) => `${f} · ${t('canvas2d.popup.npcQuestUnlocked')}`);
      } else {
        setMet(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-sm">
      <p className="text-xs italic text-slate-400 mb-2">&ldquo;{def.dialog}&rdquo;</p>
      {met ? (
        <p className="text-emerald-400 text-xs">✅ {t('canvas2d.popup.npcAlreadyMet')}</p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">{t('game.npcs.xpReward', { v: def.xpReward })}</p>
          <button className="btn-primary text-xs w-full" disabled={busy} onClick={meet}>
            {busy ? '⏳' : t('game.npcs.meet')}
          </button>
        </>
      )}
      {feedback && <p className="text-emerald-400 text-xs mt-2">{feedback}</p>}
    </div>
  );
}

// ────────────────────────────────────────── Familier ──────────────────────────────────────────
function FamiliarBody({ marker, address, playerXp }: { marker: Marker; address?: string; playerXp: number }) {
  const { t } = useI18n();
  const [def, setDef] = useState<FamiliarDef | null>(null);
  const [owned, setOwned] = useState(false);
  const [hasItem, setHasItem] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [taming, setTaming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    getFamiliarDefs().then((all) => setDef(all.find((f) => f.id === marker.id) ?? null)).catch(() => setDef(null));
  }, [marker.id]);

  useEffect(() => {
    if (!address) return;
    return subscribeFamiliars(address, (map) => setOwned(!!map[familiarKeyOf(marker.id)]));
  }, [address, marker.id]);

  useEffect(() => {
    if (!address || !def?.requiredItemId) { setHasItem(true); return; }
    getInventoryOnce(address).then((inv) => {
      setHasItem(inv.some((i) => i.itemId === def.requiredItemId && i.qty > 0));
    }).catch(() => {});
  }, [address, def]);

  if (!def) return <p className="text-sm text-slate-400">⏳</p>;

  const label = localizeName(t, def.i18nKey, def.label);
  const xpLocked = playerXp < def.xpRequired;
  const itemLocked = !!def.requiredItemId && !hasItem;
  const locked = xpLocked || itemLocked;

  const runTame = async () => {
    if (!address) return;
    setConfirmOpen(false);
    setTaming(true);
    try {
      const res = await tameFamiliar(address, def, playerXp);
      if (res === 'ok') { setOwned(true); setFeedback(t('game.familiars.tamed', { name: label })); }
      else if (res === 'already') setOwned(true);
      else if (res === 'needXp') setFeedback(t('game.familiars.needXp', { v: def.xpRequired }));
      else if (res === 'needItem') setFeedback(t('game.familiars.needItem', { name: def.requiredItemId ?? '' }));
    } finally {
      setTaming(false);
    }
  };

  return (
    <div className="text-sm">
      <p className="text-xs text-slate-400 mb-2">
        {t('game.familiars.xpRequired', { v: def.xpRequired })}
        {def.requiredItemId && <> · {t('game.familiars.itemRequired', { name: itemLabel(t, def.requiredItemId, def.requiredItemId) })}</>}
      </p>
      {owned ? (
        <p className="text-emerald-400 text-xs">✅ {t('game.familiars.owned')}</p>
      ) : (
        <>
          {!locked && (
            <button className="btn-primary text-xs w-full" disabled={taming} onClick={() => setConfirmOpen(true)}>
              {taming ? '⏳' : t('game.familiars.tame')}
            </button>
          )}
          {xpLocked && <p className="text-xs text-amber-400">{t('game.familiars.needXp', { v: def.xpRequired })}</p>}
          {!xpLocked && itemLocked && <p className="text-xs text-amber-400">{t('game.familiars.needItem', { name: itemLabel(t, def.requiredItemId!, def.requiredItemId!) })}</p>}
        </>
      )}
      {feedback && <p className="text-emerald-400 text-xs mt-2">{feedback}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title={t('game.familiars.confirmTameTitle')}
        message={t('game.familiars.confirmTameMsg', { name: label, itemNote: def.requiredItemId ? t('game.familiars.confirmTameItemNote') : '' })}
        onConfirm={runTame}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ────────────────────────────────────────── Trésor ──────────────────────────────────────────
function TreasureBody({ marker, address, playerXp }: { marker: Marker; address?: string; playerXp: number }) {
  const { t } = useI18n();
  const [def, setDef] = useState<TreasureDef | null>(null);
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTreasureDefs().then((all) => setDef(all.find((tr) => tr.id === marker.id) ?? null)).catch(() => setDef(null));
    if (address) getFoundTreasureIds(address).then((ids) => setFound(ids.has(RKEY(marker.id)))).catch(() => {});
  }, [marker.id, address]);

  if (!def) return <p className="text-sm text-slate-400">⏳</p>;

  const canOpen = !found && playerXp >= def.xpRequired;

  const open = async () => {
    if (!address || busy) return;
    setBusy(true);
    try {
      await openTreasureOffchain(address, def);
      setFound(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-sm">
      {found ? (
        <p className="text-emerald-400 text-xs">💎 {t('game.treasures.found')}</p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">{t('game.treasures.xpRequired', { v: def.xpRequired })}</p>
          {canOpen && (
            <button className="btn-primary text-xs w-full" disabled={busy} onClick={open}>
              {busy ? '⏳' : t('game.treasures.open')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────── Quête ──────────────────────────────────────────
function QuestBody({ marker, address, playerXp, rules }: { marker: Marker; address?: string; playerXp: number; rules: RepRules | null }) {
  const { t } = useI18n();
  const [def, setDef] = useState<QuestDef | null>(null);
  const [solved, setSolved] = useState<string | null>(null);
  const [autoUnlocked, setAutoUnlocked] = useState(false);
  const [answer, setAnswer] = useState('');
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getQuestDefs();
      const q = all.find((q2) => q2.id === marker.id) ?? null;
      if (cancelled) return;
      setDef(q);
      if (!q || !address) return;
      const solvedRes = await getSolvedQuest(address, q.id);
      if (cancelled) return;
      if (solvedRes) { setSolved(solvedRes.answer); return; }
      // Découverte spatiale : si un PNJ n'a pas encore proposé cette quête, la débloquer ici même
      // (voir note d'architecture dans gameState.ts) — chemin d'accès alternatif à l'énigme.
      const unlocked = await getUnlockedQuestIds(address);
      if (!unlocked.has(q.id.toLowerCase())) {
        await unlockQuestForPlayer(address, q.id);
        if (!cancelled) setAutoUnlocked(true);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [marker.id, address]);

  if (!def) return <p className="text-sm text-slate-400">⏳</p>;

  const locked = playerXp < def.xpRequired;

  const submit = async () => {
    if (!answer || !address || checking) return;
    setChecking(true);
    try {
      const rr = rules ?? { questSolved: 2 } as RepRules;
      const res = await submitQuestAnswerOffchain(address, def, answer, rr.questSolved);
      if (res === 'correct' || res === 'already') { setSolved(answer.trim()); setFeedback(t('game.quests.correct')); }
      else setFeedback(t('game.quests.wrong'));
    } finally {
      setChecking(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  return (
    <div className="text-sm">
      {autoUnlocked && !solved && <p className="text-fuchsia-300 text-xs mb-2">🗺️ {t('canvas2d.popup.questAutoUnlocked')}</p>}
      {solved ? (
        <p className="text-emerald-300 text-xs">✅ {t('game.quests.answerWas')} : <b>{solved}</b></p>
      ) : locked ? (
        <p className="text-xs text-amber-400">{t('game.quests.locked', { v: def.xpRequired })}</p>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-2">{t('game.quests.reward', { xp: def.xpReward, score: def.scoreReward })}</p>
          <div className="flex gap-2">
            <input
              value={answer} onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && answer) submit(); }}
              placeholder={t('game.quests.placeholder')}
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs"
              disabled={checking}
            />
            <button className="btn-primary text-xs px-3" disabled={!answer || checking} onClick={submit}>
              {checking ? '⏳' : t('game.quests.submit')}
            </button>
          </div>
        </>
      )}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}
    </div>
  );
}

// ────────────────────────────────────────── Monde ──────────────────────────────────────────
function WorldBody({ marker, address, playerXp }: { marker: Marker; address?: string; playerXp: number }) {
  const { t } = useI18n();
  const [def, setDef] = useState<WorldDef | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    getWorldDefs().then((all) => setDef(all.find((w) => w.id === marker.id) ?? null)).catch(() => setDef(null));
    if (address) getUnlockedWorldIds(address).then((ids) => setUnlocked(ids.has(RKEY(marker.id)))).catch(() => {});
  }, [marker.id, address]);

  if (!def) return <p className="text-sm text-slate-400">⏳</p>;

  const label = localizeName(t, def.i18nKey, def.name);
  const locked = playerXp < def.xpRequired;

  const enter = async () => {
    if (!address || busy) return;
    setBusy(true);
    try {
      await discoverWorldOffchain(address, def);
      setUnlocked(true);
      setFeedback(t('canvas2d.popup.worldTraveled', { name: label }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-sm">
      {unlocked ? (
        <p className="text-emerald-400 text-xs">🌀 {t('canvas2d.popup.worldUnlockedAlready')}</p>
      ) : locked ? (
        <p className="text-xs text-amber-400">{t('map.locked', { xp: def.xpRequired })}</p>
      ) : (
        <button className="btn-primary text-xs w-full" disabled={busy} onClick={enter}>
          {busy ? '⏳' : t('canvas2d.popup.worldTravelBtn')}
        </button>
      )}
      {feedback && <p className="text-emerald-400 text-xs mt-2">{feedback}</p>}
    </div>
  );
}

// ─────────────────────────────────────────── Hutte ───────────────────────────────────────────
function HutBody({ address, rules, onRequestHutRest }: { address?: string; rules: RepRules | null; onRequestHutRest: () => void }) {
  const { t } = useI18n();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!address || !rules) return;
    getHutRestRemainingMs(address, rules).then(setRemainingMs).catch(() => setRemainingMs(0));
  }, [address, rules]);

  if (!rules || remainingMs === null) return <p className="text-sm text-slate-400">⏳</p>;

  return (
    <div className="text-sm">
      <p className="text-xs text-slate-400 mb-2">{t('canvas2d.popup.hutDescription', { hp: rules.hutRestHp })}</p>
      {remainingMs > 0 ? (
        <p className="text-xs text-amber-400">⏳ {t('canvas2d.popup.hutCooldown', { time: formatRemaining(remainingMs) })}</p>
      ) : (
        <button className="btn-primary text-xs w-full" onClick={onRequestHutRest}>
          {t('canvas2d.popup.hutRestBtn')}
        </button>
      )}
    </div>
  );
}
