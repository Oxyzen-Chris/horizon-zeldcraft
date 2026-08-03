'use client';

import { useEffect, useState } from 'react';
import {
  addCustomWidget, getCustomWidgets, removeCustomWidget, getRepRules, setRepRules,
  type CustomWidgetDef, type CustomWidgetActionType, type CustomWidgetAnimation, type CustomWidgetEffect,
  type RepRules,
} from '@/lib/gameState';
import { useI18n } from '@/lib/i18n';

interface EffectForm {
  wallet: string; xpBonus: string; reputation: string;
  hp: string; hunger: string; happiness: string; force: string; spells: string;
}
interface ButtonForm {
  label: string;
  actionType: CustomWidgetActionType;
  actionUrl: string;
  actionMessage: string;
  effect: EffectForm;
}

const emptyEffect = (): EffectForm => ({
  wallet: '', xpBonus: '', reputation: '', hp: '', hunger: '', happiness: '', force: '', spells: '',
});
const emptyButton = (): ButtonForm => ({ label: '', actionType: 'none', actionUrl: '', actionMessage: '', effect: emptyEffect() });

const ANIMATIONS: CustomWidgetAnimation[] = ['none', 'pulse', 'bounce', 'glow'];
const ACTION_TYPES: CustomWidgetActionType[] = ['none', 'link', 'message', 'effect'];
const EFFECT_FIELDS: (keyof EffectForm)[] = ['wallet', 'xpBonus', 'reputation', 'hp', 'hunger', 'happiness', 'force', 'spells'];

/** Clés `RepRules` booléennes couvertes par le tableau `BUILTIN_WIDGETS` ci-dessous — union
 * explicite (plutôt que `keyof RepRules`, trop large) pour garantir au typage que `rules[w.key]`
 * est bien un `boolean` et que `toggleBuiltinWidget` ne peut recevoir qu'une de ces clés. */
type BuiltinWidgetKey =
  | 'diceRollWidgetEnabled' | 'teamChatWidgetEnabled' | 'equipmentWidgetEnabled' | 'inventoryWidgetEnabled'
  | 'shopWidgetEnabled' | 'worldMapWidgetEnabled' | 'statsWidgetEnabled' | 'kingdomQuestsWidgetEnabled'
  | 'questsZeldaCraftWidgetEnabled' | 'helpWidgetEnabled' | 'progressWidgetEnabled' | 'walletTopupWidgetEnabled';

/** Widgets flottants EXISTANTS du jeu pouvant être masqués/réaffichés globalement par l'admin (voir
 * demande utilisateur). Volontairement exclu : `GameCanvas2D` (plateforme 2D isométrique — cœur du
 * jeu, sa désactivation rendrait le jeu injouable) ainsi que WeatherWidget/SeasonWidget/MoonWidget
 * (bandeaux fixes d'en-tête, pas des fenêtres flottantes déplaçables). Chaque entrée correspond à
 * un booléen `RepRules.<key>` déjà lu par le composant concerné dans game/page.tsx (défaut true —
 * comportement identique à avant l'introduction de ces interrupteurs tant que rien n'est décoché). */
const BUILTIN_WIDGETS: { key: BuiltinWidgetKey; icon: string; labelKey: string }[] = [
  { key: 'diceRollWidgetEnabled', icon: '🎲', labelKey: 'admin.customWidgets.builtin.dice' },
  { key: 'teamChatWidgetEnabled', icon: '💬', labelKey: 'admin.customWidgets.builtin.teamChat' },
  { key: 'equipmentWidgetEnabled', icon: '🧍', labelKey: 'admin.customWidgets.builtin.equipment' },
  { key: 'inventoryWidgetEnabled', icon: '🎒', labelKey: 'admin.customWidgets.builtin.inventory' },
  { key: 'shopWidgetEnabled', icon: '🏪', labelKey: 'admin.customWidgets.builtin.shop' },
  { key: 'worldMapWidgetEnabled', icon: '🗺️', labelKey: 'admin.customWidgets.builtin.worldMap' },
  { key: 'statsWidgetEnabled', icon: '📊', labelKey: 'admin.customWidgets.builtin.stats' },
  { key: 'kingdomQuestsWidgetEnabled', icon: '👑', labelKey: 'admin.customWidgets.builtin.kingdomQuests' },
  { key: 'questsZeldaCraftWidgetEnabled', icon: '🧭', labelKey: 'admin.customWidgets.builtin.questsZeldaCraft' },
  { key: 'helpWidgetEnabled', icon: '❓', labelKey: 'admin.customWidgets.builtin.help' },
  { key: 'progressWidgetEnabled', icon: '📖', labelKey: 'admin.customWidgets.builtin.progress' },
  { key: 'walletTopupWidgetEnabled', icon: '💰', labelKey: 'admin.customWidgets.builtin.walletTopup' },
];

