// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title HorizonZeldCraft — Voxlyn Tamagotchi (v2)
 * @notice Phase 1.5 : quêtes à énigmes, PNJ, trésors, mondes, météo, difficulté,
 *         scoreboard, équipes multi-joueurs et chat on-chain.
 */
contract HorizonZeldCraft is ERC721, Ownable2Step, ReentrancyGuard, Pausable {
    // ═══════════════════════════════════════════════ TYPES
    enum FeedType { Daily, Weekly, Monthly, Yearly }
    enum Stage { Egg, Hatched, Juvenile, Adult, Ancient }
    enum Weather { Sunny, Cloudy, Rainy, Stormy, Night, Snowy }

    struct Voxlyn {
        string name; uint64 bornAt; uint64 lastFedAt;
        uint32 xp; uint16 hp; uint16 happiness; uint16 hunger;
        uint32 level; Stage stage;
    }
    struct CatalogItem { string label; uint256 priceWei; bool active; }
    struct Quest {
        string label; uint32 xpRequired; uint32 xpReward; uint32 scoreReward;
        bytes32 answerHash;    // keccak256(bytes(loweredAnswer))
        bytes32 treasureId;    // 0 = aucun trésor
        uint8 minDifficulty;   // visible si difficulty globale >= ce seuil
        bool active;
    }
    struct NPC {
        string name; string dialog;
        uint32 xpRewardOnMeet; bytes32 questId; // quête révélée à la rencontre (0 = aucune)
        bool active;
    }
    struct Treasure { string name; uint32 xpReward; bool active; }
    struct World { string name; uint32 xpRequired; bool active; }
    struct Team { string name; address leader; address[] members; bool active; }

    // ═══════════════════════════════════════════════ STORAGE
    uint256 public nextTokenId = 1;
    address payable public treasury;

    mapping(uint256 => Voxlyn) public voxlyns;
    mapping(address => uint256) public voxlynOf;

    mapping(FeedType => uint256) public feedPrice;
    mapping(FeedType => uint32) public feedXpReward;
    mapping(FeedType => uint64) public feedCooldown;

    mapping(bytes32 => CatalogItem) public catalog;
    bytes32[] public catalogIds;
    mapping(bytes32 => Quest) public quests;
    bytes32[] public questIds;
    mapping(bytes32 => NPC) public npcs;
    bytes32[] public npcIds;
    mapping(bytes32 => Treasure) public treasures;
    bytes32[] public treasureIds;
    mapping(bytes32 => World) public worlds;
    bytes32[] public worldIds;

    mapping(uint256 => mapping(bytes32 => uint32)) public inventory;
    mapping(uint256 => mapping(bytes32 => bool)) public questCompleted;
    mapping(uint256 => mapping(bytes32 => uint8)) public questAttempts;
    mapping(uint256 => mapping(bytes32 => bool)) public npcMet;
    mapping(uint256 => mapping(bytes32 => bool)) public treasureFound;
    mapping(uint256 => mapping(bytes32 => bool)) public worldUnlocked;
    mapping(uint256 => uint256) public playerScore;

    uint8 public difficulty;              // 0-100
    Weather public currentWeather;

    uint256 public nextTeamId = 1;
    mapping(uint256 => Team) public teams;
    mapping(address => uint256) public teamOf;

    // ═══════════════════════════════════════════════ EVENTS
    event VoxlynMinted(address indexed player, uint256 indexed tokenId, string name);
    event Fed(uint256 indexed tokenId, FeedType feedType, uint256 amount, uint32 newXp);
    event LevelUp(uint256 indexed tokenId, uint32 newLevel, Stage newStage);
    event ItemBought(uint256 indexed tokenId, bytes32 indexed itemId, uint256 price);
    event QuestSolved(uint256 indexed tokenId, bytes32 indexed questId, uint32 xp, uint32 score);
    event QuestFailed(uint256 indexed tokenId, bytes32 indexed questId, uint8 attempts);
    event NpcMet(uint256 indexed tokenId, bytes32 indexed npcId);
    event TreasureFound(uint256 indexed tokenId, bytes32 indexed treasureId);
    event WorldDiscovered(uint256 indexed tokenId, bytes32 indexed worldId);
    event WeatherChanged(Weather newWeather);
    event DifficultyChanged(uint8 newDifficulty);
    event CatalogItemAdded(bytes32 indexed itemId, string label, uint256 price);
    event QuestAdded(bytes32 indexed questId, string label, uint32 xpRequired, uint32 xpReward);
    event NpcAdded(bytes32 indexed npcId, string name);
    event TreasureAdded(bytes32 indexed treasureId, string name);
    event WorldAdded(bytes32 indexed worldId, string name);
    event PriceChanged(FeedType feedType, uint256 newPrice);
    event TreasuryChanged(address newTreasury);
    event Withdrawn(uint256 amount);
    event TeamCreated(uint256 indexed teamId, address indexed leader, string name);
    event TeamJoined(uint256 indexed teamId, address indexed member);
    event TeamLeft(uint256 indexed teamId, address indexed member);
    event TeamMessage(uint256 indexed teamId, address indexed sender, string message, uint64 timestamp);

    // ═══════════════════════════════════════════════ CONSTRUCTOR
    constructor(address payable _treasury) ERC721("Voxlyn", "VOX") Ownable(msg.sender) {
        require(_treasury != address(0), "treasury=0");
        treasury = _treasury;
        feedPrice[FeedType.Daily]   = 0.0001 ether;
        feedPrice[FeedType.Weekly]  = 0.0005 ether;
        feedPrice[FeedType.Monthly] = 0.002 ether;
        feedPrice[FeedType.Yearly]  = 0.02 ether;
        feedXpReward[FeedType.Daily] = 10;
        feedXpReward[FeedType.Weekly] = 80;
        feedXpReward[FeedType.Monthly] = 400;
        feedXpReward[FeedType.Yearly] = 6000;
        feedCooldown[FeedType.Daily] = 20 hours;
        feedCooldown[FeedType.Weekly] = 6 days;
        feedCooldown[FeedType.Monthly] = 28 days;
        feedCooldown[FeedType.Yearly] = 350 days;
        difficulty = 50;
        currentWeather = Weather.Sunny;
    }

    // ═══════════════════════════════════════════════ MINT / FEED
    function mintVoxlyn(string calldata name_) external whenNotPaused returns (uint256 tokenId) {
        require(voxlynOf[msg.sender] == 0, "already has voxlyn");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "name len");
        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
        voxlyns[tokenId] = Voxlyn({
            name: name_, bornAt: uint64(block.timestamp), lastFedAt: 0,
            xp: 0, hp: 100, happiness: 100, hunger: 100, level: 1, stage: Stage.Egg
        });
        voxlynOf[msg.sender] = tokenId;
        emit VoxlynMinted(msg.sender, tokenId, name_);
    }

    function feed(uint256 tokenId, FeedType feedType) external payable nonReentrant whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        uint256 price = feedPrice[feedType];
        require(msg.value >= price, "insufficient eth");
        Voxlyn storage v = voxlyns[tokenId];
        require(block.timestamp >= v.lastFedAt + feedCooldown[feedType], "feed cooldown");
        v.lastFedAt = uint64(block.timestamp);
        v.hunger = 100;
        v.happiness = v.happiness < 90 ? v.happiness + 10 : 100;
        v.hp = v.hp < 100 ? v.hp + 5 : 100;
        v.xp += feedXpReward[feedType];
        _maybeLevelUp(tokenId);
        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "treasury transfer failed");
        emit Fed(tokenId, feedType, msg.value, v.xp);
    }

    function buyCatalogItem(uint256 tokenId, bytes32 itemId) external payable nonReentrant whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        CatalogItem memory item = catalog[itemId];
        require(item.active, "item inactive");
        require(msg.value >= item.priceWei, "insufficient eth");
        inventory[tokenId][itemId] += 1;
        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "treasury transfer failed");
        emit ItemBought(tokenId, itemId, msg.value);
    }

    // ═══════════════════════════════════════════════ QUÊTES À ÉNIGMES
    /// @notice Soumet la réponse d'une énigme. Compare keccak256(answer) au hash stocké.
    /// @dev L'answer doit être en minuscules côté client (normaliser avant hash).
    function submitQuestAnswer(uint256 tokenId, bytes32 questId, string calldata answer)
        external whenNotPaused
    {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        Quest memory q = quests[questId];
        require(q.active, "quest inactive");
        require(voxlyns[tokenId].xp >= q.xpRequired, "xp too low");
        require(!questCompleted[tokenId][questId], "already solved");
        if (keccak256(bytes(answer)) != q.answerHash) {
            revert("wrong answer");
        }
        questCompleted[tokenId][questId] = true;
        voxlyns[tokenId].xp += q.xpReward;
        playerScore[tokenId] += q.scoreReward;
        _maybeLevelUp(tokenId);
        if (q.treasureId != bytes32(0) && treasures[q.treasureId].active
            && !treasureFound[tokenId][q.treasureId]) {
            treasureFound[tokenId][q.treasureId] = true;
            voxlyns[tokenId].xp += treasures[q.treasureId].xpReward;
            emit TreasureFound(tokenId, q.treasureId);
        }
        emit QuestSolved(tokenId, questId, q.xpReward, q.scoreReward);
    }

    // ═══════════════════════════════════════════════ PNJ
    function meetNpc(uint256 tokenId, bytes32 npcId) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        NPC memory n = npcs[npcId];
        require(n.active, "npc inactive");
        require(!npcMet[tokenId][npcId], "already met");
        npcMet[tokenId][npcId] = true;
        voxlyns[tokenId].xp += n.xpRewardOnMeet;
        _maybeLevelUp(tokenId);
        emit NpcMet(tokenId, npcId);
    }

    // ═══════════════════════════════════════════════ MONDES
    function discoverWorld(uint256 tokenId, bytes32 worldId) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        World memory w = worlds[worldId];
        require(w.active, "world inactive");
        require(voxlyns[tokenId].xp >= w.xpRequired, "xp too low");
        require(!worldUnlocked[tokenId][worldId], "already unlocked");
        worldUnlocked[tokenId][worldId] = true;
        emit WorldDiscovered(tokenId, worldId);
    }

    // ═══════════════════════════════════════════════ TEAMS + CHAT
    function createTeam(string calldata name_) external returns (uint256 teamId) {
        require(teamOf[msg.sender] == 0, "already in team");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "name len");
        teamId = nextTeamId++;
        Team storage t = teams[teamId];
        t.name = name_; t.leader = msg.sender; t.active = true;
        t.members.push(msg.sender);
        teamOf[msg.sender] = teamId;
        emit TeamCreated(teamId, msg.sender, name_);
    }

    function joinTeam(uint256 teamId) external {
        require(teamOf[msg.sender] == 0, "already in team");
        require(teams[teamId].active, "team inactive");
        require(teams[teamId].members.length < 8, "team full");
        teams[teamId].members.push(msg.sender);
        teamOf[msg.sender] = teamId;
        emit TeamJoined(teamId, msg.sender);
    }

    function leaveTeam() external {
        uint256 tId = teamOf[msg.sender];
        require(tId != 0, "not in team");
        Team storage t = teams[tId];
        uint256 len = t.members.length;
        for (uint256 i = 0; i < len; i++) {
            if (t.members[i] == msg.sender) {
                t.members[i] = t.members[len - 1];
                t.members.pop();
                break;
            }
        }
        teamOf[msg.sender] = 0;
        if (t.members.length == 0) t.active = false;
        emit TeamLeft(tId, msg.sender);
    }

    /// @notice Envoie un message dans le chat d'équipe (stocké en event pour économiser).
    function sendTeamMessage(string calldata message) external whenNotPaused {
        uint256 tId = teamOf[msg.sender];
        require(tId != 0, "not in team");
        uint256 len = bytes(message).length;
        require(len > 0 && len <= 280, "msg len");
        emit TeamMessage(tId, msg.sender, message, uint64(block.timestamp));
    }

    function getTeamMembers(uint256 teamId) external view returns (address[] memory) {
        return teams[teamId].members;
    }

    // ═══════════════════════════════════════════════ ADMIN
    function addCatalogItem(bytes32 id, string calldata label, uint256 priceWei) external onlyOwner {
        require(!catalog[id].active, "exists");
        catalog[id] = CatalogItem(label, priceWei, true);
        catalogIds.push(id);
        emit CatalogItemAdded(id, label, priceWei);
    }
    function setCatalogItemActive(bytes32 id, bool active) external onlyOwner { catalog[id].active = active; }
    function setCatalogItemPrice(bytes32 id, uint256 p) external onlyOwner { catalog[id].priceWei = p; }

    /// @notice Ajoute une quête à énigme. answerHash = keccak256(bytes(answer_en_minuscules)).
    function addQuest(
        bytes32 id, string calldata label, uint32 xpRequired, uint32 xpReward,
        uint32 scoreReward, bytes32 answerHash, bytes32 treasureId, uint8 minDifficulty
    ) external onlyOwner {
        require(!quests[id].active, "exists");
        quests[id] = Quest(label, xpRequired, xpReward, scoreReward, answerHash, treasureId, minDifficulty, true);
        questIds.push(id);
        emit QuestAdded(id, label, xpRequired, xpReward);
    }
    function setQuestActive(bytes32 id, bool active) external onlyOwner { quests[id].active = active; }
    function updateQuestAnswer(bytes32 id, bytes32 answerHash) external onlyOwner { quests[id].answerHash = answerHash; }

    function addNpc(bytes32 id, string calldata name_, string calldata dialog, uint32 xp, bytes32 questId)
        external onlyOwner
    {
        require(!npcs[id].active, "exists");
        npcs[id] = NPC(name_, dialog, xp, questId, true);
        npcIds.push(id);
        emit NpcAdded(id, name_);
    }
    function setNpcActive(bytes32 id, bool active) external onlyOwner { npcs[id].active = active; }

    function addTreasure(bytes32 id, string calldata name_, uint32 xp) external onlyOwner {
        require(!treasures[id].active, "exists");
        treasures[id] = Treasure(name_, xp, true);
        treasureIds.push(id);
        emit TreasureAdded(id, name_);
    }
    function setTreasureActive(bytes32 id, bool active) external onlyOwner { treasures[id].active = active; }

    function addWorld(bytes32 id, string calldata name_, uint32 xpRequired) external onlyOwner {
        require(!worlds[id].active, "exists");
        worlds[id] = World(name_, xpRequired, true);
        worldIds.push(id);
        emit WorldAdded(id, name_);
    }
    function setWorldActive(bytes32 id, bool active) external onlyOwner { worlds[id].active = active; }

    function setDifficulty(uint8 d) external onlyOwner {
        require(d <= 100, "0-100");
        difficulty = d;
        emit DifficultyChanged(d);
    }
    function setWeather(Weather w) external onlyOwner {
        currentWeather = w;
        emit WeatherChanged(w);
    }

    function setFeedPrice(FeedType f, uint256 p) external onlyOwner { feedPrice[f] = p; emit PriceChanged(f, p); }
    function setFeedCooldown(FeedType f, uint64 c) external onlyOwner { feedCooldown[f] = c; }
    function setFeedXpReward(FeedType f, uint32 x) external onlyOwner { feedXpReward[f] = x; }

    function setTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }
    function withdraw() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "empty");
        (bool ok, ) = treasury.call{value: bal}("");
        require(ok, "transfer failed");
        emit Withdrawn(bal);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ═══════════════════════════════════════════════ VIEWS
    function catalogLength() external view returns (uint256) { return catalogIds.length; }
    function questsLength() external view returns (uint256) { return questIds.length; }
    function npcsLength() external view returns (uint256) { return npcIds.length; }
    function treasuresLength() external view returns (uint256) { return treasureIds.length; }
    function worldsLength() external view returns (uint256) { return worldIds.length; }

    function currentHunger(uint256 tokenId) external view returns (uint16) {
        Voxlyn memory v = voxlyns[tokenId];
        uint256 elapsed = block.timestamp - v.lastFedAt;
        uint256 maxHunger = 3 days;
        if (elapsed >= maxHunger) return 0;
        return uint16((uint256(v.hunger) * (maxHunger - elapsed)) / maxHunger);
    }

    // ═══════════════════════════════════════════════ INTERNAL
    function _maybeLevelUp(uint256 tokenId) internal {
        Voxlyn storage v = voxlyns[tokenId];
        uint32 newLevel = _levelFromXp(v.xp);
        Stage newStage = _stageFromLevel(newLevel);
        if (newLevel > v.level || newStage != v.stage) {
            v.level = newLevel; v.stage = newStage;
            emit LevelUp(tokenId, newLevel, newStage);
        }
    }
    function _levelFromXp(uint32 xp) internal pure returns (uint32) {
        uint32 lvl = 1; uint32 threshold = 10;
        while (xp >= threshold && lvl < 999) { lvl++; threshold += lvl * 10; }
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
