import { expect } from "chai";
import { ethers } from "hardhat";
import { HorizonZeldCraft } from "../typechain-types";

describe("HorizonZeldCraft v2", () => {
  let contract: HorizonZeldCraft;
  let owner: any, player: any, player2: any, treasury: any;

  const id = (s: string) => ethers.id(s);
  const hash = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

  beforeEach(async () => {
    [owner, player, player2, treasury] = await ethers.getSigners();
    const F = await ethers.getContractFactory("HorizonZeldCraft");
    contract = (await F.deploy(treasury.address)) as unknown as HorizonZeldCraft;
    await contract.waitForDeployment();
  });

  it("mints, feeds, levels up", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const price = await contract.feedPrice(3); // Yearly
    await contract.connect(player).feed(1, 3, { value: price });
    const v = await contract.voxlyns(1);
    expect(v.xp).to.equal(6000n);
    expect(v.level).to.be.greaterThan(1n);
  });

  it("solves quest with correct answer, rewards XP + score + treasure", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const tId = id("treasure.epicsword");
    await contract.addTreasure(tId, "Épée épique", 50);
    const qId = id("quest.riddle1");
    await contract.addQuest(qId, "Quelle est ma couleur ?", 0, 100, 200, hash("cristal"), tId, 0);
    await contract.connect(player).submitQuestAnswer(1, qId, "cristal");
    const v = await contract.voxlyns(1);
    expect(v.xp).to.equal(150n); // 100 quest + 50 treasure
    expect(await contract.playerScore(1)).to.equal(200n);
    expect(await contract.treasureFound(1, tId)).to.equal(true);
  });

  it("rejects wrong quest answer", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const qId = id("quest.r");
    await contract.addQuest(qId, "?", 0, 10, 10, hash("bonne"), ethers.ZeroHash, 0);
    await expect(contract.connect(player).submitQuestAnswer(1, qId, "mauvaise"))
      .to.be.revertedWith("wrong answer");
    expect(await contract.questCompleted(1, qId)).to.equal(false);
  });

  it("meets NPC and earns XP", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const nId = id("npc.zelda");
    await contract.addNpc(nId, "Zelda", "Bienvenue…", 42, ethers.ZeroHash);
    await contract.connect(player).meetNpc(1, nId);
    expect((await contract.voxlyns(1)).xp).to.equal(42n);
    expect(await contract.npcMet(1, nId)).to.equal(true);
  });

  it("discovers world with enough XP", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const wId = id("world.nether");
    await contract.addWorld(wId, "Nether-Cristal", 5);
    await expect(contract.connect(player).discoverWorld(1, wId))
      .to.be.revertedWith("xp too low");
    // gain XP via feed
    await contract.connect(player).feed(1, 0, { value: await contract.feedPrice(0) });
    await contract.connect(player).discoverWorld(1, wId);
    expect(await contract.worldUnlocked(1, wId)).to.equal(true);
  });

  it("admin sets weather and difficulty", async () => {
    await contract.setWeather(3); // Stormy
    expect(await contract.currentWeather()).to.equal(3);
    await contract.setDifficulty(75);
    expect(await contract.difficulty()).to.equal(75);
  });

  it("teams: create, join, leave, chat", async () => {
    await contract.connect(player).createTeam("Dragons");
    expect(await contract.teamOf(player.address)).to.equal(1n);
    await contract.connect(player2).joinTeam(1);
    const members = await contract.getTeamMembers(1);
    expect(members.length).to.equal(2);
    await expect(contract.connect(player).sendTeamMessage("Salut équipe !"))
      .to.emit(contract, "TeamMessage");
    await contract.connect(player2).leaveTeam();
    expect(await contract.teamOf(player2.address)).to.equal(0n);
  });

  it("only owner can pause", async () => {
    await expect(contract.connect(player).pause())
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });

  it("owner can adjust cooldown", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const price = await contract.feedPrice(0);
    await contract.connect(player).feed(1, 0, { value: price });
    await expect(contract.connect(player).feed(1, 0, { value: price }))
      .to.be.revertedWith("feed cooldown");
    await contract.setFeedCooldown(0, 0);
    await contract.connect(player).feed(1, 0, { value: price });
  });
});
