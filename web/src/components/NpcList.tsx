'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { getNpcDefs, getMetNpcIds, meetNpcOffchain, getCurrentSeason, RKEY, type NpcDef, type Season } from '@/lib/gameState';
import { useI18n, localizeName } from '@/lib/i18n';

/**
 * PNJ « officiels » (Zelda, Steve, Thrall...) — 100% hors-chaîne (voir gameState.ts::NpcDef).
 * Distinct du popup de rencontres aléatoires (NpcEncounterPopup.tsx). Remplace l'ancienne version
 * on-chain (`addNpc`/`meetNpc`/`todaysNpcs`) qui n'offrait aucune fonction de mise à jour — voir
 * la note dans HorizonZeldCraft.sol (`addNpc` = create-only, `require(!active)`).
 */
export function NpcList() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [defs, setDefs] = useState<NpcDef[] | null>(null);
  const [met, setMet] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [season, setSeason] = useState<Season | null>(null);

  const refresh = () => {
    getNpcDefs().then(setDefs).catch(() => setDefs([]));
    if (address) getMetNpcIds(address).then(setMet).catch(() => setMet(new Set()));
  };
  useEffect(refresh, [address]);
  useEffect(() => { getCurrentSeason().then(setSeason).catch(() => {}); }, []);

  // Un PNJ officiel tagué `season` n'apparaît que pendant la saison effective (voir gameState.ts).
  const active = (defs ?? []).filter((n) => n.active && (!n.season || n.season === season));

  const meet = async (npc: NpcDef) => {
    if (!address || busy) return;
    setBusy(npc.id);
    try {
      const res = await meetNpcOffchain(address, npc);
      if (res === 'met') setMet((prev) => new Set(prev).add(RKEY(npc.id)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="flex justify-between items-baseline mb-3">
        <h3 className="text-lg font-semibold">{t('game.npcs.section')}</h3>
        <span className="text-xs text-slate-400">
          {t('game.npcs.today', { n: met.size, max: active.length })}
        </span>
      </div>
      {active.length === 0 && <p className="text-sm text-slate-400">{t('game.npcs.empty')}</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {active.map((npc) => {
          const isMet = met.has(RKEY(npc.id));
          const label = localizeName(t, npc.i18nKey, npc.name);
          return (
            <div key={npc.id} className={`bg-slate-800/60 rounded-lg p-3 border ${isMet ? 'border-emerald-600' : 'border-slate-600'}`}>
              <div className="flex items-start gap-3">
                <span className="text-4xl">🧙</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-cyan-300 truncate">
                    {label} {isMet && '✅'}
                  </p>
                  <p className="text-xs italic text-slate-400 my-1">&ldquo;{npc.dialog}&rdquo;</p>
                  <p className="text-xs text-slate-500 mb-2">{t('game.npcs.xpReward', { v: npc.xpReward })}</p>
                  {!isMet && (
                    <button
                      className="btn-primary text-xs w-full"
                      disabled={busy === npc.id}
                      onClick={() => meet(npc)}
                    >{busy === npc.id ? '⏳' : t('game.npcs.meet')}</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
