'use client';

import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';

export interface FightResultData {
  win: boolean;
  playerRoll: number;
  npcRoll: number;
  playerBonus: number;
  npcBonus: number;
  playerTotal: number;
  npcTotal: number;
  npcName: string;
  xpDelta: number;
  hpDelta: number;
  coinsDelta: number;      // + gagné sur la bourse du PNJ, - volé par le PNJ
  lootItemName?: string;   // objet gagné (butin du PNJ vaincu)
  stolenItemName?: string; // objet perdu (le PNJ te l'a pris)
}

/** Pop-up de résultat de combat façon jet de dés (D&D-like) — affiché après un combat PNJ. */
export function FightResultModal({ data, onClose }: { data: FightResultData | null; onClose: () => void }) {
  const { t } = useI18n();
  if (!data || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
      <div
        className={`bg-slate-900 border-2 rounded-xl p-6 max-w-sm w-full shadow-2xl ${data.win ? 'border-emerald-500' : 'border-rose-500'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-xl font-bold text-center mb-1 ${data.win ? 'text-emerald-400' : 'text-rose-400'}`}>
          {data.win ? `⚔️ ${t('fight.victory')}` : `💀 ${t('fight.defeat')}`}
        </h3>
        <p className="text-xs text-slate-400 text-center mb-4">
          {t('fight.against', { name: data.npcName })}
        </p>

        <div className="grid grid-cols-2 gap-2 text-center mb-4">
          <div className="bg-slate-800/60 rounded p-2">
            <p className="text-[10px] text-cyan-300 uppercase tracking-wide">{t('fight.you')}</p>
            <p className="text-2xl font-bold">🎲 {data.playerRoll}</p>
            <p className="text-[11px] text-slate-400">+{data.playerBonus} {t('fight.bonus')} = <b>{data.playerTotal}</b></p>
          </div>
          <div className="bg-slate-800/60 rounded p-2">
            <p className="text-[10px] text-amber-300 uppercase tracking-wide">{data.npcName}</p>
            <p className="text-2xl font-bold">🎲 {data.npcRoll}</p>
            <p className="text-[11px] text-slate-400">+{data.npcBonus} {t('fight.bonus')} = <b>{data.npcTotal}</b></p>
          </div>
        </div>

        <div className="bg-slate-800/40 rounded p-3 text-sm space-y-1">
          <p>✨ {t('fight.xp')} : <b className={data.xpDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{data.xpDelta >= 0 ? '+' : ''}{data.xpDelta}</b></p>
          <p>❤️ {t('fight.hp')} : <b className="text-rose-400">{data.hpDelta}</b></p>
          <p>
            💰 {t('fight.coins')} : <b className={data.coinsDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{data.coinsDelta >= 0 ? '+' : ''}{data.coinsDelta}</b>
            <span className="text-[11px] text-slate-400"> {data.coinsDelta >= 0 ? t('fight.takenFromNpc') : t('fight.takenByNpc')}</span>
          </p>
          {data.lootItemName && (
            <p className="text-emerald-300">🎁 {t('fight.lootWon', { name: data.lootItemName })}</p>
          )}
          {data.stolenItemName && (
            <p className="text-rose-300">🚫 {t('fight.lootLost', { name: data.stolenItemName })}</p>
          )}
        </div>

        <button className="btn-primary w-full mt-5" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
