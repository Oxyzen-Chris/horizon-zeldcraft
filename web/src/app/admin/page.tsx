'use client';

import { useAccount, useChainId, useReadContract, useWriteContract, useBalance } from 'wagmi';
import { keccak256, toBytes, parseEther, formatEther } from 'viem';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { HORIZON_ABI, FEED_TYPES, WEATHER, WEATHER_KEYS, normalizeAnswer } from '@/lib/contract';
import { addQuestDef, getQuestDefs, questIdOf, seedQuestAnswer, getAllQuestAnswers, hashAnswer, type QuestDef } from '@/lib/gameState';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NetworkSwitcher } from '@/components/NetworkSwitcher';
import { PlayerStats } from '@/components/PlayerStats';
import { ChatHistory } from '@/components/ChatHistory';
import { RepRulesPanel } from '@/components/RepRulesPanel';
import { TopupPresetsPanel } from '@/components/TopupPresetsPanel';
import { FamiliarsAdminPanel } from '@/components/FamiliarsAdminPanel';
import { ChatScriptsAdminPanel } from '@/components/ChatScriptsAdminPanel';
import { CustomWidgetsAdminPanel } from '@/components/CustomWidgetsAdminPanel';
import { EquipmentAdminPanel } from '@/components/EquipmentAdminPanel';
import { useI18n, localizeName } from '@/lib/i18n';


