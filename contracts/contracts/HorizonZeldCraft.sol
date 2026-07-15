// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title HorizonZeldCraft — Voxlyn Tamagotchi
 * @author Horizon ZeldCraft Team
 * @notice Un Tamagotchi Web3 où chaque joueur possède un Voxlyn (NFT ERC-721)
 *         qu'il doit nourrir régulièrement en stakant des ETH. Les ETH stakés
 *         sont envoyés à une adresse trésorerie configurable par l'owner.
 * @dev    Déployable sur Sepolia (testnet) et Ethereum Mainnet.
 *         Le catalogue (items, quêtes) est extensible on-chain sans redéploiement.
 */
contract HorizonZeldCraft is ERC721, Ownable2Step, ReentrancyGuard, Pausable {
    // ────────────────────────────────────────────────────────────────────────
    // Types
    // ────────────────────────────────────────────────────────────────────────

    enum FeedType { Daily, Weekly, Monthly, Yearly }

    enum Stage { Egg, Hatched, Juvenile, Adult, Ancient }

    struct Voxlyn {
        string  name;
        uint64  bornAt;
        uint64  lastFedAt;
        uint32  xp;
        uint16  hp;
        uint16  happiness;
        uint16  hunger;      // 0 = affamé, 100 = repu
        uint32  level;
        Stage   stage;
    }

    struct CatalogItem {
        string   label;      // "Potion de vie", "Skin été", "Sort Feu Cristal"
        uint256  priceWei;
        bool     active;
    }

    struct Quest {
        string   label;
        uint32   xpRequired;
        uint32   xpReward;
        bool     active;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Storage
    // ────────────────────────────────────────────────────────────────────────

    uint256 public nextTokenId = 1;
    address payable public treasury;

    mapping(uint256 => Voxlyn) public voxlyns;
    mapping(address => uint256) public voxlynOf; // 1 Voxlyn / wallet

    // Prix de nourrissage (indexé par FeedType)
    mapping(FeedType => uint256) public feedPrice;
    mapping(FeedType => uint32)  public feedXpReward;
    mapping(FeedType => uint64)  public feedCooldown; // secondes

    // Catalogue extensible : ownerContract peut ajouter items / quêtes
    mapping(bytes32 => CatalogItem) public catalog;
    bytes32[] public catalogIds;

    mapping(bytes32 => Quest) public quests;
    bytes32[] public questIds;

    // Inventaire par Voxlyn
    mapping(uint256 => mapping(bytes32 => uint32)) public inventory;
    // Quêtes actives / complétées
    mapping(uint256 => mapping(bytes32 => bool)) public questStarted;
    mapping(uint256 => mapping(bytes32 => bool)) public questCompleted;

    // ────────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────────

    event VoxlynMinted(address indexed player, uint256 indexed tokenId, string name);
    event Fed(uint256 indexed tokenId, FeedType feedType, uint256 amount, uint32 newXp);
    event LevelUp(uint256 indexed tokenId, uint32 newLevel, Stage newStage);
    event ItemBought(uint256 indexed tokenId, bytes32 indexed itemId, uint256 price);
    event QuestStarted(uint256 indexed tokenId, bytes32 indexed questId);
    event QuestCompleted(uint256 indexed tokenId, bytes32 indexed questId, uint32 xpGained);
    event CatalogItemAdded(bytes32 indexed itemId, string label, uint256 price);
    event QuestAdded(bytes32 indexed questId, string label, uint32 xpRequired, uint32 xpReward);
    event PriceChanged(FeedType feedType, uint256 newPrice);
    event TreasuryChanged(address newTreasury);
    event Withdrawn(uint256 amount);

    // ────────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────────

    constructor(address payable _treasury) ERC721("Voxlyn", "VOX") Ownable(msg.sender) {
        require(_treasury != address(0), "treasury=0");
        treasury = _treasury;

        // Prix par défaut (adaptés Mainnet ; sur Sepolia l'owner peut monter les valeurs)
        feedPrice[FeedType.Daily]   = 0.0001 ether;
        feedPrice[FeedType.Weekly]  = 0.0005 ether;
        feedPrice[FeedType.Monthly] = 0.002  ether;
        feedPrice[FeedType.Yearly]  = 0.02   ether;

        feedXpReward[FeedType.Daily]   = 10;
        feedXpReward[FeedType.Weekly]  = 80;
        feedXpReward[FeedType.Monthly] = 400;
        feedXpReward[FeedType.Yearly]  = 6000;

        feedCooldown[FeedType.Daily]   = 20 hours;    // un peu de flexibilité
        feedCooldown[FeedType.Weekly]  = 6 days;
        feedCooldown[FeedType.Monthly] = 28 days;
        feedCooldown[FeedType.Yearly]  = 350 days;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Mint
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Crée un Voxlyn (limité à 1 par wallet).
    function mintVoxlyn(string calldata name_) external whenNotPaused returns (uint256 tokenId) {
        require(voxlynOf[msg.sender] == 0, "already has voxlyn");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "name len");

        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);

        voxlyns[tokenId] = Voxlyn({
            name:      name_,
            bornAt:    uint64(block.timestamp),
            lastFedAt: 0,
            xp:        0,
            hp:        100,
            happiness: 100,
            hunger:    100,
            level:     1,
            stage:     Stage.Egg
        });
        voxlynOf[msg.sender] = tokenId;

        emit VoxlynMinted(msg.sender, tokenId, name_);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Feed (staking)
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Nourrit son Voxlyn en payant en ETH. L'ETH est transféré à la trésorerie.
    function feed(uint256 tokenId, FeedType feedType)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        uint256 price = feedPrice[feedType];
        require(msg.value >= price, "insufficient eth");

        Voxlyn storage v = voxlyns[tokenId];
        require(
            block.timestamp >= v.lastFedAt + feedCooldown[feedType],
            "feed cooldown"
        );

        // Mise à jour stats
        v.lastFedAt = uint64(block.timestamp);
        v.hunger    = 100;
        v.happiness = v.happiness < 90 ? v.happiness + 10 : 100;
        v.hp        = v.hp < 100 ? v.hp + 5 : 100;

        uint32 xpGained = feedXpReward[feedType];
        v.xp += xpGained;

        _maybeLevelUp(tokenId);

        // Transfert vers trésorerie
        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "treasury transfer failed");

        emit Fed(tokenId, feedType, msg.value, v.xp);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Achat catalogue (sorts, potions, skins, portails)
    // ────────────────────────────────────────────────────────────────────────

    function buyCatalogItem(uint256 tokenId, bytes32 itemId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        CatalogItem memory item = catalog[itemId];
        require(item.active, "item inactive");
        require(msg.value >= item.priceWei, "insufficient eth");

        inventory[tokenId][itemId] += 1;

        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "treasury transfer failed");

        emit ItemBought(tokenId, itemId, msg.value);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Quêtes
    // ────────────────────────────────────────────────────────────────────────

    function startQuest(uint256 tokenId, bytes32 questId) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        Quest memory q = quests[questId];
        require(q.active, "quest inactive");
        require(voxlyns[tokenId].xp >= q.xpRequired, "xp too low");
        require(!questStarted[tokenId][questId], "already started");

        questStarted[tokenId][questId] = true;
        emit QuestStarted(tokenId, questId);
    }

    /// @notice Complétion validée par l'owner du contrat (validation off-chain).
    ///         En Phase 3 (moteur de jeu), un oracle signera on-chain.
    function completeQuest(uint256 tokenId, bytes32 questId) external onlyOwner {
        require(questStarted[tokenId][questId], "not started");
        require(!questCompleted[tokenId][questId], "already done");

        Quest memory q = quests[questId];
        questCompleted[tokenId][questId] = true;

        Voxlyn storage v = voxlyns[tokenId];
        v.xp += q.xpReward;
        _maybeLevelUp(tokenId);

        emit QuestCompleted(tokenId, questId, q.xpReward);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Admin — catalogue / quêtes / prix
    // ────────────────────────────────────────────────────────────────────────

    function addCatalogItem(bytes32 itemId, string calldata label, uint256 priceWei)
        external
        onlyOwner
    {
        require(!catalog[itemId].active, "exists");
        catalog[itemId] = CatalogItem({label: label, priceWei: priceWei, active: true});
        catalogIds.push(itemId);
        emit CatalogItemAdded(itemId, label, priceWei);
    }

    function setCatalogItemActive(bytes32 itemId, bool active) external onlyOwner {
        catalog[itemId].active = active;
    }

    function setCatalogItemPrice(bytes32 itemId, uint256 priceWei) external onlyOwner {
        catalog[itemId].priceWei = priceWei;
    }

    function addQuest(bytes32 questId, string calldata label, uint32 xpRequired, uint32 xpReward)
        external
        onlyOwner
    {
        require(!quests[questId].active, "exists");
        quests[questId] = Quest({label: label, xpRequired: xpRequired, xpReward: xpReward, active: true});
        questIds.push(questId);
        emit QuestAdded(questId, label, xpRequired, xpReward);
    }

    function setQuestActive(bytes32 questId, bool active) external onlyOwner {
        quests[questId].active = active;
    }

    function setFeedPrice(FeedType feedType, uint256 priceWei) external onlyOwner {
        feedPrice[feedType] = priceWei;
        emit PriceChanged(feedType, priceWei);
    }

    /// @notice Ajuste la durée du cooldown entre deux repas d'un type donné.
    ///         Utile pour tests (mettre à 0) ou événements spéciaux.
    function setFeedCooldown(FeedType feedType, uint64 cooldownSec) external onlyOwner {
        feedCooldown[feedType] = cooldownSec;
    }

    /// @notice Ajuste la récompense XP par type de repas.
    function setFeedXpReward(FeedType feedType, uint32 xpReward) external onlyOwner {
        feedXpReward[feedType] = xpReward;
    }

    function setTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }

    /// @notice Retire tout ETH accidentellement bloqué dans le contrat (les feeds
    ///         vont directement à treasury, mais au cas où).
    function withdraw() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "empty");
        (bool ok, ) = treasury.call{value: bal}("");
        require(ok, "transfer failed");
        emit Withdrawn(bal);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ────────────────────────────────────────────────────────────────────────
    // Views
    // ────────────────────────────────────────────────────────────────────────

    function catalogLength() external view returns (uint256) { return catalogIds.length; }
    function questsLength()  external view returns (uint256) { return questIds.length; }

    /// @notice Calcule la faim actuelle (décroît linéairement de 100 à 0 sur 3 jours).
    function currentHunger(uint256 tokenId) external view returns (uint16) {
        Voxlyn memory v = voxlyns[tokenId];
        uint256 elapsed = block.timestamp - v.lastFedAt;
        uint256 maxHunger = 3 days;
        if (elapsed >= maxHunger) return 0;
        return uint16((uint256(v.hunger) * (maxHunger - elapsed)) / maxHunger);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal
    // ────────────────────────────────────────────────────────────────────────

    function _maybeLevelUp(uint256 tokenId) internal {
        Voxlyn storage v = voxlyns[tokenId];
        uint32 newLevel = _levelFromXp(v.xp);
        Stage  newStage = _stageFromLevel(newLevel);
        if (newLevel > v.level || newStage != v.stage) {
            v.level = newLevel;
            v.stage = newStage;
            emit LevelUp(tokenId, newLevel, newStage);
        }
    }

    function _levelFromXp(uint32 xp) internal pure returns (uint32) {
        // Courbe : level = sqrt(xp / 10) + 1  (approximation entière)
        uint32 lvl = 1;
        uint32 threshold = 10;
        while (xp >= threshold && lvl < 999) {
            lvl++;
            threshold += lvl * 10;
        }
        return lvl;
    }

    function _stageFromLevel(uint32 lvl) internal pure returns (Stage) {
        if (lvl >= 100) return Stage.Ancient;
        if (lvl >= 50)  return Stage.Adult;
        if (lvl >= 20)  return Stage.Juvenile;
        if (lvl >= 5)   return Stage.Hatched;
        return Stage.Egg;
    }
}
