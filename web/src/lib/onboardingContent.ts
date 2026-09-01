/**
 * Contenu partagé de la visite guidée (OnboardingWizard.tsx, affichée une fois à l'entrée en jeu)
 * et du widget flottant "Aides" (HelpWidget.tsx, toujours disponible) — une SEULE source de
 * vérité pour ne jamais désynchroniser les deux, conformément à la demande : « tu reproposeras
 * toutes ces explications dans un nouveau widget ». Chaque texte est une clé i18n (fr/en/es/pt) ;
 * ce fichier ne contient que la structure (icônes + regroupement en 3 étapes/catégories).
 */
export interface HelpTopic {
  icon: string;
  titleKey: string;
  bodyKey: string;
}

export interface OnboardingStep {
  icon: string;
  titleKey: string;
  introKey: string;
  topics: HelpTopic[];
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    icon: '🗺️',
    titleKey: 'onboarding.step1.title',
    introKey: 'onboarding.step1.intro',
    topics: [
      { icon: '🌍', titleKey: 'onboarding.topic.world.title', bodyKey: 'onboarding.topic.world.body' },
      { icon: '👹', titleKey: 'onboarding.topic.zorghon.title', bodyKey: 'onboarding.topic.zorghon.body' },
      { icon: '🔮', titleKey: 'onboarding.topic.fragments.title', bodyKey: 'onboarding.topic.fragments.body' },
      { icon: '👑', titleKey: 'onboarding.topic.chapters.title', bodyKey: 'onboarding.topic.chapters.body' },
      { icon: '🧙', titleKey: 'onboarding.topic.npcs.title', bodyKey: 'onboarding.topic.npcs.body' },
      { icon: '🏝️', titleKey: 'onboarding.topic.worldsToExplore.title', bodyKey: 'onboarding.topic.worldsToExplore.body' },
    ],
  },
  {
    icon: '🧩',
    titleKey: 'onboarding.step2.title',
    introKey: 'onboarding.step2.intro',
    topics: [
      { icon: '📜', titleKey: 'onboarding.topic.questTypes.title', bodyKey: 'onboarding.topic.questTypes.body' },
      { icon: '🌕', titleKey: 'onboarding.topic.fullMoon.title', bodyKey: 'onboarding.topic.fullMoon.body' },
      { icon: '🏴‍☠️', titleKey: 'onboarding.topic.islandQuests.title', bodyKey: 'onboarding.topic.islandQuests.body' },
      { icon: '😵', titleKey: 'onboarding.topic.fainting.title', bodyKey: 'onboarding.topic.fainting.body' },
      { icon: '💬', titleKey: 'onboarding.topic.chat.title', bodyKey: 'onboarding.topic.chat.body' },
      { icon: '🍂', titleKey: 'onboarding.topic.seasons.title', bodyKey: 'onboarding.topic.seasons.body' },
      { icon: '📦', titleKey: 'onboarding.topic.dlc.title', bodyKey: 'onboarding.topic.dlc.body' },
    ],
  },
  {
    icon: '🎒',
    titleKey: 'onboarding.step3.title',
    introKey: 'onboarding.step3.intro',
    topics: [
      { icon: '🍗', titleKey: 'onboarding.topic.feeding.title', bodyKey: 'onboarding.topic.feeding.body' },
      { icon: '🏕️', titleKey: 'onboarding.topic.huts.title', bodyKey: 'onboarding.topic.huts.body' },
      { icon: '📊', titleKey: 'onboarding.topic.stats.title', bodyKey: 'onboarding.topic.stats.body' },
      { icon: '🎲', titleKey: 'onboarding.topic.dice.title', bodyKey: 'onboarding.topic.dice.body' },
      { icon: '⚔️', titleKey: 'onboarding.topic.combat.title', bodyKey: 'onboarding.topic.combat.body' },
      { icon: '🧪', titleKey: 'onboarding.topic.potions.title', bodyKey: 'onboarding.topic.potions.body' },
      { icon: '⚗️', titleKey: 'onboarding.topic.elixirs.title', bodyKey: 'onboarding.topic.elixirs.body' },
      { icon: '🗺️', titleKey: 'onboarding.topic.mapmonde.title', bodyKey: 'onboarding.topic.mapmonde.body' },
      { icon: '🌊', titleKey: 'onboarding.topic.waterMountain.title', bodyKey: 'onboarding.topic.waterMountain.body' },
      { icon: '🧱', titleKey: 'onboarding.topic.platform3d.title', bodyKey: 'onboarding.topic.platform3d.body' },
      { icon: '🎒', titleKey: 'onboarding.topic.bagEquip.title', bodyKey: 'onboarding.topic.bagEquip.body' },
      { icon: '🐾', titleKey: 'onboarding.topic.familiars.title', bodyKey: 'onboarding.topic.familiars.body' },
      { icon: '🛒', titleKey: 'onboarding.topic.shop.title', bodyKey: 'onboarding.topic.shop.body' },
      { icon: '👑', titleKey: 'onboarding.topic.widgetsChatKingdom.title', bodyKey: 'onboarding.topic.widgetsChatKingdom.body' },
      { icon: '📸', titleKey: 'onboarding.topic.instagram.title', bodyKey: 'onboarding.topic.instagram.body' },
      { icon: '💎', titleKey: 'onboarding.topic.eth.title', bodyKey: 'onboarding.topic.eth.body' },
      { icon: '🎟️', titleKey: 'onboarding.topic.demoFiat.title', bodyKey: 'onboarding.topic.demoFiat.body' },
      { icon: '🔑', titleKey: 'onboarding.topic.accountSecurity.title', bodyKey: 'onboarding.topic.accountSecurity.body' },
    ],
  },
];
