import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury || !treasury.startsWith("0x")) throw new Error("TREASURY_ADDRESS manquant");

  console.log(`\n🚀 Déploiement HorizonZeldCraft v2 sur ${network.name}`);
  console.log(`   Trésorerie : ${treasury}`);

  const F = await ethers.getContractFactory("HorizonZeldCraft");
  const c = await F.deploy(treasury);
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log(`✅ Déployé à : ${address}`);

  const id = (s: string) => ethers.id(s);
  // Normalisation identique côté front (contract.ts::normalizeAnswer) :
  // minuscules + trim + suppression des accents + espaces multiples → 1
  const normalize = (s: string) => s
    .toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const hash = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(normalize(s)));
  const ZERO = ethers.ZeroHash;

  console.log("\n🌱 Seed catalogue (boutique)...");
  const items: [string, string, string][] = [
    ["potion.life", "Potion de vie", "0.00005"],
    ["spell.crystal_fire", "Sort : Feu Cristal", "0.0003"],
    ["skin.summer", "Skin été", "0.001"],
    ["portal.zephyria", "Portail Zephyria", "0.0002"],
    ["portal.nether", "Portail Nether-Cristal", "0.0008"],
    ["armor.iron", "Armure de fer", "0.0005"],
    ["sword.epic", "Épée épique légendaire", "0.002"],
  ];
  for (const [k, l, p] of items) {
    await (await c.addCatalogItem(id(k), l, ethers.parseEther(p))).wait();
    console.log(`   + ${l}`);
  }

  console.log("\n💎 Seed trésors...");
  const treasures: [string, string, number][] = [
    ["treasure.master_sword", "Épée de maître (Zelda)", 100],
    ["treasure.diamond_pickaxe", "Pioche en diamant (MC)", 80],
    ["treasure.thunderfury", "Thunderfury (WoW)", 500],
    ["treasure.rupees", "Bourse de rubis", 30],
    ["treasure.dragon_egg", "Œuf de dragon ancien", 250],
  ];
  for (const [k, n, xp] of treasures) {
    await (await c.addTreasure(id(k), n, xp)).wait();
    console.log(`   + ${n}`);
  }

  console.log("\n🗺️  Seed mondes...");
  const worlds: [string, string, number][] = [
    ["world.zephyria", "Forêt de Zephyria", 0],
    ["world.nether_cristal", "Grottes de Nether-Cristal", 200],
    ["world.azerothyl", "Sanctuaire d'Azerothyl", 1000],
    ["world.nexus", "Nexus Temporel", 5000],
    // Mondes étendus (au-delà de 5000 XP) — voir aussi scripts/addWorlds.ts pour le
    // seed incrémental sur un contrat déjà déployé (sans redéploiement complet).
    ["world.ember_wastes", "Landes Cendrées d'Ember", 10000],
    ["world.frostfall_peaks", "Pics Gelés de Frostfall", 20000],
    ["world.shadowmere_marsh", "Marécages de Shadowmere", 35000],
    ["world.skyreach_spire", "Flèche Céleste de Skyreach", 50000],
    ["world.stargate_aethyria", "Portail des Étoiles d'Aethyria", 75000],
    ["world.eternum_sanctum", "Sanctuaire Éternel d'Eternum", 100000],
  ];
  for (const [k, n, xp] of worlds) {
    await (await c.addWorld(id(k), n, xp)).wait();
    console.log(`   + ${n}`);
  }

  console.log("\n📜 Seed quêtes à énigmes...");
  //   [id,         label,                                                              xpReq, xpRew, score, answer,       treasure,                       minDiff]
  const quests: [string, string, number, number, number, string, string, number][] = [
    ["quest.riddle_first",
      "🪨 Énigme 1 : Je suis dur comme la pierre mais je flotte sur l'eau. Que suis-je ?",
      0, 50, 100, "glace", "treasure.rupees", 0],
    ["quest.riddle_zelda",
      "🗡️ Énigme 2 (Zelda) : Quelle arme légendaire scelle le mal à Hyrule ?",
      50, 100, 200, "master sword", "treasure.master_sword", 0],
    ["quest.riddle_mc",
      "⛏️ Énigme 3 (Minecraft) : Quel bloc dois-je miner pour crafter une pioche en diamant ?",
      100, 150, 300, "diamant", "treasure.diamond_pickaxe", 20],
    ["quest.riddle_wow",
      "⚔️ Énigme 4 (WoW) : Quel est le nom de l'épée légendaire forgée à partir des éclats de Thunderaan ?",
      500, 400, 600, "thunderfury", "treasure.thunderfury", 40],
    ["quest.riddle_dragon",
      "🐉 Énigme 5 (Voxlyn) : De quelle matière sont les écailles d'un Voxlyn ?",
      1000, 600, 800, "cristal", "treasure.dragon_egg", 60],
  ];
  for (const [k, l, xpR, xpW, sc, ans, tr, md] of quests) {
    await (await c.addQuest(id(k), l, xpR, xpW, sc, hash(ans), id(tr), md)).wait();
    console.log(`   + ${l.slice(0, 60)}…`);
  }

  console.log("\n🧙 Seed PNJ...");
  const npcs: [string, string, string, number, string][] = [
    ["npc.zelda_princess", "Princesse Zelda", "Bienvenue, jeune dresseur ! J'ai une énigme pour toi…", 30, "quest.riddle_zelda"],
    ["npc.steve", "Steve le Mineur", "Yo ! T'as vu mes diamants ?", 20, "quest.riddle_mc"],
    ["npc.thrall", "Thrall (Chef de la Horde)", "Lok'tar Ogar, jeune Voxlyn !", 50, "quest.riddle_wow"],
    ["npc.merchant", "Marchand ambulant", "J'ai des potions rares… mais il te faudra résoudre mon énigme.", 15, "quest.riddle_first"],
    ["npc.ancient_dragon", "Dragon Ancestral", "Prouve-moi que tu es digne de ma sagesse.", 100, "quest.riddle_dragon"],
  ];
  for (const [k, n, d, xp, q] of npcs) {
    await (await c.addNpc(id(k), n, d, xp, id(q))).wait();
    console.log(`   + ${n}`);
  }

  console.log("\n🎉 Terminé !");
  console.log(`\n📋 À ajouter dans web/.env.local ET dans Vercel :`);
  if (network.name === "sepolia") {
    console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA=${address}`);
  } else if (network.name === "mainnet") {
    console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET=${address}`);
  }
  console.log(`\n🔍 Verify :`);
  console.log(`npx hardhat verify --network ${network.name} ${address} ${treasury}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
