import { expect } from "chai";
import { ethers } from "hardhat";
import { HorizonZeldCraft } from "../typechain-types";

describe("HorizonZeldCraft", () => {
  let contract: HorizonZeldCraft;
  let owner: any, player: any, treasury: any;

  beforeEach(async () => {
    [owner, player, treasury] = await ethers.getSigners();
    const F = await ethers.getContractFactory("HorizonZeldCraft");
    contract = (await F.deploy(treasury.address)) as unknown as HorizonZeldCraft;
    await contract.waitForDeployment();
  });

  it("mints one Voxlyn per wallet", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    expect(await contract.voxlynOf(player.address)).to.equal(1n);
    await expect(contract.connect(player).mintVoxlyn("Draco2"))
      .to.be.revertedWith("already has voxlyn");
  });

  it("feeds and transfers ETH to treasury", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const price = await contract.feedPrice(0); // Daily
    const before = await ethers.provider.getBalance(treasury.address);
    await contract.connect(player).feed(1, 0, { value: price });
    const after = await ethers.provider.getBalance(treasury.address);
    expect(after - before).to.equal(price);
    const v = await contract.voxlyns(1);
    expect(v.xp).to.equal(10n);
  });

  it("enforces feed cooldown", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const price = await contract.feedPrice(0);
    await contract.connect(player).feed(1, 0, { value: price });
    await expect(contract.connect(player).feed(1, 0, { value: price }))
      .to.be.revertedWith("feed cooldown");
  });

  it("owner can add catalog item and player can buy it", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const id = ethers.id("potion.life");
    await contract.connect(owner).addCatalogItem(id, "Potion", ethers.parseEther("0.0001"));
    await contract.connect(player).buyCatalogItem(1, id, { value: ethers.parseEther("0.0001") });
    expect(await contract.inventory(1, id)).to.equal(1n);
  });

  it("levels up after enough XP", async () => {
    await contract.connect(player).mintVoxlyn("Draco");
    const yearlyPrice = await contract.feedPrice(3);
    await contract.connect(player).feed(1, 3, { value: yearlyPrice });
    const v = await contract.voxlyns(1);
    expect(v.level).to.be.greaterThan(1n);
  });

  it("only owner can pause", async () => {
    await expect(contract.connect(player).pause())
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });
});