export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contract = CONTRACT_ADDRESSES[chainId];
  const { t } = useI18n();

  const { data: ownerAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'owner', query: { enabled: !!contract },
  });
  const { data: treasuryAddr } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'treasury', query: { enabled: !!contract },
  });
  const { data: treasuryBalance } = useBalance({
    address: treasuryAddr as `0x${string}` | undefined,
    query: { enabled: !!treasuryAddr, refetchInterval: 15000 },
  });
  const { data: contractBalance } = useBalance({
    address: contract, query: { enabled: !!contract, refetchInterval: 15000 },
  });

  const isOwner = isConnected && ownerAddr && address &&
    (ownerAddr as string).toLowerCase() === address.toLowerCase();

  const { writeContract, isPending } = useWriteContract();

  const [itemKey, setItemKey] = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [itemPrice, setItemPrice] = useState('0.0001');

  const [questKey, setQuestKey] = useState('');
  const [questLabel, setQuestLabel] = useState('');
  const [questReq, setQuestReq] = useState('0');
  const [questRew, setQuestRew] = useState('100');
  const [questScore, setQuestScore] = useState('50');
  const [questAnswer, setQuestAnswer] = useState('');
  const [questHint, setQuestHint] = useState('');
  const [questNpcGiver, setQuestNpcGiver] = useState(false);
  const [questSaving, setQuestSaving] = useState(false);
  const [questSaved, setQuestSaved] = useState(false);
  const [allQuests, setAllQuests] = useState<QuestDef[] | null>(null);
  const [questAnswers, setQuestAnswers] = useState<Record<string, string>>({});
  const refreshQuests = () => {
    getQuestDefs().then(setAllQuests).catch(() => setAllQuests([]));
    getAllQuestAnswers().then(setQuestAnswers).catch(() => setQuestAnswers({}));
  };
  useEffect(() => { refreshQuests(); }, []);

  const [npcKey, setNpcKey] = useState('');
  const [npcName, setNpcName] = useState('');
  const [npcDialog, setNpcDialog] = useState('');
  const [npcXp, setNpcXp] = useState('30');
  const [npcQuest, setNpcQuest] = useState('');

  const [trsKey, setTrsKey] = useState('');
  const [trsName, setTrsName] = useState('');
  const [trsXp, setTrsXp] = useState('75');

  const [wldKey, setWldKey] = useState('');
  const [wldName, setWldName] = useState('');
  const [wldXp, setWldXp] = useState('500');

  const [difficulty, setDifficulty] = useState('50');
  const [weather, setWeather] = useState('0');
  const [npcMax, setNpcMax] = useState('4');

  const [feedIdx, setFeedIdx] = useState(0);
  const [feedNewPrice, setFeedNewPrice] = useState('0.0001');
  const [cooldownIdx, setCooldownIdx] = useState(0);
  const [cooldownSec, setCooldownSec] = useState('0');

  // Récupère la valeur actuelle du prix/cooldown pour l'index sélectionné (refresh à chaque changement)
  const { data: curFeedPrice } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'feedPrice',
    args: [feedIdx], query: { enabled: !!contract },
  });
  const { data: curCooldown } = useReadContract({
    address: contract, abi: HORIZON_ABI, functionName: 'feedCooldown',
    args: [cooldownIdx], query: { enabled: !!contract },
  });

  // Met à jour l'input quand la valeur on-chain arrive ou quand on change de sélection
  useEffect(() => {
    if (curFeedPrice !== undefined) {
      setFeedNewPrice(formatEther(curFeedPrice as bigint));
    }
  }, [curFeedPrice, feedIdx]);
  useEffect(() => {
    if (curCooldown !== undefined) {
      setCooldownSec(String(curCooldown as bigint));
    }
  }, [curCooldown, cooldownIdx]);

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="text-2xl font-bold text-voxlyn-crystal">🐉 {t('app.title')}</Link>
        <div className="flex flex-wrap gap-3 items-center">
          <Link href="/game" className="btn-secondary text-sm">{t('admin.backToGame')}</Link>
          <LanguageSwitcher />
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </header>

      <h1 className="text-3xl font-bold mb-6">⚙️ {t('admin.title')}</h1>

      {!isOwner ? (
        <div className="card"><p>{t('admin.notOwner')}</p></div>
      ) : (
        <div className="space-y-6">
          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.revenue.title')}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{t('admin.revenue.treasury')}</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {treasuryBalance ? `${Number(formatEther(treasuryBalance.value)).toFixed(6)} ${treasuryBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">{treasuryAddr as string}</p>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide">{t('admin.revenue.contract')}</p>
                <p className="text-2xl font-bold text-cyan-400 mt-1">
                  {contractBalance ? `${Number(formatEther(contractBalance.value)).toFixed(6)} ${contractBalance.symbol}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">{contract}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">{t('admin.revenue.hint')}</p>
          </section>

          {contract && <PlayerStats contract={contract} />}
          {contract && <ChatHistory contract={contract} />}
          <RepRulesPanel />
          <TopupPresetsPanel />
          <FamiliarsAdminPanel />
          <EquipmentAdminPanel />
          <ChatScriptsAdminPanel />
          <CustomWidgetsAdminPanel />

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.item.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.item.id')}    value={itemKey}   onChange={e => setItemKey(e.target.value)} />
              <input className="input" placeholder={t('admin.item.label')} value={itemLabel} onChange={e => setItemLabel(e.target.value)} />
              <input className="input" placeholder={t('admin.item.price')} value={itemPrice} onChange={e => setItemPrice(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !itemKey || !itemLabel}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addCatalogItem',
                args: [keccak256(toBytes(itemKey)), itemLabel, parseEther(itemPrice)],
              })}
            >{t('admin.actions.add')}</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.quest.title')}</h2>
            <div className="grid md:grid-cols-4 gap-3 mb-3">
              <input className="input" placeholder={t('admin.quest.id')}            value={questKey}      onChange={e => setQuestKey(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.label')}         value={questLabel}    onChange={e => setQuestLabel(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.answer')}        value={questAnswer}   onChange={e => setQuestAnswer(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.xpRequired')}    value={questReq}      onChange={e => setQuestReq(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.xpReward')}      value={questRew}      onChange={e => setQuestRew(e.target.value)} />
              <input className="input" placeholder={t('admin.quest.scoreReward')}   value={questScore}    onChange={e => setQuestScore(e.target.value)} />
              <input className="input md:col-span-2" placeholder={t('admin.quest.hintField')} value={questHint} onChange={e => setQuestHint(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-3">
              <input type="checkbox" checked={questNpcGiver} onChange={e => setQuestNpcGiver(e.target.checked)} />
              {t('admin.quest.npcGiver')}
            </label>
            <button className="btn-primary" disabled={questSaving || !questKey || !questLabel || !questAnswer}
              onClick={async () => {
                setQuestSaving(true);
                setQuestSaved(false);
                try {
                  // 100% hors-chaîne : catalogue + hash de réponse écrits uniquement en base
                  // (Firebase). Aucune transaction blockchain, donc aucun gas pour créer la quête.
                  // `order` = position d'affichage explicite (évite un tri arbitraire quand
                  // plusieurs quêtes partagent le même horodatage — voir getQuestDefs()).
                  const existing = await getQuestDefs();
                  const nextOrder = existing.reduce((max, q) => Math.max(max, q.order ?? -1), -1) + 1;
                  const newQuestId = questIdOf(questKey);
                  await addQuestDef({
                    id: newQuestId,
                    label: questLabel,
                    xpRequired: Number(questReq),
                    xpReward: Number(questRew),
                    scoreReward: Number(questScore),
                    answerHash: keccak256(toBytes(normalizeAnswer(questAnswer))),
                    active: true,
                    createdAt: Date.now(),
                    order: nextOrder,
                    // Firebase RTDB rejette toute écriture contenant `undefined` : champs optionnels
                    // omis plutôt que mis à `undefined`.
                    ...(questHint.trim() ? { hint: questHint.trim() } : {}),
                    ...(questNpcGiver ? { npcGiver: true } : {}),
                  });
                  // Réponse en clair réservée à l'affichage Administration (jamais exposée aux
                  // joueurs — voir getAllQuestAnswers()/QuestList.tsx).
                  await seedQuestAnswer(newQuestId, normalizeAnswer(questAnswer));
                  setQuestKey(''); setQuestLabel(''); setQuestAnswer(''); setQuestHint(''); setQuestNpcGiver(false);
                  setQuestSaved(true);
                  setTimeout(() => setQuestSaved(false), 3000);
                  refreshQuests();
                } finally {
                  setQuestSaving(false);
                }
              }}
            >{questSaving ? '⏳' : t('admin.quest.submit')}</button>
            {questSaved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.quest.saved')}</p>}
            <p className="text-xs text-slate-500 mt-2">{t('admin.quest.hint')}</p>

            {allQuests && (() => {
              const npcQuests = allQuests.filter(q => q.npcGiver);
              const classicQuests = allQuests.filter(q => !q.npcGiver);
              const sorted = [...allQuests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
              return (
                <div className="mt-5 pt-4 border-t border-slate-700">
                  <h3 className="text-sm font-semibold mb-1">{t('admin.quest.list.title')}</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    {t('admin.quest.list.total', {
                      total: allQuests.length, classic: classicQuests.length, npc: npcQuests.length,
                    })}
                  </p>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {sorted.map((q) => (
                      <QuestRow
                        key={q.id}
                        quest={q}
                        answer={questAnswers[q.id.toLowerCase()] ?? ''}
                        onSaved={refreshQuests}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.npc.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.npc.id')}   value={npcKey}    onChange={e => setNpcKey(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.name')} value={npcName}   onChange={e => setNpcName(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.xp')}   value={npcXp}     onChange={e => setNpcXp(e.target.value)} />
              <input className="input md:col-span-2" placeholder={t('admin.npc.dialog')} value={npcDialog} onChange={e => setNpcDialog(e.target.value)} />
              <input className="input" placeholder={t('admin.npc.questId')} value={npcQuest} onChange={e => setNpcQuest(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !npcKey || !npcName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addNpc',
                args: [
                  keccak256(toBytes(npcKey)), npcName, npcDialog, Number(npcXp),
                  npcQuest ? keccak256(toBytes(npcQuest)) : ('0x' + '00'.repeat(32)) as `0x${string}`,
                ],
              })}
            >{t('admin.npc.submit')}</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.treasure.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.treasure.id')}   value={trsKey}  onChange={e => setTrsKey(e.target.value)} />
              <input className="input" placeholder={t('admin.treasure.name')} value={trsName} onChange={e => setTrsName(e.target.value)} />
              <input className="input" placeholder={t('admin.treasure.xp')}   value={trsXp}   onChange={e => setTrsXp(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !trsKey || !trsName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addTreasure',
                args: [keccak256(toBytes(trsKey)), trsName, Number(trsXp)],
              })}
            >{t('admin.actions.add')}</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.world.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <input className="input" placeholder={t('admin.world.id')}         value={wldKey}  onChange={e => setWldKey(e.target.value)} />
              <input className="input" placeholder={t('admin.world.name')}       value={wldName} onChange={e => setWldName(e.target.value)} />
              <input className="input" placeholder={t('admin.world.xpRequired')} value={wldXp}   onChange={e => setWldXp(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={isPending || !wldKey || !wldName}
              onClick={() => writeContract({
                address: contract, abi: HORIZON_ABI, functionName: 'addWorld',
                args: [keccak256(toBytes(wldKey)), wldName, Number(wldXp)],
              })}
            >{t('admin.actions.add')}</button>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.difficulty.title')}</h2>
            <div className="flex gap-3 items-center mb-3">
              <input type="range" min="0" max="100" value={difficulty}
                onChange={e => setDifficulty(e.target.value)} className="flex-1" />
              <span className="w-16 text-center font-bold text-amber-400">{difficulty}/100</span>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setDifficulty', args: [Number(difficulty)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
            <p className="text-xs text-slate-500">{t('admin.difficulty.hint')}</p>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.weather.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.weather.hint')}</p>
            <div className="flex gap-3 items-center mb-2">
              <select className="input flex-1" value={weather} onChange={e => setWeather(e.target.value)}>
                {WEATHER.map((w, i) => <option key={i} value={i}>{w.emoji} {t(`weather.${WEATHER_KEYS[i]}`)}</option>)}
              </select>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setWeather', args: [Number(weather)],
                })}
              >{t('admin.weather.force')}</button>
              <button className="btn-secondary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'clearWeatherOverride', args: [],
                })}
              >{t('admin.weather.auto')}</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.npcFreq.title')}</h2>
            <p className="text-xs text-slate-400 mb-3">{t('admin.npcFreq.hint')}</p>
            <div className="flex gap-3 items-center">
              <input type="range" min="1" max="10" value={npcMax}
                onChange={e => setNpcMax(e.target.value)} className="flex-1" />
              <span className="w-20 text-center font-bold text-cyan-400">
                {t('admin.npcFreq.perDay', { v: npcMax })}
              </span>
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setNpcMaxPerDay', args: [Number(npcMax)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.price.title')}</h2>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={feedIdx} onChange={e => setFeedIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{t(`game.feed.${f}`)}</option>)}
              </select>
              <input className="input" placeholder={t('admin.price.value')} value={feedNewPrice} onChange={e => setFeedNewPrice(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedPrice',
                  args: [feedIdx, parseEther(feedNewPrice)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-semibold mb-3">{t('admin.cooldowns.title')}</h2>
            <p className="text-sm text-slate-400 mb-3">{t('admin.cooldowns.hint')}</p>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <select className="input" value={cooldownIdx} onChange={e => setCooldownIdx(Number(e.target.value))}>
                {FEED_TYPES.map((f, i) => <option key={f} value={i}>{t(`game.feed.${f}`)}</option>)}
              </select>
              <input className="input" placeholder={t('admin.cooldowns.value')} value={cooldownSec} onChange={e => setCooldownSec(e.target.value)} />
              <button className="btn-primary" disabled={isPending}
                onClick={() => writeContract({
                  address: contract, abi: HORIZON_ABI, functionName: 'setFeedCooldown',
                  args: [cooldownIdx, BigInt(cooldownSec)],
                })}
              >{t('admin.actions.apply')}</button>
            </div>
          </section>

          <section className="card flex flex-wrap gap-3">
            <Link href="/game" className="btn-primary">{t('admin.backToGame')}</Link>
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'withdraw', args: [],
            })}>{t('admin.actions.withdraw')}</button>
            <button className="btn-danger" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'pause', args: [],
            })}>{t('admin.actions.pause')}</button>
            <button className="btn-secondary" onClick={() => writeContract({
              address: contract, abi: HORIZON_ABI, functionName: 'unpause', args: [],
            })}>{t('admin.actions.unpause')}</button>
          </section>
        </div>
      )}

      <style jsx>{`
        .input { background: #1e293b; border: 1px solid #475569; border-radius: 0.375rem; padding: 0.5rem 0.75rem; color: #e2e8f0; }
      `}</style>
    </main>
  );
}

/**
 * Ligne éditable de la liste "Quêtes existantes" (Administration) : type (classique/PNJ), nom de
 * l'énigme, réponse, XP requis/gagné et indice. La sauvegarde ré-écrit intégralement la quête
 * (`addQuestDef` → `set()` Firebase) SANS reporter `i18nKey`/`hintKey` : les libellés/indices
 * édités ici font désormais foi dans toutes les langues (voir `localizeName()`, qui retombe sur
 * `label`/`hint` dès que la clé i18n est absente). La réponse en clair (`answer`) n'est jamais
 * envoyée aux composants de jeu — uniquement lue/écrite ici et dans `getAllQuestAnswers()`.
 */
function QuestRow({ quest, answer, onSaved }: { quest: QuestDef; answer: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [npcGiver, setNpcGiver] = useState(!!quest.npcGiver);
  const [label, setLabel] = useState(quest.label);
  const [ans, setAns] = useState(answer);
  const [xpReq, setXpReq] = useState(String(quest.xpRequired));
  const [xpRew, setXpRew] = useState(String(quest.xpReward));
  const [hint, setHint] = useState(quest.hint ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setNpcGiver(!!quest.npcGiver);
    setLabel(quest.label);
    setAns(answer);
    setXpReq(String(quest.xpRequired));
    setXpRew(String(quest.xpReward));
    setHint(quest.hint ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!label.trim() || !ans.trim() || saving) return;
    setSaving(true);
    try {
      await addQuestDef({
        id: quest.id,
        label: label.trim(),
        xpRequired: Number(xpReq) || 0,
        xpReward: Number(xpRew) || 0,
        scoreReward: quest.scoreReward,
        answerHash: hashAnswer(ans),
        active: quest.active,
        createdAt: quest.createdAt,
        order: quest.order,
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(npcGiver ? { npcGiver: true } : {}),
      });
      await seedQuestAnswer(quest.id, normalizeAnswer(ans));
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="bg-slate-900/80 rounded px-2 py-2 text-xs border border-emerald-700 space-y-2">
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={npcGiver} onChange={e => setNpcGiver(e.target.checked)} />
          {t('admin.quest.npcGiver')}
        </label>
        <input className="input w-full" placeholder={t('admin.quest.label')} value={label} onChange={e => setLabel(e.target.value)} />
        <input className="input w-full" placeholder={t('admin.quest.answer')} value={ans} onChange={e => setAns(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('admin.quest.xpRequired')} value={xpReq} onChange={e => setXpReq(e.target.value)} />
          <input className="input" placeholder={t('admin.quest.xpReward')} value={xpRew} onChange={e => setXpRew(e.target.value)} />
        </div>
        <input className="input w-full" placeholder={t('admin.quest.hintField')} value={hint} onChange={e => setHint(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1" disabled={saving || !label.trim() || !ans.trim()} onClick={save}>
            {saving ? '⏳' : t('admin.quest.list.save')}
          </button>
          <button className="btn-secondary text-xs px-3 py-1" disabled={saving} onClick={() => setEditing(false)}>
            {t('admin.quest.list.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 rounded px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
          quest.npcGiver
            ? 'bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-700'
            : 'bg-sky-900/50 text-sky-300 border border-sky-700'
        }`}
        >
          {quest.npcGiver ? t('admin.quest.list.npcBadge') : t('admin.quest.list.classicBadge')}
        </span>
        <span className="flex-1 truncate">{localizeName(t, quest.i18nKey, quest.label)}</span>
        <span className="shrink-0 text-slate-500">
          {t('admin.quest.xpRequired')} {quest.xpRequired} · +{quest.xpReward} XP
        </span>
        {!quest.active && <span className="shrink-0 text-red-400">{t('admin.quest.list.inactive')}</span>}
        <button className="shrink-0 btn-secondary text-xs px-2 py-0.5" onClick={startEdit}>
          {t('admin.quest.list.edit')}
        </button>
      </div>
      {/* Réponse en clair — réservée à l'Administration, jamais affichée aux joueurs. */}
      <p className="mt-1 text-emerald-400">
        🔑 {t('admin.quest.list.answer')} : <b>{answer || '—'}</b>
      </p>
    </div>
  );
}
