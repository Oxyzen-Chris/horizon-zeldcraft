/**
 * Journal des nouveautés ("Quoi de neuf ?") affiché dans le widget "Aides" (HelpWidget.tsx) et sur
 * l'écran d'accueil (app/page.tsx) — voir demande utilisateur "ajouter [...] les dernières
 * fonctionnalités qui ont été mise en place récemment et déployées dans le jeu et le menu
 * Administration". Liste maintenue manuellement, entrée la plus récente en premier. Chaque entrée
 * référence des clés i18n (titre + description courte), traduites dans les 4 langues du jeu.
 */
export interface ChangelogEntry {
  date: string;   // AAAA-MM-JJ, à titre indicatif (affiché localisé côté UI)
  icon: string;
  titleKey: string;
  bodyKey: string;
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  { date: '2026-11-04', icon: '🚀', titleKey: 'changelog.adaptivePerformance.title', bodyKey: 'changelog.adaptivePerformance.body' },
  { date: '2026-11-03', icon: '💱', titleKey: 'changelog.fiatTopupCurrencyFix.title', bodyKey: 'changelog.fiatTopupCurrencyFix.body' },
  { date: '2026-11-02', icon: '📌', titleKey: 'changelog.widgetPositionDriftFix.title', bodyKey: 'changelog.widgetPositionDriftFix.body' },
  { date: '2026-11-01', icon: '🗑️', titleKey: 'changelog.stargateDialingBadgeRemoved.title', bodyKey: 'changelog.stargateDialingBadgeRemoved.body' },
  { date: '2026-10-31', icon: '🔊', titleKey: 'changelog.stargateActivationSound.title', bodyKey: 'changelog.stargateActivationSound.body' },
  { date: '2026-10-30', icon: '🌀', titleKey: 'changelog.stargateSizeGrassOnly.title', bodyKey: 'changelog.stargateSizeGrassOnly.body' },
  { date: '2026-10-29', icon: '🔺', titleKey: 'changelog.stargateCrystalQuestTreasure.title', bodyKey: 'changelog.stargateCrystalQuestTreasure.body' },
  { date: '2026-10-28', icon: '🪑', titleKey: 'changelog.stargateConsoleObstacleFix.title', bodyKey: 'changelog.stargateConsoleObstacleFix.body' },
  { date: '2026-10-27', icon: '🚧', titleKey: 'changelog.stargatePortalAllVariants.title', bodyKey: 'changelog.stargatePortalAllVariants.body' },
  { date: '2026-10-26', icon: '🪙', titleKey: 'changelog.stargateObstacleCopper.title', bodyKey: 'changelog.stargateObstacleCopper.body' },
  { date: '2026-10-26', icon: '🌀', titleKey: 'changelog.stargateConsole.title', bodyKey: 'changelog.stargateConsole.body' },
  { date: '2026-10-25', icon: '🤫', titleKey: 'changelog.undergroundPopupSuppression.title', bodyKey: 'changelog.undergroundPopupSuppression.body' },
  { date: '2026-10-25', icon: '🎥', titleKey: 'changelog.cryptExitCameraRaceFix.title', bodyKey: 'changelog.cryptExitCameraRaceFix.body' },
  { date: '2026-10-24', icon: '🐉', titleKey: 'changelog.hiddenDragonFamiliar.title', bodyKey: 'changelog.hiddenDragonFamiliar.body' },
  { date: '2026-10-23', icon: '🎥', titleKey: 'changelog.cryptExitCameraDirection.title', bodyKey: 'changelog.cryptExitCameraDirection.body' },
  { date: '2026-10-22', icon: '🧭', titleKey: 'changelog.cryptExitFacing.title', bodyKey: 'changelog.cryptExitFacing.body' },
  { date: '2026-10-21', icon: '🛋️', titleKey: 'changelog.cryptRoomFurnitureCamera.title', bodyKey: 'changelog.cryptRoomFurnitureCamera.body' },
  { date: '2026-10-20', icon: '🚪', titleKey: 'changelog.cryptRoomFreeRoamExit.title', bodyKey: 'changelog.cryptRoomFreeRoamExit.body' },
  { date: '2026-10-19', icon: '🏯', titleKey: 'changelog.cryptRoomsRealism.title', bodyKey: 'changelog.cryptRoomsRealism.body' },
  { date: '2026-10-18', icon: '🏰', titleKey: 'changelog.cryptTowerTop.title', bodyKey: 'changelog.cryptTowerTop.body' },
  { date: '2026-10-17', icon: '🚫', titleKey: 'changelog.synkActorBlocking.title', bodyKey: 'changelog.synkActorBlocking.body' },
  { date: '2026-10-16', icon: '🪦', titleKey: 'changelog.graveyardCrypts.title', bodyKey: 'changelog.graveyardCrypts.body' },
  { date: '2026-10-15', icon: '🗺️', titleKey: 'changelog.mapmondeSmoothFilters.title', bodyKey: 'changelog.mapmondeSmoothFilters.body' },
  { date: '2026-10-14', icon: '🧭', titleKey: 'changelog.compassBlurRemoved.title', bodyKey: 'changelog.compassBlurRemoved.body' },
  { date: '2026-10-13', icon: '⚡', titleKey: 'changelog.gpuSaturationFollowup.title', bodyKey: 'changelog.gpuSaturationFollowup.body' },
  { date: '2026-10-12', icon: '⚡', titleKey: 'changelog.gpuSaturationFix.title', bodyKey: 'changelog.gpuSaturationFix.body' },
  { date: '2026-10-11', icon: '🏰', titleKey: 'changelog.castleFootprintSynkOrbitFix.title', bodyKey: 'changelog.castleFootprintSynkOrbitFix.body' },
  { date: '2026-10-10', icon: '🤝', titleKey: 'changelog.actorMutualAvoidance.title', bodyKey: 'changelog.actorMutualAvoidance.body' },
  { date: '2026-10-09', icon: '🧭', titleKey: 'changelog.roamObstacleAvoidance.title', bodyKey: 'changelog.roamObstacleAvoidance.body' },
  { date: '2026-10-08', icon: '🐗', titleKey: 'changelog.wildlifeGroundedFinalFix.title', bodyKey: 'changelog.wildlifeGroundedFinalFix.body' },
  { date: '2026-10-07', icon: '🐺', titleKey: 'changelog.wildlifeGroundedFix.title', bodyKey: 'changelog.wildlifeGroundedFix.body' },
  { date: '2026-10-06', icon: '🦵', titleKey: 'changelog.npcGroundedFix.title', bodyKey: 'changelog.npcGroundedFix.body' },
  { date: '2026-10-05', icon: '🇺🇸', titleKey: 'changelog.usLocale.title', bodyKey: 'changelog.usLocale.body' },
  { date: '2026-10-05', icon: '🔒', titleKey: 'changelog.fiatDemoGating.title', bodyKey: 'changelog.fiatDemoGating.body' },
  { date: '2026-10-04', icon: '🪟', titleKey: 'changelog.widgetStackingFix.title', bodyKey: 'changelog.widgetStackingFix.body' },
  { date: '2026-10-03', icon: '🧭', titleKey: 'changelog.platform3dCompass.title', bodyKey: 'changelog.platform3dCompass.body' },
  { date: '2026-10-02', icon: '🧹', titleKey: 'changelog.witchSunOcclusion.title', bodyKey: 'changelog.witchSunOcclusion.body' },
  { date: '2026-10-01', icon: '🧲', titleKey: 'changelog.widgetLayoutPersist.title', bodyKey: 'changelog.widgetLayoutPersist.body' },
  { date: '2026-09-30', icon: '🟦', titleKey: 'changelog.waterPedestalFix.title', bodyKey: 'changelog.waterPedestalFix.body' },
  { date: '2026-09-29', icon: '🐗', titleKey: 'changelog.wildlifeBoarWitch.title', bodyKey: 'changelog.wildlifeBoarWitch.body' },
  { date: '2026-09-28', icon: '🌕', titleKey: 'changelog.ambient3d.title', bodyKey: 'changelog.ambient3d.body' },
  { date: '2026-09-26', icon: '🌗', titleKey: 'changelog.dayNight.title', bodyKey: 'changelog.dayNight.body' },
  { date: '2026-09-20', icon: '🏆', titleKey: 'changelog.leaderboard.title', bodyKey: 'changelog.leaderboard.body' },
  { date: '2026-09-15', icon: '📦', titleKey: 'changelog.worldDrops.title', bodyKey: 'changelog.worldDrops.body' },
  { date: '2026-09-10', icon: '🚶', titleKey: 'changelog.npcMovement.title', bodyKey: 'changelog.npcMovement.body' },
  { date: '2026-09-05', icon: '⏳', titleKey: 'changelog.demoSession.title', bodyKey: 'changelog.demoSession.body' },
];
