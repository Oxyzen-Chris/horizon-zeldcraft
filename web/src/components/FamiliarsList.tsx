'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import {
  getFamiliarDefs, subscribeFamiliars, tameFamiliar, getShopCatalog,
  subscribeInventory, familiarKeyOf, type FamiliarDef, type InventoryItem,
} from '@/lib/gameState';
import { useI18n, localizeName, itemLabel } from '@/lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { DragonSkin, dragonKindFromId } from './DragonSkin';

/**
 * Familiers — compagnons chimériques (dragons, elfes, etc.) rencontrés au fil de la progression
 * de Synk. 100% hors-chaîne (Firebase) : catalogue paramétrable par l'admin (XP requis + objet
 * rare optionnel à posséder dans la besace, consommé lors de l'apprivoisement). Présenté comme
 * une quête à accomplir (carte verrouillée/déverrouillable), voir `gameState.ts` (`FamiliarDef`,
 * `tameFamiliar`).
 */
export function FamiliarsList({ playerXp }: { playerXp: number }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [familiars, setFamiliars] = useState<FamiliarDef[] | null>(null);
  const [owned, setOwned] = useState<Record<string, { obtainedAt: number }>>({});
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});

  useEffect(() => { getFamiliarDefs().then(setFamiliars).catch(() => setFamiliars([])); }, []);
  useEffect(() => {
    getShopCatalog().then((items) => {
      setItemNames(Object.fromEntries(items.map((i) => [i.itemId, i.name])));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!address) return;
    return subscribeFamiliars(address, setOwned);
  }, [address]);
  useEffect(() => {
    if (!address) return;
    return subscribeInventory(address, setInventory);
  }, [address]);

  const activeFamiliars = (familiars ?? []).filter((f) => f.active);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-1">{t('game.familiars.section')}</h3>
      <p className="text-xs text-slate-400 mb-3">{t('game.familiars.description')}</p>
      {familiars !== null && activeFamiliars.length === 0 && (
        <p className="text-sm text-slate-400">{t('game.familiars.empty')}</p>
      )}
      <div className="space-y-3">
        {activeFamiliars.map((f) => (
          <FamiliarCard
            key={f.id}
            familiar={f}
            playerXp={playerXp}
            owned={!!owned[familiarKeyOf(f.id)]}
            hasItem={!f.requiredItemId || inventory.some((it) => it.itemId === f.requiredItemId && it.qty > 0)}
            itemName={f.requiredItemId ? itemLabel(t, f.requiredItemId, itemNames[f.requiredItemId] ?? f.requiredItemId) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function FamiliarCard({
  familiar, playerXp, owned, hasItem, itemName,
}: {
  familiar: FamiliarDef; playerXp: number; owned: boolean; hasItem: boolean; itemName?: string;
}) {
  const { t } = useI18n();
  const { address } = useAccount();
  const [isOwned, setIsOwned] = useState(owned);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [taming, setTaming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => setIsOwned(owned), [owned]);

  const xpLocked = playerXp < familiar.xpRequired;
  const itemLocked = !!familiar.requiredItemId && !hasItem;
  const locked = xpLocked || itemLocked;
  const label = localizeName(t, familiar.i18nKey, familiar.label);
  const dragonKind = dragonKindFromId(familiar.id);

  const runTame = async () => {
    if (!address) return;
    setConfirmOpen(false);
    setTaming(true);
    try {
      const result = await tameFamiliar(address, familiar, playerXp);
      if (result === 'ok') {
        setIsOwned(true);
        setFeedback(t('game.familiars.tamed', { name: label }));
      } else if (result === 'already') {
        setIsOwned(true);
      } else if (result === 'needXp') {
        setFeedback(t('game.familiars.needXp', { v: familiar.xpRequired }));
      } else if (result === 'needItem') {
        setFeedback(t('game.familiars.needItem', { name: itemName ?? familiar.requiredItemId ?? '' }));
      }
    } catch (e: any) {
      setFeedback(t('game.familiars.error', { msg: e?.message?.slice(0, 120) ?? 'error' }));
    }
    setTimeout(() => setFeedback(null), 3500);
    setTaming(false);
  };

  return (
    <div className={`bg-slate-800/60 rounded-lg p-4 border ${isOwned ? 'border-emerald-600' : locked ? 'border-slate-700 opacity-60' : 'border-slate-600'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-3 flex-1">
          {dragonKind && (
            <div className={locked ? 'opacity-40 grayscale' : ''}>
              <DragonSkin kind={dragonKind} size={48} />
            </div>
          )}
          <p className="font-semibold">{label}</p>
        </div>
        {isOwned && <span className="text-emerald-400 text-sm ml-2">{t('game.familiars.owned')}</span>}
      </div>
      <p className="text-xs text-slate-400 mb-3">
        {t('game.familiars.xpRequired', { v: familiar.xpRequired })}
        {familiar.requiredItemId && <> · {t('game.familiars.itemRequired', { name: itemName ?? familiar.requiredItemId })}</>}
      </p>
      {!isOwned && !locked && (
        <button className="btn-primary text-sm px-4" disabled={taming} onClick={() => setConfirmOpen(true)}>
          {taming ? '⏳' : t('game.familiars.tame')}
        </button>
      )}
      {!isOwned && xpLocked && <p className="text-xs text-amber-400">{t('game.familiars.needXp', { v: familiar.xpRequired })}</p>}
      {!isOwned && !xpLocked && itemLocked && (
        <p className="text-xs text-amber-400">{t('game.familiars.needItem', { name: itemName ?? familiar.requiredItemId ?? '' })}</p>
      )}
      {feedback && <p className="text-sm mt-2">{feedback}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title={t('game.familiars.confirmTameTitle')}
        message={t('game.familiars.confirmTameMsg', {
          name: label,
          itemNote: familiar.requiredItemId ? t('game.familiars.confirmTameItemNote') : '',
        })}
        onConfirm={runTame}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
