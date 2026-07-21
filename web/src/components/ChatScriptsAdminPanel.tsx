'use client';

import { useEffect, useState } from 'react';
import {
  addChatScript, getChatScripts, removeChatScript, CHAT_RESPONSE_IDS,
  type ChatScript, type ChatReaction, type ChatResponseId,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

type ReactionForm = Record<ChatResponseId, { line: string; xp: string; rep: string; revealHint: boolean; nextScriptId: string }>;

const emptyReactions = (): ReactionForm => ({
  yes: { line: '', xp: '', rep: '', revealHint: false, nextScriptId: '' },
  no: { line: '', xp: '', rep: '', revealHint: false, nextScriptId: '' },
  dontknow: { line: '', xp: '', rep: '', revealHint: false, nextScriptId: '' },
  continue: { line: '', xp: '', rep: '', revealHint: false, nextScriptId: '' },
  moreHints: { line: '', xp: '', rep: '', revealHint: false, nextScriptId: '' },
});

/**
 * Panneau admin — catalogue des scripts de dialogue PNJ (mécanique de discussion). 100%
 * hors-chaîne (Firebase), aucun gas requis. Chaque script = 1 réplique d'ouverture + 5 réactions
 * fixes (Oui/Non/Je ne sais pas/Continue/Donne plus d'indices), chacune pouvant enchaîner vers un
 * autre script du catalogue (`nextScriptId`) pour construire des conversations à plusieurs tours.
 */
export function ChatScriptsAdminPanel() {
  const { t } = useI18n();
  const [scripts, setScripts] = useState<ChatScript[]>([]);
  const [id, setId] = useState('');
  const [npcLine, setNpcLine] = useState('');
  const [reactions, setReactions] = useState<ReactionForm>(emptyReactions());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = () => getChatScripts().then(setScripts).catch(() => {});
  useEffect(() => { reload(); }, []);

  const setField = (rid: ChatResponseId, field: keyof ReactionForm[ChatResponseId], value: string | boolean) => {
    setReactions(prev => ({ ...prev, [rid]: { ...prev[rid], [field]: value } }));
  };

  const submit = async () => {
    if (!id || !npcLine) return;
    setSaving(true);
    setSaved(false);
    try {
      const existing = await getChatScripts();
      const nextOrder = existing.length ? Math.max(...existing.map(s => s.order ?? 0)) + 1 : 0;
      const built: Partial<Record<ChatResponseId, ChatReaction>> = {};
      for (const rid of CHAT_RESPONSE_IDS) {
        const f = reactions[rid];
        if (!f.line.trim()) continue;
        built[rid] = {
          line: f.line.trim(),
          xp: f.xp ? Number(f.xp) : undefined,
          rep: f.rep ? Number(f.rep) : undefined,
          revealHint: f.revealHint || undefined,
          nextScriptId: f.nextScriptId.trim() || undefined,
        };
      }
      await addChatScript({
        id, npcLine, reactions: built, active: true, createdAt: Date.now(), order: nextOrder,
      });
      setId(''); setNpcLine(''); setReactions(emptyReactions());
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (sid: string) => {
    await removeChatScript(sid);
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">{t('admin.chatScripts.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.chatScripts.description')}</p>

      <div className="grid md:grid-cols-2 gap-2 mb-3">
        <input className="input" placeholder={t('admin.chatScripts.id')} value={id} onChange={e => setId(e.target.value)} />
        <input className="input md:col-span-1" placeholder={t('admin.chatScripts.npcLine')} value={npcLine} onChange={e => setNpcLine(e.target.value)} />
      </div>

      <div className="space-y-2">
        {CHAT_RESPONSE_IDS.map(rid => (
          <div key={rid} className="bg-slate-800/50 rounded p-2">
            <p className="text-xs font-semibold text-amber-300 mb-1">{t(`npc.chat.answer.${rid}`)}</p>
            <div className="grid md:grid-cols-5 gap-2">
              <input className="input md:col-span-2 text-xs" placeholder={t('admin.chatScripts.reactionLine')}
                value={reactions[rid].line} onChange={e => setField(rid, 'line', e.target.value)} />
              <input className="input text-xs" type="number" placeholder="XP" value={reactions[rid].xp}
                onChange={e => setField(rid, 'xp', e.target.value)} />
              <input className="input text-xs" type="number" placeholder={t('admin.chatScripts.rep')} value={reactions[rid].rep}
                onChange={e => setField(rid, 'rep', e.target.value)} />
              <input className="input text-xs" placeholder={t('admin.chatScripts.nextScriptId')} value={reactions[rid].nextScriptId}
                onChange={e => setField(rid, 'nextScriptId', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs mt-1 text-slate-400">
              <input type="checkbox" checked={reactions[rid].revealHint} onChange={e => setField(rid, 'revealHint', e.target.checked)} />
              {t('admin.chatScripts.revealHint')}
            </label>
          </div>
        ))}
      </div>

      <button className="btn-primary mt-3" disabled={saving || !id || !npcLine} onClick={submit}>
        {saving ? '⏳' : t('admin.chatScripts.submit')}
      </button>
      {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.chatScripts.saved')}</p>}
      <p className="text-xs text-slate-500 mt-2">{t('admin.chatScripts.hint')}</p>

      {scripts.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.chatScripts.list')}</p>
          <div className="space-y-2">
            {scripts.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>💬 {s.npcLine.slice(0, 60)}{s.npcLine.length > 60 ? '…' : ''}</span>
                <button className="btn-secondary text-xs" onClick={() => remove(s.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