/**
 * Panneau admin — activation/désactivation des widgets flottants EXISTANTS du jeu (voir
 * `BUILTIN_WIDGETS` ci-dessus), puis catalogue de widgets flottants génériques ADMIN (100%
 * hors-chaîne). Chaque widget = un titre, un contenu, une icône/animation, une condition
 * d'affichage (XP min) et une liste de boutons dont l'action est choisie parmi un ensemble
 * prédéfini et sûr (lien externe, message, ou effet appliqué au joueur) — même esprit que
 * `ChatScriptsAdminPanel`.
 */
export function CustomWidgetsAdminPanel() {
  const { t } = useI18n();
  const [widgets, setWidgets] = useState<CustomWidgetDef[]>([]);
  const [rules, setRules] = useState<RepRules | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [icon, setIcon] = useState('🧩');
  const [animation, setAnimation] = useState<CustomWidgetAnimation>('none');
  const [minXp, setMinXp] = useState('');
  const [buttons, setButtons] = useState<ButtonForm[]>([emptyButton()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = () => getCustomWidgets().then(setWidgets).catch(() => {});
  useEffect(() => { reload(); getRepRules().then(setRules).catch(() => {}); }, []);

  // Bascule immédiate d'un widget (pas de bouton "Enregistrer" séparé, comme pour la liste de
  // widgets admin ci-dessous) — relit toujours `getRepRules()` juste avant d'écrire pour fusionner
  // avec la valeur la plus récente côté serveur plutôt que d'écraser aveuglément l'objet local
  // (setRepRules fait un `set()` complet), au cas où un autre onglet Administration (RepRulesPanel)
  // aurait modifié un autre champ entre-temps.
  const toggleBuiltinWidget = async (key: BuiltinWidgetKey, checked: boolean) => {
    setTogglingKey(key);
    try {
      const fresh = await getRepRules();
      const next = { ...fresh, [key]: checked };
      await setRepRules(next);
      setRules(next);
    } finally {
      setTogglingKey(null);
    }
  };

  const setButtonField = (i: number, field: keyof ButtonForm, value: string) => {
    setButtons(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: value } : b));
  };
  const setButtonEffect = (i: number, field: keyof EffectForm, value: string) => {
    setButtons(prev => prev.map((b, idx) => idx === i ? { ...b, effect: { ...b.effect, [field]: value } } : b));
  };
  const addButtonRow = () => setButtons(prev => [...prev, emptyButton()]);
  const removeButtonRow = (i: number) => setButtons(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!id || !title || !content) return;
    setSaving(true);
    setSaved(false);
    try {
      const existing = await getCustomWidgets();
      const nextOrder = existing.length ? Math.max(...existing.map(w => w.order ?? 0)) + 1 : 0;
      const builtButtons = buttons
        .filter(b => b.label.trim())
        .map(b => {
          let effect: CustomWidgetEffect | undefined;
          if (b.actionType === 'effect') {
            effect = {};
            for (const f of EFFECT_FIELDS) {
              if (b.effect[f]) effect[f] = Number(b.effect[f]);
            }
          }
          return {
            label: b.label.trim(),
            actionType: b.actionType,
            actionUrl: b.actionType === 'link' ? b.actionUrl.trim() || undefined : undefined,
            actionMessage: b.actionType === 'message' ? b.actionMessage.trim() || undefined : undefined,
            effect,
          };
        });
      await addCustomWidget({
        id, title, content, icon: icon.trim() || '🧩', animation,
        minXp: minXp ? Number(minXp) : undefined,
        buttons: builtButtons, active: true, createdAt: Date.now(), order: nextOrder,
      });
      setId(''); setTitle(''); setContent(''); setIcon('🧩'); setAnimation('none'); setMinXp('');
      setButtons([emptyButton()]);
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (wid: string) => {
    await removeCustomWidget(wid);
    await reload();
  };

  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-3">{t('admin.customWidgets.title')}</h2>
      <p className="text-xs text-slate-400 mb-3">{t('admin.customWidgets.description')}</p>

      <div className="mb-5 pb-4 border-b border-slate-700">
        <p className="text-sm font-semibold mb-1">{t('admin.customWidgets.builtin.title')}</p>
        <p className="text-xs text-slate-400 mb-2">{t('admin.customWidgets.builtin.description')}</p>
        {!rules ? (
          <p className="text-xs text-slate-500 italic">{t('common.loading')}</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-1.5">
            {BUILTIN_WIDGETS.map(w => (
              <label key={w.key} className="flex items-center gap-2 text-xs bg-slate-800/40 rounded px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={rules[w.key] !== false}
                  disabled={togglingKey === w.key}
                  onChange={e => toggleBuiltinWidget(w.key, e.target.checked)}
                />
                <span>{w.icon} {t(w.labelKey)}</span>
                {togglingKey === w.key && <span className="opacity-60">⏳</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-4 gap-2 mb-2">
        <input className="input" placeholder={t('admin.customWidgets.id')} value={id} onChange={e => setId(e.target.value)} />
        <input className="input" placeholder={t('admin.customWidgets.widgetTitle')} value={title} onChange={e => setTitle(e.target.value)} />
        <input className="input" placeholder={t('admin.customWidgets.icon')} value={icon} onChange={e => setIcon(e.target.value)} maxLength={4} />
        <input className="input" type="number" placeholder={t('admin.customWidgets.minXp')} value={minXp} onChange={e => setMinXp(e.target.value)} />
      </div>
      <textarea className="input w-full mb-2" rows={2} placeholder={t('admin.customWidgets.content')}
        value={content} onChange={e => setContent(e.target.value)} />
      <label className="text-xs block mb-3">
        <span className="text-slate-400 mr-2">{t('admin.customWidgets.animation')}</span>
        <select className="input inline-block w-auto" value={animation} onChange={e => setAnimation(e.target.value as CustomWidgetAnimation)}>
          {ANIMATIONS.map(a => <option key={a} value={a}>{t(`admin.customWidgets.animation.${a}`)}</option>)}
        </select>
      </label>

      <p className="text-sm font-semibold mb-2">{t('admin.customWidgets.buttons')}</p>
      <div className="space-y-2">
        {buttons.map((b, i) => (
          <div key={i} className="bg-slate-800/50 rounded p-2 space-y-2">
            <div className="grid md:grid-cols-3 gap-2">
              <input className="input text-xs" placeholder={t('admin.customWidgets.buttonLabel')}
                value={b.label} onChange={e => setButtonField(i, 'label', e.target.value)} />
              <select className="input text-xs" value={b.actionType} onChange={e => setButtonField(i, 'actionType', e.target.value)}>
                {ACTION_TYPES.map(a => <option key={a} value={a}>{t(`admin.customWidgets.actionType.${a}`)}</option>)}
              </select>
              <button className="btn-secondary text-xs" onClick={() => removeButtonRow(i)}>✕ {t('admin.customWidgets.removeButton')}</button>
            </div>
            {b.actionType === 'link' && (
              <input className="input text-xs w-full" placeholder={t('admin.customWidgets.actionUrl')}
                value={b.actionUrl} onChange={e => setButtonField(i, 'actionUrl', e.target.value)} />
            )}
            {b.actionType === 'message' && (
              <input className="input text-xs w-full" placeholder={t('admin.customWidgets.actionMessage')}
                value={b.actionMessage} onChange={e => setButtonField(i, 'actionMessage', e.target.value)} />
            )}
            {b.actionType === 'effect' && (
              <div className="grid md:grid-cols-4 gap-2">
                {EFFECT_FIELDS.map(f => (
                  <input key={f} className="input text-xs" type="number" placeholder={t(`admin.customWidgets.effect.${f}`)}
                    value={b.effect[f]} onChange={e => setButtonEffect(i, f, e.target.value)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="btn-secondary text-xs mt-2" onClick={addButtonRow}>+ {t('admin.customWidgets.addButton')}</button>

      <div className="mt-3">
        <button className="btn-primary" disabled={saving || !id || !title || !content} onClick={submit}>
          {saving ? '⏳' : t('admin.customWidgets.submit')}
        </button>
        {saved && <p className="text-xs text-emerald-400 mt-2">✅ {t('admin.customWidgets.saved')}</p>}
        <p className="text-xs text-slate-500 mt-2">{t('admin.customWidgets.hint')}</p>
      </div>

      {widgets.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold mb-2">{t('admin.customWidgets.list')}</p>
          <div className="space-y-2">
            {widgets.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 text-sm">
                <span>{w.icon ?? '🧩'} {w.title}</span>
                <button className="btn-secondary text-xs" onClick={() => remove(w.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
