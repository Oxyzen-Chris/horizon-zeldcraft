import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury || !treasury.startsWith("0x")) {
    throw new Error("TREASURY_ADDRESS manquant dans .env");
  }

  console.log(`\n🚀 Déploiement HorizonZeldCraft sur ${network.name}`);
  console.log(`   Trésorerie : ${treasury}`);

  const Factory = await ethers.getContractFactory("HorizonZeldCraft");
  const contract = await Factory.deploy(treasury);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✅ Déployé à : ${address}`);

  // Seed initial : quelques items et quêtes
  console.log("\n🌱 Seed initial du catalogue...");
  const id = (s: string) => ethers.id(s); // keccak256

  const items: [string, string, string][] = [
    ["potion.life",       "Potion de vie",        "0.00005"],
    ["spell.crystal_fire","Sort : Feu Cristal",   "0.0003"],
    ["skin.summer",       "Skin été",             "0.001"],
    ["portal.zephyria",   "Portail Zephyria",     "0.0002"],
    ["portal.nether",     "Portail Nether-Cristal","0.0008"],
    ["armor.iron",        "Armure de fer",        "0.0005"],
    ["sword.epic",        "Épée épique",          "0.002"],
  ];
  for (const [key, label, ethPrice] of items) {
    const tx = await contract.addCatalogItem(id(key), label, ethers.parseEther(ethPrice));
    await tx.wait();
    console.log(`   + ${label}`);
  }

  const quests: [string, string, number, number][] = [
    ["quest.first_steps",   "Premiers pas",              0,   50],
    ["quest.forest_boss",   "Boss de la Forêt",        200,  300],
    ["quest.nether_dive",   "Plongée Nether",         1000, 1500],
    ["quest.azeroth_raid",  "Raid Azerothyl",         5000, 8000],
  ];
  for (const [key, label, req, rew] of quests) {
    const tx = await contract.addQuest(id(key), label, req, rew);
    await tx.wait();
    console.log(`   + Quête : ${label}`);
  }

  console.log("\n🎉 Terminé !");
  console.log(`\nÀ ajouter dans web/.env.local :`);
  if (network.name === "sepolia") {
    console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA=${address}`);
  } else if (network.name === "mainnet") {
    console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS_MAINNET=${address}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
