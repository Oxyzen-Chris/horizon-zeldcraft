'use client';

import { useState } from 'react';
import { useI18n, itemLabel, localizeName } from '@/lib/i18n';
import type { PlayerProgressLedger, ProgressTheme, ProgressSubgroup, ProgressEntry } from '@/lib/gameState';

/** Thèmes dont les entrées proviennent du catalogue boutique (ShopItem, sans `i18nKey` propre) —
 * utilisent la convention `itemLabel()`/`item.<itemId>` comme le reste de la besace/boutique.
 * Tous les autres thèmes (quêtes, PNJ, mondes, familiers, trésors d'exploration) portent un
 * `i18nKey` explicite sur chaque entrée et utilisent `localizeName()`. */
const SHOP_ITEM_THEME_KEYS = new Set(['weapon', 'armor', 'food', 'potion', 'vehicle', 'shopTreasure', 'saddle']);

function EntryRow({ entry, isShopItem }: { entry: ProgressEntry; isShopItem: boolean }) {
  const { t } = useI18n();
  const label = isShopItem ? itemLabel(t, entry.id, entry.name) : localizeName(t, entry.i18nKey, entry.name);
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded hover:bg-slate-800/50">
      <span className="truncate text-slate-300">{label}</span>
      <span className={entry.owned ? 'text-emerald-400' : 'text-rose-500'} title={entry.owned ? '✅' : '❌'}>
        {entry.owned ? '✅' : '❌'}
      </span>
    </div>
  );
}

function ProgressBar({ owned, total }: { owned: number; total: number }) {
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-400 tabular-nums">{owned}/{total}</span>
    </div>
  );
}

function ThemeSection({ theme, isShopItem }: { theme: ProgressTheme; isShopItem: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [openSubgroups, setOpenSubgroups] = useState<Set<string>>(new Set());
  const toggleSubgroup = (key: string) => {
    setOpenSubgroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-800/60 hover:bg-slate-800 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <span>{open ? '▾' : '▸'}</span>
          <span>{theme.icon}</span>
          <span>{t(theme.labelI18nKey)}</span>
        </span>
        <ProgressBar owned={theme.ownedCount} total={theme.totalCount} />
      </button>
      {open && (
        <div className="p-1.5 max-h-56 overflow-y-auto space-y-0.5">
          {theme.entries && theme.entries.length === 0 && (
            <p className="text-[11px] text-slate-500 italic px-2 py-1">{t('progress.empty')}</p>
          )}
          {theme.entries?.map(e => <EntryRow key={e.id} entry={e} isShopItem={isShopItem} />)}
          {theme.subgroups?.map(sg => (
            <SubgroupSection
              key={sg.key} subgroup={sg} isShopItem={isShopItem}
              open={openSubgroups.has(sg.key)} onToggle={() => toggleSubgroup(sg.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubgroupSection({
  subgroup, isShopItem, open, onToggle,
}: { subgroup: ProgressSubgroup; isShopItem: boolean; open: boolean; onToggle: () => void }) {
  return (
    <div className="border border-slate-700/60 rounded-md overflow-hidden ml-1">
      <button
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-slate-800/40 hover:bg-slate-800/70 text-left"
        onClick={onToggle}
      >
        <span className="text-[11px] flex items-center gap-1">
          <span>{open ? '▾' : '▸'}</span>
          <span>{subgroup.label}</span>
        </span>
        <ProgressBar owned={subgroup.ownedCount} total={subgroup.totalCount} />
      </button>
      {open && (
        <div className="p-1 space-y-0.5">
          {subgroup.entries.map(e => <EntryRow key={e.id} entry={e} isShopItem={isShopItem} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Vue partagée du "ledger" de progression (voir getPlayerProgressLedger() dans gameState.ts) —
 * liste repliable par thème (armes, protections, nourriture, potions & sortilèges, engins,
 * trésors, selles, familiers, quêtes classiques/PNJ/archipel/îles sauvages/Royaume, mondes, PNJ
 * rencontrés), chaque élément marqué ✅ (possédé/résolu au moins une fois) ou ❌ (jamais). Utilisée
 * à la fois par le widget flottant "État d'avancement / inventaire" (ProgressWidget.tsx) et par la
 * rubrique admin "Statistiques par joueur" (PlayerStats.tsx) pour garantir un affichage identique.
 */
export function ProgressLedgerView({ ledger }: { ledger: PlayerProgressLedger | null }) {
  const { t } = useI18n();
  if (!ledger) return <p className="text-xs text-slate-500 italic">{t('progress.loading')}</p>;
  const totalOwned = ledger.themes.reduce((n, th) => n + th.ownedCount, 0);
  const totalCount = ledger.themes.reduce((n, th) => n + th.totalCount, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-slate-300">{t('progress.overall')}</span>
        <ProgressBar owned={totalOwned} total={totalCount} />
      </div>
      {ledger.themes.map(theme => (
        <ThemeSection key={theme.key} theme={theme} isShopItem={SHOP_ITEM_THEME_KEYS.has(theme.key)} />
      ))}
    </div>
  );
}
