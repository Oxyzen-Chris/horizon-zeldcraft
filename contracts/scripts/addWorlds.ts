import { ethers, network } from "hardhat";

/**
 * Seed incrémental de nouveaux mondes sur un contrat déjà déployé (sans redéploiement
 * complet). Idempotent : ignore silencieusement tout monde déjà actif (`worlds[id].active`),
 * donc peut être relancé sans risque. Complète `deploy.ts` § Seed mondes (source de vérité
 * pour un futur redéploiement, ex. Mainnet).
 *
 * Usage : npx hardhat run scripts/addWorlds.ts --network sepolia
 */
const CONTRACT_ADDRESS = "0x4fb0CF9865f50993fb61284466d6029607dF00c3"; // Sepolia (web/.env.local)

const NEW_WORLDS: [string, string, number][] = [
  ["world.ember_wastes", "Landes Cendrées d'Ember", 10000],
  ["world.frostfall_peaks", "Pics Gelés de Frostfall", 20000],
  ["world.shadowmere_marsh", "Marécages de Shadowmere", 35000],
  ["world.skyreach_spire", "Flèche Céleste de Skyreach", 50000],
  ["world.stargate_aethyria", "Portail des Étoiles d'Aethyria", 75000],
  ["world.eternum_sanctum", "Sanctuaire Éternel d'Eternum", 100000],
];

async function main() {
  console.log(`\n🌍 Ajout de nouveaux mondes sur ${network.name} (${CONTRACT_ADDRESS})`);
  const c = await ethers.getContractAt("HorizonZeldCraft", CONTRACT_ADDRESS);
  const id = (s: string) => ethers.id(s);

  for (const [key, name, xp] of NEW_WORLDS) {
    const worldId = id(key);
    const existing = await c.worlds(worldId);
    if (existing.active) {
      console.log(`   ↷ déjà présent : ${name}`);
      continue;
    }
    const tx = await c.addWorld(worldId, name, xp);
    await tx.wait();
    console.log(`   + ${name} (${xp} XP) — tx ${tx.hash}`);
  }

  const len = await c.worldsLength();
  console.log(`\n✅ Total mondes on-chain : ${len}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
