const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const config = require('../settings.json');

const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../settings.json');
const historyPath = path.join(__dirname, '../history.json');

// Load or create history file
let serverHistory = [];
if (fs.existsSync(historyPath)) {
  try {
    serverHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch (e) {
    console.log('[HISTORY] Error loading history, starting fresh');
  }
}

// Store identities for each bot
let botIdentities = new Map();
// Store all bots (even disconnected ones)
let allBots = new Map(); // botId -> {bot, online, lastSeen, status, reconnectAttempts}
// Store bot targets for combat
let botTargets = new Map(); // botId -> {targetPlayer, lastMessageTime}
// Store bot control states
let botControlStates = new Map(); // botId -> 'RUNNING' | 'STOPPED'
// Global leave mode
let globalLeaveMode = false;
let globalLeaveTimeout = null;

// Function to generate new identity
function generateNewIdentity(botId = null, customName = null, customUUID = null) {
  const name = customName || "Player_" + Math.floor(Math.random() * 999999);
  const uuid = customUUID || uuidv4();
  
  if (botId !== null) {
    botIdentities.set(botId, { name, uuid });
  }
  
  console.log(`[IDENTITY] New identity: ${name}`);
  return { name, uuid };
}

// Get identity for bot
function getBotIdentity(botId) {
  if (!botIdentities.has(botId)) {
    botIdentities.set(botId, generateNewIdentity());
  }
  return botIdentities.get(botId);
}

// Mocking messages for combat
function getMockingMessage(playerName) {
  const messages = [
    `You are finished ${playerName}!`,
    `That's what you get ${playerName}!`,
    `${playerName} messed with the wrong bot!`,
    `Game over ${playerName}!`,
    `Better luck next time ${playerName}!`,
    `${playerName} thought they could win?`,
    `That was too easy ${playerName}!`,
    `${playerName} should have stayed away!`,
    `Bot 1, ${playerName} 0!`,
    `You picked the wrong fight ${playerName}!`
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

// Weapon damage calculation
function getWeaponDamage(itemName) {
  const damages = {
    // Swords
    'netherite_sword': 8, 'diamond_sword': 7, 'iron_sword': 6,
    'stone_sword': 5, 'golden_sword': 4, 'wooden_sword': 4,
    
    // Axes (higher damage but slower)
    'netherite_axe': 10, 'diamond_axe': 9, 'iron_axe': 9,
    'stone_axe': 9, 'golden_axe': 7, 'wooden_axe': 7,
    
    // Bows
    'bow': 3, 'crossbow': 6,
    
    // Tridents
    'trident': 9,
    
    // Misc
    'mace': 10
  };
  
  // Find matching weapon
  for (const [weapon, damage] of Object.entries(damages)) {
    if (itemName.includes(weapon)) {
      return damage;
    }
  }
  
  return 1; // Fist damage
}

// Equip best weapon
function equipBestWeapon(bot) {
  try {
    const weapons = bot.inventory.items().filter(item => 
      item && item.name && (
        item.name.includes('sword') || 
        item.name.includes('axe') ||
        item.name.includes('bow') ||
        item.name.includes('trident') ||
        item.name.includes('mace')
      )
    );
    
    if (weapons.length > 0) {
      // Prioritize swords, then axes, then bows
      const weaponTypes = {
        'sword': 3,
        'axe': 2,
        'trident': 2,
        'mace': 2,
        'bow': 1,
        'crossbow': 1
      };
      
      const bestWeapon = weapons.reduce((best, item) => {
        if (!item || !item.name) return best;
        const type = Object.keys(weaponTypes).find(t => item.name.includes(t));
        const typeScore = type ? weaponTypes[type] : 0;
        const damage = getWeaponDamage(item.name);
        const totalScore = typeScore * 10 + damage;
        
        return totalScore > best.score ? { item, score: totalScore } : best;
      }, { item: null, score: 0 });
      
      if (bestWeapon.item) {
        bot.equip(bestWeapon.item, 'hand');
        
        // If it's a bow, get arrows too
        if (bestWeapon.item.name.includes('bow')) {
          const arrows = bot.inventory.items().filter(item => 
            item && item.name && item.name.includes('arrow')
          );
          if (arrows.length > 0) {
            bot.equip(arrows[0], 'off-hand');
          }
        }
      }
    }
  } catch (e) {
    console.log(`[ERROR] equipBestWeapon: ${e.message}`);
  }
}

// Equip best armor
function equipBestArmor(bot) {
  try {
    const armorSlots = {
      'helmet': ['helmet', 'head'],
      'chestplate': ['chestplate', 'chest'],
      'leggings': ['leggings', 'legs'],
      'boots': ['boots', 'feet']
    };
    
    for (const [slot, keywords] of Object.entries(armorSlots)) {
      const armorPieces = bot.inventory.items().filter(item => 
        item && item.name && keywords.some(keyword => item.name.includes(keyword))
      );
      
      if (armorPieces.length > 0) {
        // Sort by material quality
        const materialOrder = ['netherite', 'diamond', 'iron', 'chainmail', 'golden', 'leather'];
        for (const material of materialOrder) {
          const armor = armorPieces.find(item => item.name.includes(material));
          if (armor) {
            bot.equip(armor, slot);
            break;
          }
        }
      }
    }
  } catch (e) {
    console.log(`[ERROR] equipBestArmor: ${e.message}`);
  }
}

// Dye Economy Automation Module
// Dye Economy Automation Module - SIMPLE VERSION
const dyeEconomyAutomation = (bot) => {
  const module = {
    config: {
      allowedItems: ['white_dye', 'green_dye', 'lime_dye'],
      
      // Simple GUI navigation
      gui: {
        openShop: '/shop dyes',
        greenSlot: 6,      // Green dye slot
        whiteSlot: 15,     // White dye slot
        quantitySlot: 32,  // Quantity button (32 items)
        buySlot: 14,       // Buy/Confirm button
        closeAfterBuy: true
      },

      inventory: {
        targetAmount: 13 * 64   // 832 items (13 stacks)
      },

      delay: {
        betweenClicks: 200,     // 200ms between clicks
        guiOpenDelay: 1500,     // 1.5s for GUI to open
        loopDelay: 60000        // 1 minute between cycles
      }
    },

    // ---------------- UTILS ----------------

    sleep(ms) {
      return new Promise(res => setTimeout(res, ms));
    },

    countItem(bot, name) {
      return bot.inventory.items()
        .filter(i => i && i.name === name)
        .reduce((a, b) => a + b.count, 0);
    },

    // ---------------- GUI BUY FUNCTION ----------------

    async buyDye(bot, dyeSlot) {
      try {
        console.log(`[BOT ${bot.botId}] Buying dye from slot ${dyeSlot}`);
        
        // 1. Open shop
        bot.chat(this.config.gui.openShop);
        await this.sleep(this.config.delay.guiOpenDelay);
        
        if (!bot.currentWindow) {
          console.log(`[BOT ${bot.botId}] Shop GUI didn't open`);
          return false;
        }
        
        // 2. Click dye slot
        await bot.clickWindow(dyeSlot, 0);
        await this.sleep(this.config.delay.betweenClicks);
        
        // 3. Click quantity slot (32 items)
        await bot.clickWindow(this.config.gui.quantitySlot, 0);
        await this.sleep(this.config.delay.betweenClicks);
        
        // 4. Click buy button
        await bot.clickWindow(this.config.gui.buySlot, 0);
        await this.sleep(this.config.delay.betweenClicks);
        
        // 5. Close GUI
        if (this.config.gui.closeAfterBuy && bot.currentWindow) {
          bot.closeWindow(bot.currentWindow);
        }
        
        console.log(`[BOT ${bot.botId}] Successfully bought dye`);
        return true;
        
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Buy error: ${e.message}`);
        // Try to close GUI if open
        if (bot.currentWindow) {
          try {
            bot.closeWindow(bot.currentWindow);
          } catch {}
        }
        return false;
      }
    },

    // ---------------- BUY DYES (FULL AMOUNT) ----------------

    async ensureFullDyes(bot) {
      const target = this.config.inventory.targetAmount;

      // Check current amounts
      const white = this.countItem(bot, 'white_dye');
      const green = this.countItem(bot, 'green_dye');

      console.log(`[BOT ${bot.botId}] Current: White=${white}, Green=${green}, Target=${target}`);

      // Buy green dye if needed (each purchase = 32 items)
      if (green < target) {
        const neededPurchases = Math.ceil((target - green) / 32);
        console.log(`[BOT ${bot.botId}] Need ${neededPurchases} purchases of green dye`);
        
        for (let i = 0; i < neededPurchases; i++) {
          const success = await this.buyDye(bot, this.config.gui.greenSlot);
          if (!success) break;
          
          // Wait a bit between purchases
          if (i < neededPurchases - 1) {
            await this.sleep(1000);
          }
          
          // Check if we reached target
          const currentGreen = this.countItem(bot, 'green_dye');
          if (currentGreen >= target) break;
        }
      }

      // Buy white dye if needed
      if (white < target) {
        const neededPurchases = Math.ceil((target - white) / 32);
        console.log(`[BOT ${bot.botId}] Need ${neededPurchases} purchases of white dye`);
        
        for (let i = 0; i < neededPurchases; i++) {
          const success = await this.buyDye(bot, this.config.gui.whiteSlot);
          if (!success) break;
          
          if (i < neededPurchases - 1) {
            await this.sleep(1000);
          }
          
          const currentWhite = this.countItem(bot, 'white_dye');
          if (currentWhite >= target) break;
        }
      }
    },

    // ---------------- CRAFT LIME DYE ----------------

    async craftLime(bot) {
      try {
        const white = this.countItem(bot, 'white_dye');
        const green = this.countItem(bot, 'green_dye');
        
        if (white === 0 || green === 0) {
          console.log(`[BOT ${bot.botId}] No dyes to craft`);
          return;
        }
        
        // Each craft uses 1 white + 1 green = 2 lime
        const maxCrafts = Math.min(white, green);
        
        if (maxCrafts <= 0) return;
        
        console.log(`[BOT ${bot.botId}] Crafting ${maxCrafts} lime dyes`);
        
        // Simple crafting - let mineflayer handle it
        if (bot.mcData && bot.mcData.itemsByName.lime_dye) {
          const limeId = bot.mcData.itemsByName.lime_dye.id;
          
          // Craft in reasonable batches
          const batchSize = Math.min(maxCrafts, 16);
          
          try {
            await bot.craft(limeId, batchSize, null);
            console.log(`[BOT ${bot.botId}] Successfully crafted ${batchSize * 2} lime dye`);
          } catch (craftError) {
            console.log(`[BOT ${bot.botId}] Craft error: ${craftError.message}`);
          }
        } else {
          console.log(`[BOT ${bot.botId}] mcData not available for crafting`);
        }
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Craft error: ${e.message}`);
      }
    },

    // ---------------- SELL DYES ----------------

    async sellDyes(bot) {
      try {
        const limeCount = this.countItem(bot, 'lime_dye');
        if (limeCount === 0) {
          console.log(`[BOT ${bot.botId}] No lime dye to sell`);
          return false;
        }
        
        console.log(`[BOT ${bot.botId}] Selling ${limeCount} lime dye`);
        bot.chat('/sellall Lime_dye');
        
        await this.sleep(2000);
        return true;
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Sell error: ${e.message}`);
        return false;
      }
    },

    // ---------------- INVENTORY CLEANUP ----------------

    async cleanHotbar(bot) {
      try {
        // Move items from hotbar to inventory
        for (let slot = 36; slot < 45; slot++) {
          const item = bot.inventory.slots[slot];
          if (item) {
            for (let invSlot = 0; invSlot < 36; invSlot++) {
              if (!bot.inventory.slots[invSlot]) {
                await bot.moveSlotItem(slot, invSlot);
                await this.sleep(50);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Hotbar clean error: ${e.message}`);
      }
    },

    cleanInventory(bot) {
      try {
        // Remove non-dye items
        const itemsToRemove = bot.inventory.items().filter(item => 
          item && !this.config.allowedItems.includes(item.name)
        );
        
        itemsToRemove.forEach(item => {
          try {
            bot.tossStack(item);
          } catch (e) {
            // Silent fail
          }
        });
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Inventory clean error: ${e.message}`);
      }
    },

    // ---------------- MAIN LOOP ----------------

    async runCycle(bot) {
      if (!bot.dyeAutomationActive) return;
      if (!bot.entity || bot.combatMode || bot.lockedTarget) return;

      try {
        console.log(`[BOT ${bot.botId}] === Starting Dye Cycle ===`);
        
        // 1. Cleanup
        await this.cleanHotbar(bot);
        this.cleanInventory(bot);
        await this.sleep(1000);
        
        // 2. Buy dyes
        await this.ensureFullDyes(bot);
        await this.sleep(2000);
        
        // 3. Clean hotbar again (in case items ended up there)
        await this.cleanHotbar(bot);
        await this.sleep(1000);
        
        // 4. Craft lime dye
        await this.craftLime(bot);
        await this.sleep(2000);
        
        // 5. Clean hotbar again
        await this.cleanHotbar(bot);
        await this.sleep(1000);
        
        // 6. Sell lime dye
        await this.sellDyes(bot);
        await this.sleep(2000);
        
        console.log(`[BOT ${bot.botId}] === Finished Dye Cycle ===`);
        
      } catch (e) {
        console.log(`[BOT ${bot.botId}] Cycle error: ${e.message}`);
      }
    },

    // ---------------- START / STOP ----------------

    start(bot) {
      if (bot.dyeAutomationActive) return;
      bot.dyeAutomationActive = true;
      console.log(`[BOT ${bot.botId}] Dye automation STARTED`);

      const loop = async () => {
        if (!bot.dyeAutomationActive) return;

        await this.runCycle(bot);

        // Schedule next cycle
        setTimeout(loop, this.config.delay.loopDelay);
      };

      // Start first cycle after 10 seconds
      setTimeout(loop, 10000);
    },

    stop(bot) {
      bot.dyeAutomationActive = false;
      console.log(`[BOT ${bot.botId}] Dye automation STOPPED`);
    }
  };

  return module;
};

// Bot control functions
function stopBot(botId) {
  const botData = allBots.get(botId);
  if (!botData) return false;
  
  botControlStates.set(botId, 'STOPPED');
  botData.status = 'stopped';
  botData.controlState = 'STOPPED';
  
  if (botData.bot) {
    botData.bot.controlState = 'STOPPED';
    if (botData.online) {
      botData.bot.quit('Stopped by user');
      botData.online = false;
    }
  }
  
  addGameLog(`⏸️ Bot ${botId} stopped (manual control)`, botId);
  return true;
}

function startBot(botId) {
  const botData = allBots.get(botId);
  if (!botData) return false;
  
  botControlStates.set(botId, 'RUNNING');
  botData.status = 'starting';
  botData.controlState = 'RUNNING';
  
  // Create new bot instance
  setTimeout(() => {
    if (!removedBots.has(botId)) {
      createNewBot(botId, false);
    }
  }, 2000);
  
  addGameLog(`▶️ Bot ${botId} started (manual control)`, botId);
  return true;
}

// Global leave mode
function activateGlobalLeave() {
  if (globalLeaveMode) return; // Already in leave mode
  
  globalLeaveMode = true;
  addGameLog(`🌍 GLOBAL LEAVE MODE ACTIVATED - All bots leaving for 1 minute`);
  
  // Make all running bots leave
  allBots.forEach((botData, botId) => {
    if (botData.online && botData.bot && botControlStates.get(botId) !== 'STOPPED') {
      const bot = botData.bot;
      bot.chat('Leaving due to global command...');
      setTimeout(() => {
        bot.quit('Global leave command');
      }, Math.random() * 3000); // Stagger leaves
    }
  });
  
  // Set timeout to disable global leave mode
  globalLeaveTimeout = setTimeout(() => {
    globalLeaveMode = false;
    addGameLog(`🌍 GLOBAL LEAVE MODE ENDED - Bots can reconnect now`);
  }, 60000); // 1 minute
}

// Improved combat routine
function startAggressiveCombat(bot, botNumber, target) {
  if (!bot.entity || !target) return;
  
  const targetData = botTargets.get(botNumber);
  if (!targetData) return;
  
  addGameLog(`🎯 Targeting ${targetData.targetPlayer}`, botNumber);
  
  // Start PVP
  if (bot.pvp && bot.pvp.attack) {
    bot.pvp.attack(target);
  }
  
  // Combat behavior loop
  const combatLoop = setInterval(() => {
    if (!bot.entity || !bot.combatMode || !bot.lockedTarget || 
        !bot.lockedTarget.isValid || (bot.lockedTarget.health !== undefined && bot.lockedTarget.health <= 0)) {
      
      // Combat ended
      clearInterval(combatLoop);
      bot.combatMode = false;
      bot.lockedTarget = null;
      
      if (targetData) {
        addGameLog(`✅ Combat ended with ${targetData.targetPlayer}`, botNumber);
        botTargets.delete(botNumber);
      }
      
      if (bot.pvp && bot.pvp.stop) {
        bot.pvp.stop();
      }
      return;
    }
    
    const currentTarget = bot.lockedTarget;
    const distance = currentTarget.position.distanceTo(bot.entity.position);
    
    // Dynamic combat behavior
    if (distance < 4) {
      // Close combat - attack and strafe
      if (bot.pvp && bot.pvp.attack) {
        bot.pvp.attack(currentTarget);
      }
      
      // Strafing
      if (Math.random() > 0.5) {
        bot.setControlState('left', true);
        setTimeout(() => bot.setControlState('left', false), 200);
      } else {
        bot.setControlState('right', true);
        setTimeout(() => bot.setControlState('right', false), 200);
      }
      
      // Jump occasionally (critical hits)
      if (Math.random() > 0.7) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 100);
      }
      
      // Try to block with shield
      if (distance < 3.5 && Math.random() > 0.7) {
        const shield = bot.inventory.items().find(item => 
          item && item.name && item.name.includes('shield')
        );
        if (shield) {
          bot.equip(shield, 'off-hand');
          setTimeout(() => {
            equipBestWeapon(bot);
          }, 500);
        }
      }
    } else if (distance < 16) {
      // Medium range - approach while attacking
      if (bot.pvp && bot.pvp.attack) {
        bot.pvp.attack(currentTarget);
      }
      if (bot.pathfinder && bot.pathfinder.setGoal) {
        bot.pathfinder.setGoal(new goals.GoalFollow(currentTarget, 3));
      }
    } else {
      // Too far - just follow
      if (bot.pathfinder && bot.pathfinder.setGoal) {
        bot.pathfinder.setGoal(new goals.GoalFollow(currentTarget, 3));
      }
    }
    
    // Health management
    if (bot.health < 10) {
      // Try to eat if low health
      const foodItems = bot.inventory.items().filter(item => 
        item && item.name && (
          item.name.includes('apple') || 
          item.name.includes('bread') || 
          item.name.includes('cooked') ||
          item.name.includes('potion')
        )
      );
      
      if (foodItems.length > 0 && Math.random() > 0.5) {
        bot.equip(foodItems[0], 'hand');
        if (bot.consume) {
          bot.consume(() => {});
        }
        addGameLog(`🍗 Eating ${foodItems[0].name} for health`, botNumber);
      }
    }
    
    // Send occasional mocking messages
    if (targetData && Date.now() - targetData.lastMessageTime > 8000 + Math.random() * 7000) {
      const message = getMockingMessage(targetData.targetPlayer);
      bot.chat(message);
      addGameLog(`🗣️ "${message}"`, botNumber);
      targetData.lastMessageTime = Date.now();
      botTargets.set(botNumber, targetData);
    }
    
    // Check if combat has been going too long (30 seconds)
    if (targetData.combatStart && Date.now() - targetData.combatStart > 30000) {
      addGameLog(`⏰ Combat timeout with ${targetData.targetPlayer}, disengaging`, botNumber);
      clearInterval(combatLoop);
      bot.combatMode = false;
      bot.lockedTarget = null;
      botTargets.delete(botNumber);
      if (bot.pvp && bot.pvp.stop) {
        bot.pvp.stop();
      }
    }
    
  }, 500); // Faster combat loop
}

// Web server
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MAX_BOTS = 20;
const MAX_HISTORY = 10;

// Game logs storage
const gameLogs = [];
const MAX_GAME_LOGS = 100;

// Bot removal tracking
const removedBots = new Set();

// Save history to file
function saveHistory() {
  fs.writeFileSync(historyPath, JSON.stringify(serverHistory.slice(0, MAX_HISTORY), null, 2));
}

// Add to history
function addToHistory(ip, port) {
  serverHistory = serverHistory.filter(h => !(h.ip === ip && h.port === port));
  serverHistory.unshift({
    ip,
    port,
    timestamp: new Date().toISOString(),
    name: `${ip}:${port}`
  });
  if (serverHistory.length > MAX_HISTORY) {
    serverHistory = serverHistory.slice(0, MAX_HISTORY);
  }
  saveHistory();
}

// Add game log
function addGameLog(message, botNumber = 'SYSTEM') {
  const timestamp = new Date().toLocaleTimeString();
  const log = `[${timestamp}] [BOT ${botNumber}] ${message}`;
  gameLogs.unshift(log);
  if (gameLogs.length > MAX_GAME_LOGS) {
    gameLogs.pop();
  }
  return log;
}

// Create new bot with connection throttling
function createNewBot(botNumber = 1, useNewIdentity = false, customName = null, customUUID = null) {
  if (removedBots.has(botNumber)) {
    console.log(`[BOT ${botNumber}] This bot was manually removed. Not recreating.`);
    return null;
  }
  
  // Check if bot is manually stopped
  if (botControlStates.get(botNumber) === 'STOPPED') {
    addGameLog(`⏸️ Bot ${botNumber} is manually stopped. Not connecting.`, botNumber);
    return null;
  }
  
  // Check global leave mode
  if (globalLeaveMode) {
    addGameLog(`🌍 Skipping connection due to global leave mode`, botNumber);
    
    // Schedule reconnect after global leave ends
    setTimeout(() => {
      if (!globalLeaveMode && !removedBots.has(botNumber)) {
        const controlState = botControlStates.get(botNumber);
        if (controlState !== 'STOPPED') {
          createNewBot(botNumber, false);
        }
      }
    }, 61000); // Slightly more than 1 minute
    
    return null;
  }
  
  // Check connection throttling
  const botData = allBots.get(botNumber);
  if (botData && botData.reconnectAttempts > 3) {
    const timeSinceLastAttempt = Date.now() - botData.lastReconnectAttempt;
    if (timeSinceLastAttempt < 30000) { // 30 seconds throttle
      const waitTime = Math.ceil((30000 - timeSinceLastAttempt) / 1000);
      addGameLog(`⏳ Connection throttled for bot ${botNumber}. Please wait ${waitTime}s before reconnect.`, botNumber);
      
      // Schedule reconnect after throttle period
      setTimeout(() => {
        if (!removedBots.has(botNumber)) {
          createNewBot(botNumber, false);
        }
      }, 30000 - timeSinceLastAttempt);
      return null;
    }
  }
  
  let identity;
  if (useNewIdentity || !botIdentities.has(botNumber)) {
    identity = generateNewIdentity(botNumber, customName, customUUID);
  } else {
    identity = getBotIdentity(botNumber);
  }
  
  // Validate custom name length
  if (customName && customName.length < 4) {
    addGameLog(`❌ Custom name must be at least 4 characters: ${customName}`, botNumber);
    return null;
  }
  
  const botName = identity.name;
  const botUUID = identity.uuid;
  
  addGameLog(`🔗 Connecting as ${botName}`, botNumber);
  
  const bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: botName,
    uuid: botUUID,
    version: config.server.version || "1.20.1",
    auth: "offline",
    checkTimeoutInterval: 60000,
    hideErrors: true
  });
  
  bot.botId = botNumber;
  bot.botName = botName;
  bot.botUUID = botUUID;
  bot.isBanned = false;
  bot.lastKickReason = '';
  bot.manuallyRemoved = false;
  bot.lockedTarget = null;
  bot.lastAttackTime = 0;
  bot.combatMode = false;
  bot.controlState = botControlStates.get(botNumber) || 'RUNNING';
  bot.dyeAutomationActive = false;
  
  // Initialize dye economy automation
  const dyeModule = dyeEconomyAutomation(bot);
  
  // Update bot data in allBots map
  allBots.set(botNumber, {
    bot: bot,
    online: false,
    lastSeen: new Date().toISOString(),
    status: 'connecting',
    reconnectAttempts: botData ? botData.reconnectAttempts + 1 : 1,
    lastReconnectAttempt: Date.now(),
    health: 20,
    food: 20,
    controlState: bot.controlState,
    dyeAutomation: dyeModule
  });
  
  let defaultMove = null;
  
  bot.on('inject_allowed', () => {
    try {
      const mcData = require('minecraft-data')(bot.version || "1.20.1");
      if (mcData) {
        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);
        
        // Configure PVP plugin
        defaultMove = new Movements(bot, mcData);
        defaultMove.canDig = false;
        defaultMove.allow1by1towers = false;
        bot.pathfinder.setMovements(defaultMove);
        
        // Set PVP range and settings
        if (bot.pvp) {
          bot.pvp.followRange = 16;
          bot.pvp.attackRange = 3.5;
          bot.pvp.viewDistance = 32;
        }
      }
    } catch (e) {
      console.log(`[BOT ${botNumber}] Error loading plugins: ${e.message}`);
    }
  });
  
  bot.once('spawn', () => {
    addGameLog(`✅ Spawned in world.`, botNumber);
    
    const botData = allBots.get(botNumber);
    if (botData) {
      botData.online = true;
      botData.status = 'online';
      botData.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
    }
    
    bot.settings.colorsEnabled = false;
    
    // Update health and food
    bot.on('health', () => {
      const botData = allBots.get(botNumber);
      if (botData) {
        botData.health = bot.health;
      }
      
      // Auto-heal if low
      if (bot.health < 8) {
        const foodItems = bot.inventory.items().filter(item => 
          item && item.name && (
            item.name.includes('apple') || item.name.includes('bread') || 
            item.name.includes('cooked') || item.name.includes('potion')
          )
        );
        if (foodItems.length > 0) {
          bot.equip(foodItems[0], 'hand');
          if (bot.consume) {
            bot.consume(() => {});
          }
        }
      }
    });
    
    bot.on('food', () => {
      const botData = allBots.get(botNumber);
      if (botData) {
        botData.food = bot.food;
      }
    });
    
    // Equip gear after spawning
    setTimeout(() => {
      equipBestArmor(bot);
      equipBestWeapon(bot);
      addGameLog(`⚔️ Equipped gear`, botNumber);
    }, 2000);
    
    // IMPROVED COMBAT SYSTEM - Real PVP behavior
    bot.on('entityHurt', (entity) => {
      try {
        if (entity !== bot.entity) return;
        
        const damageEvents = Object.values(bot.entity.damageHistory || {});
        if (damageEvents.length === 0) return;
        
        const recentDamage = damageEvents[damageEvents.length - 1];
        const attacker = recentDamage.attacker;
        
        // Only attack if a player attacked first
        if (attacker && attacker.type === 'player' && attacker.username !== bot.username) {
          // Check if we're already in combat
          if (!bot.combatMode) {
            bot.lockedTarget = attacker;
            bot.combatMode = true;
            bot.lastAttackTime = Date.now();
            
            const attackerName = attacker.username || 'Unknown';
            
            // Store target
            botTargets.set(botNumber, {
              targetPlayer: attackerName,
              lastMessageTime: Date.now(),
              combatStart: Date.now()
            });
            
            // Send mocking message immediately
            const message = getMockingMessage(attackerName);
            bot.chat(message);
            addGameLog(`🗣️ "${message}"`, botNumber);
            
            addGameLog(`⚔️ Engaged in combat with ${attackerName}!`, botNumber);
            
            // Auto equip best weapon immediately
            equipBestWeapon(bot);
            
            // Start aggressive combat
            startAggressiveCombat(bot, botNumber, attacker);
          }
        }
      } catch (e) {
        console.log(`[BOT ${botNumber}] Error in entityHurt: ${e.message}`);
      }
    });
    
    // Clear target on death
    bot.on('death', () => {
      addGameLog(`☠️ Bot died.`, botNumber);
      bot.combatMode = false;
      bot.lockedTarget = null;
      botTargets.delete(botNumber);
      if (bot.pvp && bot.pvp.stop) {
        bot.pvp.stop();
      }
    });
    
    // ========== IMPROVED CHAT DETECTION ==========
    
    // Method 1: Raw packet listener for chat
    const chatHandler = (packet) => {
      try {
        if (packet.message && typeof packet.message === 'string') {
          const rawMessage = packet.message;
          
          // Clean color codes
          let cleanMsg = rawMessage.replace(/§[0-9a-fk-or]/g, '').trim();
          
          // Essential plugin format detection
          if (cleanMsg.includes(':') && !cleanMsg.startsWith('§')) {
            // Format: "PlayerName: message" (Essential style)
            const colonIndex = cleanMsg.indexOf(':');
            if (colonIndex > 0) {
              const username = cleanMsg.substring(0, colonIndex).trim();
              const chatMessage = cleanMsg.substring(colonIndex + 1).trim();
              
              if (username && chatMessage && username !== bot.username) {
                addGameLog(`💬 <${username}> ${chatMessage}`, botNumber);
                
                // Check for global leave command
                if (chatMessage.toLowerCase().includes('bot leave')) {
                  activateGlobalLeave();
                }
              }
            }
          } 
          // Standard format detection
          else if (cleanMsg.includes('<') && cleanMsg.includes('>')) {
            const match = cleanMsg.match(/<(.+?)>\s*(.+)/);
            if (match) {
              const username = match[1];
              const chatMessage = match[2];
              
              if (username && username !== bot.username) {
                addGameLog(`💬 <${username}> ${chatMessage}`, botNumber);
                
                // Check for global leave command
                if (chatMessage.toLowerCase().includes('bot leave')) {
                  activateGlobalLeave();
                }
              }
            }
          }
          // Log other important messages
          else if (cleanMsg.length > 5 && !cleanMsg.includes('§')) {
            // Detect join/leave messages
            if (cleanMsg.includes('joined') || cleanMsg.includes('left')) {
              addGameLog(`👥 ${cleanMsg}`, botNumber);
            }
            // Detect death messages
            else if (cleanMsg.includes('died') || cleanMsg.includes('slain') || 
                     cleanMsg.includes('killed') || cleanMsg.includes('was killed')) {
              addGameLog(`💀 ${cleanMsg}`, botNumber);
            }
            // Detect advancement messages
            else if (cleanMsg.includes('achievement') || cleanMsg.includes('advancement')) {
              addGameLog(`🏆 ${cleanMsg}`, botNumber);
            }
            // Log other server messages
            else if (!cleanMsg.includes('Unknown command') && 
                     !cleanMsg.includes('commands.message.display') &&
                     !cleanMsg.includes('teleport') &&
                     !cleanMsg.includes('actionbar')) {
              addGameLog(`📝 ${cleanMsg}`, botNumber);
            }
          }
        }
      } catch (e) {
        // Silent fail
      }
    };
    
    // Add chat handler with proper cleanup
    bot._client.on('chat', chatHandler);
    
    // Method 2: Player join/leave detection via packets
    const playerInfoHandler = (packet) => {
      try {
        if (packet.data && Array.isArray(packet.data)) {
          packet.data.forEach(playerInfo => {
            if (playerInfo && playerInfo.profile && playerInfo.profile.name) {
              const username = playerInfo.profile.name;
              
              if (username !== bot.username) {
                if (packet.action === 0) { // 0 = ADD_PLAYER (join)
                  addGameLog(`➡️ ${username} joined the game`, botNumber);
                } else if (packet.action === 4) { // 4 = REMOVE_PLAYER (leave)
                  addGameLog(`⬅️ ${username} left the game`, botNumber);
                }
              }
            }
          });
        }
      } catch (e) {
        // Silent fail
      }
    };
    
    bot._client.on('player_info', playerInfoHandler);
    
    // Clean up listeners on bot end
    bot.on('end', () => {
      try {
        bot._client.removeListener('chat', chatHandler);
        bot._client.removeListener('player_info', playerInfoHandler);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
    
    // ========== END CHAT DETECTION ==========
    
    // PVP-STYLE MOVEMENTS (not AFK)
    let movementInterval;
    const startPvpMovements = () => {
      if (!bot?.entity) {
        if (movementInterval) clearTimeout(movementInterval);
        movementInterval = setTimeout(startPvpMovements, 5000);
        return;
      }
      
      // Random PVP-like behaviors
      const behaviors = [
        // Look around
        () => {
          const yaw = Math.random() * Math.PI * 2;
          const pitch = (Math.random() - 0.5) * Math.PI / 4;
          bot.look(yaw, pitch, false);
        },
        
        // Quick strafe
        () => {
          const direction = Math.random() > 0.5 ? 'left' : 'right';
          bot.setControlState(direction, true);
          setTimeout(() => bot.setControlState(direction, false), 300);
        },
        
        // Jump (like checking surroundings)
        () => {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 100);
        },
        
        // Sprint forward briefly
        () => {
          bot.setControlState('sprint', true);
          bot.setControlState('forward', true);
          setTimeout(() => {
            bot.setControlState('forward', false);
            bot.setControlState('sprint', false);
          }, 500);
        },
        
        // Crouch (sneak)
        () => {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 400);
        }
      ];
      
      // Execute random behavior
      const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
      behavior();
      
      // Schedule next movement
      movementInterval = setTimeout(startPvpMovements, 1000 + Math.random() * 3000);
    };
    
    // Start PVP movements if enabled
    if (config.utils["anti-afk"] !== false) {
      startPvpMovements();
    }
    
    // Clean up movement interval on bot end
    bot.on('end', () => {
      if (movementInterval) {
        clearTimeout(movementInterval);
      }
    });
    
    // PROACTIVE PLAYER DETECTION
    const physicsTickHandler = () => {
      try {
        if (!bot.entity || bot.combatMode) return;
        
        // Look for nearby players
        const nearbyPlayers = Object.values(bot.entities).filter(entity => 
          entity && entity.type === 'player' && 
          entity.username !== bot.username &&
          entity.position && bot.entity.position &&
          entity.position.distanceTo(bot.entity.position) < 10 &&
          !entity.isSleeping
        );
        
        if (nearbyPlayers.length > 0) {
          const closestPlayer = nearbyPlayers.reduce((closest, player) => {
            if (!player.position || !bot.entity.position) return closest;
            const dist = player.position.distanceTo(bot.entity.position);
            return dist < closest.dist ? { player, dist } : closest;
          }, { player: null, dist: Infinity });
          
          if (closestPlayer.player && closestPlayer.dist < 5) {
            // Face players who get close
            bot.lookAt(closestPlayer.player.position.offset(0, 1.6, 0));
            
            // Prepare weapon if player is looking at us
            const playerLookingAtBot = Math.abs(
              Math.atan2(
                bot.entity.position.x - closestPlayer.player.position.x,
                bot.entity.position.z - closestPlayer.player.position.z
              ) - closestPlayer.player.yaw
            ) < 0.5;
            
            if (playerLookingAtBot && closestPlayer.dist < 3) {
              equipBestWeapon(bot);
              addGameLog(`⚠️ Player ${closestPlayer.player.username} is nearby and looking at us`, botNumber);
            }
          }
        }
      } catch (e) {
        // Silent fail
      }
    };
    
    bot.on('physicsTick', physicsTickHandler);
    
    // Clean up physics tick handler
    bot.on('end', () => {
      bot.removeListener('physicsTick', physicsTickHandler);
    });
    
    // ========== IMPROVED AUTO-LOGIN SYSTEM ==========
    
    // Function to handle authentication
    function handleAuthentication() {
      if (config.utils["auto-auth"]?.enabled) {
        const pass = config.utils["auto-auth"].password;
        
        addGameLog(`🔐 Starting authentication sequence...`, botNumber);
        
        // Try multiple authentication methods with delays
        const authAttempts = [
          { delay: 2000, command: `/login ${pass}`, desc: 'Standard login' },
          { delay: 4000, command: `/l ${pass}`, desc: 'Short login' },
          { delay: 6000, command: `/auth ${pass}`, desc: 'Auth command' },
          { delay: 8000, command: `/register ${pass} ${pass}`, desc: 'Register then login' }
        ];
        
        authAttempts.forEach((attempt, index) => {
          setTimeout(() => {
            if (bot.entity) {
              bot.chat(attempt.command);
              addGameLog(`📤 ${attempt.desc}: ${attempt.command}`, botNumber);
            }
          }, attempt.delay);
        });
        
        // Join command after authentication
        if (config.utils["join-command"]?.enabled) {
          const cmd = config.utils["join-command"].command;
          setTimeout(() => {
            if (bot.entity) {
              bot.chat(cmd);
              addGameLog(`🎮 Sent join command: ${cmd}`, botNumber);
            }
          }, 10000);
        }
      } else if (config.utils["join-command"]?.enabled) {
        const cmd = config.utils["join-command"].command;
        setTimeout(() => {
          if (bot.entity) {
            bot.chat(cmd);
            addGameLog(`🎮 Sent join command: ${cmd}`, botNumber);
          }
        }, 5000);
      }
    }
    
    // Start authentication after spawn
    setTimeout(() => {
      handleAuthentication();
    }, 3000);
    
    // Listen for authentication prompts
    const authChatHandler = (packet) => {
      try {
        if (packet.message && typeof packet.message === 'string') {
          const msg = packet.message.toLowerCase();
          
          // Check for auth-related messages
          if (msg.includes('login') || msg.includes('register') || 
              msg.includes('/login') || msg.includes('/register') ||
              msg.includes('please login') || msg.includes('please register')) {
            
            addGameLog(`🔑 Server is asking for authentication`, botNumber);
            
            // Try to authenticate
            if (config.utils["auto-auth"]?.enabled) {
              const pass = config.utils["auto-auth"].password;
              
              setTimeout(() => {
                bot.chat(`/login ${pass}`);
                addGameLog(`📤 Attempting login with password`, botNumber);
              }, 1000);
            }
          }
        }
      } catch (e) {
        // Silent fail
      }
    };
    
    bot._client.on('chat', authChatHandler);
    
    // Clean up auth handler
    bot.on('end', () => {
      try {
        bot._client.removeListener('chat', authChatHandler);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
    
    // ========== END AUTO-LOGIN SYSTEM ==========
    
    // Start dye economy automation if configured
    if (config.utils["dye-economy"]?.enabled) {
      setTimeout(() => {
        dyeModule.start(bot);
        addGameLog(`💰 Started dye economy automation`, botNumber);
      }, 10000);
    }
    
  });
  
  // KICK HANDLING - Bot stays in list
  bot.on('kicked', (reason) => {
    const kickMsg = typeof reason === 'string' ? reason : JSON.stringify(reason);
    bot.lastKickReason = kickMsg;
    
    addGameLog(`🚫 Kicked: ${kickMsg.substring(0, 100)}`, botNumber);
    
    // Update bot status
    const botData = allBots.get(botNumber);
    if (botData) {
      botData.online = false;
      botData.status = 'kicked';
      botData.lastSeen = new Date().toISOString();
      botData.lastReconnectAttempt = Date.now();
    }
    
    const isBan = kickMsg.toLowerCase().includes("ban") || 
                  kickMsg.toLowerCase().includes("banned") ||
                  kickMsg.toLowerCase().includes("permanent") ||
                  kickMsg.toLowerCase().includes("blacklist") ||
                  kickMsg.toLowerCase().includes("hacking") ||
                  kickMsg.toLowerCase().includes("cheat");
    
    if (isBan) {
      addGameLog(`🔨 BAN detected! Generating new identity...`, botNumber);
      bot.isBanned = true;
      generateNewIdentity(botNumber);
    } else {
      addGameLog(`Regular kick. Will reconnect with same identity.`, botNumber);
      bot.isBanned = false;
    }
  });
  
  bot.on('error', (err) => {
    addGameLog(`❌ Error: ${err.message}`, botNumber);
    
    // Update bot status
    const botData = allBots.get(botNumber);
    if (botData) {
      botData.online = false;
      botData.status = 'error';
      botData.lastSeen = new Date().toISOString();
      botData.lastReconnectAttempt = Date.now();
    }
  });
  
  // AUTO-RECONNECT with throttle
  bot.on('end', () => {
    // Update bot status
    const botData = allBots.get(botNumber);
    if (botData) {
      botData.online = false;
      botData.status = 'disconnected';
      botData.lastSeen = new Date().toISOString();
    }
    
    // Check if manually stopped
    if (botControlStates.get(botNumber) === 'STOPPED') {
      addGameLog(`⏸️ Bot ${botNumber} is manually stopped. No auto-reconnect.`, botNumber);
      return;
    }
    
    if (bot.manuallyRemoved) {
      addGameLog(`Bot ${botNumber} was manually removed. No auto-reconnect.`, botNumber);
      return;
    }
    
    if (!config.utils["auto-reconnect"]) {
      addGameLog(`Auto-reconnect disabled for bot ${botNumber}`, botNumber);
      return;
    }
    
    if (removedBots.has(botNumber)) {
      return;
    }
    
    const delay = config.utils["auto-reconnect-delay"] || 15000;
    addGameLog(`Reconnecting bot ${botNumber} in ${delay/1000}s...`, botNumber);
    
    setTimeout(() => {
      if (!removedBots.has(botNumber)) {
        createNewBot(botNumber, false);
      }
    }, delay);
  });
  
  return bot;
}

// Web Interface Routes
app.get('/', (req, res) => {
  const onlineCount = Array.from(allBots.values()).filter(b => b.online).length;
  const totalCount = allBots.size;
  const stoppedCount = Array.from(botControlStates.entries()).filter(([id, state]) => state === 'STOPPED').length;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Minecraft Bot Controller</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --primary: #4f46e5; --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --success: #22c55e; --danger: #ef4444; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }
        
        .mobile-container { display: flex; flex-direction: column; height: 100vh; }
        
        /* Header */
        .header { background: var(--card); padding: 1rem; border-bottom: 1px solid #334155; }
        .header h1 { font-size: 1.25rem; margin: 0; background: linear-gradient(to right, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .server-info { background: #334155; padding: 0.75rem; border-radius: 0.5rem; margin-top: 0.75rem; }
        .server-info div { display: flex; justify-content: space-between; margin-bottom: 0.25rem; }
        .server-label { color: #94a3b8; font-size: 0.875rem; }
        .server-value { font-weight: bold; }
        
        /* Main content with tabs */
        .main-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
        .tabs { display: flex; background: var(--card); border-bottom: 1px solid #334155; }
        .tab { flex: 1; padding: 0.75rem; text-align: center; background: none; border: none; color: #94a3b8; font-size: 0.9rem; cursor: pointer; }
        .tab.active { color: white; border-bottom: 2px solid var(--primary); background: rgba(79, 70, 229, 0.1); }
        
        /* Tab content */
        .tab-content { flex: 1; overflow-y: auto; padding: 1rem; display: none; }
        .tab-content.active { display: flex; flex-direction: column; }
        
        /* Common styles */
        .card { background: var(--card); border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; border: 1px solid #334155; }
        .btn { background: var(--primary); color: white; border: none; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.9rem; cursor: pointer; width: 100%; margin-bottom: 0.5rem; }
        .btn:hover { opacity: 0.9; }
        .btn-success { background: var(--success); }
        .btn-danger { background: var(--danger); }
        .btn-warning { background: #d97706; }
        .btn-small { padding: 0.5rem; font-size: 0.8rem; width: auto; }
        .btn-tiny { padding: 0.25rem 0.5rem; font-size: 0.7rem; }
        input, select, textarea { width: 100%; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.5rem; color: white; margin-bottom: 0.5rem; font-size: 1rem; }
        textarea { height: 80px; resize: vertical; font-family: monospace; }
        
        /* Console */
        .console { background: #000; color: #e0e0e0; padding: 1rem; border-radius: 0.5rem; font-family: 'Courier New', monospace; height: 300px; overflow-y: auto; font-size: 0.85rem; flex: 1; }
        .log-entry { margin-bottom: 0.25rem; padding: 0.25rem; border-bottom: 1px solid #1a1a1a; font-size: 0.8rem; line-height: 1.3; word-break: break-word; }
        .log-chat { color: #a5d6a7; }
        .log-join { color: #64b5f6; }
        .log-leave { color: #ff9800; }
        .log-death { color: #ef5350; }
        .log-combat { color: #ff7043; }
        .log-system { color: #ba68c8; }
        .log-command { color: #4fc3f7; }
        .log-kick { color: #ff6b6b; }
        .log-ban { color: #ff4757; }
        .log-throttle { color: #ffb142; }
        .log-mock { color: #ff6bcb; }
        .log-auth { color: #00d9ff; }
        
        /* Bot list */
        .bot-list { max-height: 300px; overflow-y: auto; margin-bottom: 1rem; }
        .bot-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #334155; border-radius: 0.5rem; margin-bottom: 0.5rem; }
        .bot-info { flex: 1; }
        .bot-name { font-weight: bold; font-size: 0.9rem; }
        .bot-status { font-size: 0.75rem; }
        .bot-status-online { color: #10b981; }
        .bot-status-offline { color: #ef4444; }
        .bot-status-connecting { color: #3b82f6; }
        .bot-status-kicked { color: #f59e0b; }
        .bot-status-error { color: #ef4444; }
        .bot-status-disconnected { color: #94a3b8; }
        .bot-status-stopped { color: #8b5cf6; }
        .bot-stats { display: flex; gap: 0.5rem; font-size: 0.8rem; }
        .bot-health { color: #f87171; }
        .bot-food { color: #fbbf24; }
        .bot-controls { display: flex; gap: 0.25rem; }
        .bot-control-btn { background: #475569; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.7rem; cursor: pointer; min-width: 30px; }
        .bot-control-btn:hover { opacity: 0.8; }
        .bot-stop { background: #dc2626; }
        .bot-resume { background: #059669; }
        .bot-remove { background: #7f1d1d; }
        
        /* Form sections */
        .form-section { margin-bottom: 1.5rem; }
        .form-section h4 { margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.9rem; }
        
        /* Stats cards */
        .stats-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 1rem; }
        .stat-card { background: #334155; padding: 0.75rem; border-radius: 0.5rem; text-align: center; }
        .stat-label { font-size: 0.75rem; color: #94a3b8; }
        .stat-value { font-size: 1.25rem; font-weight: bold; }
        
        /* Mobile optimizations */
        @media (max-width: 768px) {
          .header h1 { font-size: 1.1rem; }
          .tab { padding: 0.5rem; font-size: 0.8rem; }
          .console { height: 250px; }
          .stats-cards { grid-template-columns: 1fr; }
        }
        
        /* Dark scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1e293b; }
        ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #64748b; }
      </style>
    </head>
    <body>
      <div class="mobile-container">
        <!-- Header -->
        <div class="header">
          <h1>🤖 Minecraft Bot Controller</h1>
          <div class="server-info">
            <div>
              <span class="server-label">Server:</span>
              <span class="server-value">${config.server.ip}:${config.server.port}</span>
            </div>
            <div>
              <span class="server-label">Bots:</span>
              <span class="server-value" id="totalBots">${totalCount}</span>
            </div>
          </div>
        </div>
        
        <!-- Tabs -->
        <div class="tabs">
          <button class="tab active" onclick="switchTab('dashboard')">🏠 Dashboard</button>
          <button class="tab" onclick="switchTab('bots')">🤖 Bots</button>
          <button class="tab" onclick="switchTab('console')">📟 Console</button>
          <button class="tab" onclick="switchTab('server')">🌐 Server</button>
        </div>
        
        <!-- Main content -->
        <div class="main-content">
          <!-- Dashboard Tab -->
          <div class="tab-content active" id="dashboardTab">
            <div class="stats-cards">
              <div class="stat-card">
                <div class="stat-label">Total Bots</div>
                <div class="stat-value" id="dashboardTotalBots">${totalCount}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Online</div>
                <div class="stat-value" id="dashboardOnlineBots">${onlineCount}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Stopped</div>
                <div class="stat-value" id="dashboardStoppedBots">${stoppedCount}</div>
              </div>
            </div>
            
            <div class="card">
              <h3 style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                <span>Available Bots</span>
                <span style="font-size: 0.8rem; color: #94a3b8;" id="botCount">${totalCount} bots</span>
              </h3>
              <div class="bot-list" id="botList">
                <!-- Bots will be loaded here -->
              </div>
              <div style="text-align: center; margin-top: 1rem;">
                <button class="btn btn-success btn-small" onclick="addBot(1)">+ Add Random Bot</button>
                <button class="btn btn-danger btn-small" onclick="removeAllBots()" style="margin-left: 0.5rem;">Remove All</button>
              </div>
            </div>
          </div>
          
          <!-- Bots Tab -->
          <div class="tab-content" id="botsTab">
            <div class="card">
              <h3 style="margin-bottom: 1rem;">Create Bots</h3>
              
              <div class="form-section">
                <h4>Quick Random Bots</h4>
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
                  <input type="number" id="addBotCount" value="1" min="1" max="10" placeholder="Number of bots">
                  <button class="btn btn-success" onclick="addCustomBots()">Add Random</button>
                </div>
              </div>
              
              <div class="form-section">
                <h4>Custom Bot with UUID</h4>
                <input type="text" id="customBotName" placeholder="Bot username (min 4 characters)">
                <textarea id="customBotUUID" placeholder="Bot UUID (optional)&#10;Leave empty for random UUID&#10;Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></textarea>
                <div style="display: flex; gap: 0.5rem;">
                  <button class="btn btn-warning" onclick="addCustomUUIDBot()">Add Custom Bot</button>
                  <button class="btn btn-small" onclick="generateRandomUUID()" style="flex: 0 0 auto;">Generate UUID</button>
                </div>
              </div>
              
              <button class="btn btn-danger" onclick="removeAllBots()" style="margin-top: 1rem;">Remove All Bots</button>
            </div>
            
            <div class="card">
              <h3>Bot Management</h3>
              <div id="botManagementList">
                <!-- Bot management will be loaded here -->
              </div>
            </div>
            
            <div class="card">
              <h3>Send Command</h3>
              <select id="targetBot">
                <option value="all">All Bots</option>
                <!-- Bot options will be added here -->
              </select>
              <div class="command-input">
                <input type="text" id="specificCommand" placeholder="Command for selected bot..." onkeypress="if(event.key=='Enter') sendSpecificCommand()">
                <button class="btn btn-small" onclick="sendSpecificCommand()">Send</button>
              </div>
            </div>
          </div>
          
          <!-- Console Tab -->
          <div class="tab-content" id="consoleTab">
            <div class="card" style="flex: 1; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">Game Console</h3>
                <div>
                  <button class="btn btn-small" onclick="clearConsole()">Clear</button>
                  <button class="btn btn-small" onclick="toggleAutoScroll()" id="autoScrollBtn">Auto: ON</button>
                </div>
              </div>
              <div class="console" id="gameConsole">
                <div class="log-entry log-system">[SYSTEM] Console ready. All game logs appear here.</div>
              </div>
              <div class="command-input">
                <input type="text" id="consoleCommand" placeholder="Command for all bots..." onkeypress="if(event.key=='Enter') sendConsoleCommand()">
                <button class="btn btn-small" onclick="sendConsoleCommand()">Send</button>
              </div>
            </div>
          </div>
          
          <!-- Server Tab -->
          <div class="tab-content" id="serverTab">
            <div class="card">
              <h3>Server Settings</h3>
              <input type="text" id="serverIp" placeholder="Server IP" value="${config.server.ip}">
              <input type="number" id="serverPort" placeholder="Port" value="${config.server.port}">
              <button class="btn" onclick="updateServer()">Update Server</button>
            </div>
            
            <div class="card">
              <h3>Recent Servers</h3>
              <div class="history-list" id="serverHistory">
                <!-- History will be loaded here -->
              </div>
            </div>
            
            <div class="card">
              <h3>Bot Settings</h3>
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="autoReconnect" ${config.utils["auto-reconnect"] ? 'checked' : ''}>
                  Auto Reconnect
                </label>
                <label style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="antiAfk" ${config.utils["anti-afk"] !== false ? 'checked' : ''}>
                  Anti-AFK
                </label>
                <label style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="chatLog" ${config.utils["chat-log"] ? 'checked' : ''}>
                  Chat Logging
                </label>
                <button class="btn" onclick="saveSettings()">Save Settings</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        let autoScroll = true;
        let selectedBotId = 'all';
        
        // Initialize
        updateAllData();
        setInterval(updateAllData, 1500);
        
        function updateAllData() {
          updateStats();
          updateBotList();
          updateBotManagement();
          updateFullConsole();
          updateServerHistory();
          updateBotDropdown();
        }
        
        function updateStats() {
          fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
              document.getElementById('totalBots').textContent = data.totalBots;
              document.getElementById('dashboardTotalBots').textContent = data.totalBots;
              document.getElementById('dashboardOnlineBots').textContent = data.onlineBots;
              document.getElementById('dashboardStoppedBots').textContent = data.stoppedBots || 0;
              document.getElementById('botCount').textContent = \`\${data.totalBots} bots\`;
            });
        }
        
        function updateBotList() {
          fetch('/api/bots')
            .then(res => res.json())
            .then(data => {
              const botList = document.getElementById('botList');
              botList.innerHTML = '';
              
              if (data.bots.length === 0) {
                botList.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 1rem;">No bots created yet. Add a bot to start.</div>';
                return;
              }
              
              // Sort bots by ID
              data.bots.sort((a, b) => a.id - b.id);
              
              data.bots.forEach(bot => {
                const botDiv = document.createElement('div');
                botDiv.className = 'bot-item';
                
                // Determine status class
                let statusClass = 'bot-status-';
                let statusText = '';
                
                if (bot.controlState === 'STOPPED') {
                  statusClass += 'stopped';
                  statusText = '⏸️ Stopped';
                } else if (bot.online) {
                  statusClass += 'online';
                  statusText = '🟢 Online';
                } else {
                  statusClass += bot.status || 'offline';
                  statusText = \`🔴 \${bot.status || 'Offline'}\`;
                }
                
                botDiv.innerHTML = \`
                  <div class="bot-info">
                    <div class="bot-name">\${bot.name}</div>
                    <div class="bot-status \${statusClass}">
                      \${statusText} | ID: \${bot.id}
                      \${bot.lastSeen ? ' | ' + bot.lastSeen : ''}
                    </div>
                  </div>
                  <div class="bot-controls">
                    \${bot.controlState === 'STOPPED' ? 
                      \`<button class="bot-control-btn bot-resume" onclick="startBot(\${bot.id})" title="Start bot">▶</button>\` : 
                      \`<button class="bot-control-btn bot-stop" onclick="stopBot(\${bot.id})" title="Stop bot">⏸</button>\`
                    }
                    <button class="bot-control-btn bot-remove" onclick="removeBot(\${bot.id})" title="Remove bot">X</button>
                  </div>
                \`;
                botList.appendChild(botDiv);
              });
            });
        }
        
        function updateBotManagement() {
          fetch('/api/bots')
            .then(res => res.json())
            .then(data => {
              const mgmtList = document.getElementById('botManagementList');
              mgmtList.innerHTML = '';
              
              if (data.bots.length === 0) {
                mgmtList.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 1rem;">No bots to manage</div>';
                return;
              }
              
              // Sort bots by ID
              data.bots.sort((a, b) => a.id - b.id);
              
              data.bots.forEach(bot => {
                const botDiv = document.createElement('div');
                botDiv.className = 'bot-item';
                
                let statusClass = 'bot-status-';
                let statusText = '';
                
                if (bot.controlState === 'STOPPED') {
                  statusClass += 'stopped';
                  statusText = '⏸️ Stopped';
                } else if (bot.online) {
                  statusClass += 'online';
                  statusText = '🟢 Online';
                } else {
                  statusClass += bot.status || 'offline';
                  statusText = \`🔴 \${bot.status || 'Offline'}\`;
                }
                
                botDiv.innerHTML = \`
                  <div class="bot-info">
                    <div class="bot-name">\${bot.name}</div>
                    <div class="bot-status \${statusClass}">
                      \${statusText} | ID: \${bot.id}
                    </div>
                  </div>
                  <div class="bot-controls">
                    \${bot.controlState === 'STOPPED' ? 
                      \`<button class="bot-control-btn bot-resume" onclick="startBot(\${bot.id})" title="Start bot">▶</button>\` : 
                      \`<button class="bot-control-btn bot-stop" onclick="stopBot(\${bot.id})" title="Stop bot">⏸</button>\`
                    }
                    <button class="bot-control-btn bot-remove" onclick="removeBot(\${bot.id})" title="Remove bot">X</button>
                  </div>
                \`;
                mgmtList.appendChild(botDiv);
              });
            });
        }
        
        function updateBotDropdown() {
          fetch('/api/bots')
            .then(res => res.json())
            .then(data => {
              const dropdown = document.getElementById('targetBot');
              dropdown.innerHTML = '<option value="all">All Bots</option>';
              
              // Sort bots by ID
              data.bots.sort((a, b) => a.id - b.id);
              
              data.bots.forEach(bot => {
                if (bot.online && bot.controlState !== 'STOPPED') {
                  const option = document.createElement('option');
                  option.value = bot.id;
                  option.textContent = \`Bot \${bot.id}: \${bot.name}\`;
                  dropdown.appendChild(option);
                }
              });
            });
        }
        
        function updateFullConsole() {
          fetch('/api/console')
            .then(res => res.json())
            .then(data => {
              const consoleDiv = document.getElementById('gameConsole');
              
              if (data.logs.length > 0) {
                let newHTML = '';
                
                data.logs.forEach(log => {
                  let logClass = 'log-system';
                  if (log.includes('Starting authentication') || log.includes('Standard login') || log.includes('Attempting login')) logClass = 'log-auth';
                  if (log.includes('"') && (log.includes('finished') || log.includes('wrong bot') || log.includes('Game over'))) logClass = 'log-mock';
                  if (log.includes('<') && log.includes('>')) logClass = 'log-chat';
                  if (log.includes(':')) logClass = 'log-chat';
                  if (log.includes('joined')) logClass = 'log-join';
                  if (log.includes('left')) logClass = 'log-leave';
                  if (log.includes('killed') || log.includes('died') || log.includes('slain')) logClass = 'log-death';
                  if (log.includes('Attacked') || log.includes('Fighting') || log.includes('Locked on') || log.includes('Engaged') || log.includes('Targeting')) logClass = 'log-combat';
                  if (log.includes('[WEB]')) logClass = 'log-command';
                  if (log.includes('Kicked:')) logClass = 'log-kick';
                  if (log.includes('BAN detected')) logClass = 'log-ban';
                  if (log.includes('Connection throttled')) logClass = 'log-throttle';
                  if (log.includes('Equipped') || log.includes('Eating') || log.includes('Player') || log.includes('nearby')) logClass = 'log-system';
                  
                  newHTML += \`<div class="log-entry \${logClass}">\${log}</div>\`;
                });
                
                consoleDiv.innerHTML = newHTML;
                
                if (autoScroll) {
                  consoleDiv.scrollTop = consoleDiv.scrollHeight;
                }
              }
            });
        }
        
        function updateServerHistory() {
          fetch('/api/history')
            .then(res => res.json())
            .then(data => {
              const historyDiv = document.getElementById('serverHistory');
              historyDiv.innerHTML = '';
              
              data.history.forEach(server => {
                const item = document.createElement('div');
                item.className = 'history-item';
                item.innerHTML = \`
                  <div>\${server.ip}</div>
                  <small>Port: \${server.port}</small>
                \`;
                item.onclick = () => {
                  document.getElementById('serverIp').value = server.ip;
                  document.getElementById('serverPort').value = server.port;
                };
                historyDiv.appendChild(item);
              });
            });
        }
        
        function addBot(count) {
          fetch('/api/bots/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: count })
          }).then(() => {
            updateAllData();
          });
        }
        
        function addCustomBots() {
          const count = parseInt(document.getElementById('addBotCount').value) || 1;
          addBot(count);
        }
        
        // Add custom UUID bot
        function addCustomUUIDBot() {
          const name = document.getElementById('customBotName').value.trim();
          let uuid = document.getElementById('customBotUUID').value.trim();
          
          if (!name) {
            alert('Please enter a bot username!');
            return;
          }
          
          if (name.length < 4) {
            alert('Bot username must be at least 4 characters!');
            return;
          }
          
          // If UUID is provided, validate format
          if (uuid) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(uuid)) {
              alert('Invalid UUID format! Should be: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
              return;
            }
          } else {
            uuid = null;
          }
          
          fetch('/api/bots/add-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              name: name,
              uuid: uuid
            })
          }).then(response => response.json())
            .then(data => {
              if (data.success) {
                document.getElementById('customBotName').value = '';
                document.getElementById('customBotUUID').value = '';
                updateAllData();
                alert('Custom bot added successfully!');
              } else {
                alert('Error: ' + (data.error || 'Failed to add bot'));
              }
            });
        }
        
        // Generate random UUID
        function generateRandomUUID() {
          const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
          document.getElementById('customBotUUID').value = uuid;
        }
        
        // Bot control functions
        function stopBot(botId) {
          fetch(\`/api/bot/\${botId}/stop\`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                updateAllData();
              }
            });
        }
        
        function startBot(botId) {
          fetch(\`/api/bot/\${botId}/start\`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                updateAllData();
              }
            });
        }
        
        function removeBot(botId) {
          if (confirm('Remove this bot permanently?')) {
            fetch('/api/bots/remove', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ botId: botId, permanent: true })
            }).then(() => {
              updateAllData();
            });
          }
        }
        
        function removeAllBots() {
          if (confirm('Remove ALL bots permanently?')) {
            fetch('/api/bots/remove-all', { method: 'POST' })
              .then(() => updateAllData());
          }
        }
        
        function updateServer() {
          const ip = document.getElementById('serverIp').value;
          const port = document.getElementById('serverPort').value;
          
          fetch('/api/update-server', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: ip, port: parseInt(port) })
          }).then(() => updateAllData());
        }
        
        function sendCommand(command, target = 'all') {
          if (!command || command.trim() === '') return;
          
          fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              command: command.trim(),
              target: target 
            })
          }).then(response => response.json())
            .then(data => {
              if (data.success) {
                console.log('Command sent:', command);
              }
            })
            .catch(error => {
              console.error('Error sending command:', error);
            });
        }
        
        function sendConsoleCommand() {
          const command = document.getElementById('consoleCommand').value;
          if (command.trim()) {
            sendCommand(command);
            document.getElementById('consoleCommand').value = '';
          }
        }
        
        function sendSpecificCommand() {
          const command = document.getElementById('specificCommand').value;
          const target = document.getElementById('targetBot').value;
          if (command.trim()) {
            sendCommand(command, target);
            document.getElementById('specificCommand').value = '';
          }
        }
        
        function clearConsole() {
          fetch('/api/console/clear', { method: 'POST' })
            .then(() => updateFullConsole());
        }
        
        function toggleAutoScroll() {
          autoScroll = !autoScroll;
          document.getElementById('autoScrollBtn').textContent = 
            \`Auto: \${autoScroll ? 'ON' : 'OFF'}\`;
        }
        
        function switchTab(tabName) {
          document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
          });
          document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
          });
          
          event.target.classList.add('active');
          document.getElementById(\`\${tabName}Tab\`).classList.add('active');
        }
        
        function saveSettings() {
          const settings = {
            autoReconnect: document.getElementById('autoReconnect').checked,
            antiAfk: document.getElementById('antiAfk').checked,
            chatLog: document.getElementById('chatLog').checked
          };
          
          fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
          }).then(() => {
            alert('Settings saved!');
          });
        }
        
        document.getElementById('targetBot').addEventListener('change', function() {
          selectedBotId = this.value;
        });
      </script>
    </body>
    </html>
  `);
});

// API Endpoints
app.get('/api/stats', (req, res) => {
  const onlineBots = Array.from(allBots.values()).filter(b => b.online).length;
  const totalBots = allBots.size;
  const stoppedBots = Array.from(botControlStates.entries()).filter(([id, state]) => state === 'STOPPED').length;
  
  res.json({
    totalBots: totalBots,
    onlineBots: onlineBots,
    stoppedBots: stoppedBots,
    currentIdentity: totalBots > 0 ? Array.from(allBots.values())[0].bot?.botName || "Player_XXXXXX" : "Player_XXXXXX"
  });
});

app.get('/api/bots', (req, res) => {
  const botData = Array.from(allBots.entries()).map(([id, data]) => {
    const bot = data.bot;
    const controlState = botControlStates.get(id) || 'RUNNING';
    
    return {
      id: id,
      name: bot ? bot.botName : (botIdentities.get(id)?.name || `Bot_${id}`),
      online: data.online || false,
      status: data.status || 'offline',
      lastSeen: data.lastSeen ? new Date(data.lastSeen).toLocaleTimeString() : null,
      health: data.health || 0,
      food: data.food || 0,
      reconnectAttempts: data.reconnectAttempts || 0,
      controlState: controlState
    };
  });
  
  // Sort by ID
  botData.sort((a, b) => a.id - b.id);
  
  res.json({ bots: botData });
});

app.get('/api/history', (req, res) => {
  res.json({ history: serverHistory });
});

app.get('/api/console', (req, res) => {
  res.json({ logs: gameLogs.slice(0, 30) });
});

app.post('/api/console/clear', (req, res) => {
  gameLogs.length = 0;
  addGameLog('[SYSTEM] Console cleared');
  res.json({ success: true });
});

app.post('/api/bots/add', (req, res) => {
  const count = Math.min(parseInt(req.body.count) || 1, MAX_BOTS - allBots.size);
  
  // Find available IDs
  let availableIds = [];
  for (let i = 1; i <= MAX_BOTS; i++) {
    if (!allBots.has(i) && !removedBots.has(i)) {
      availableIds.push(i);
      if (availableIds.length >= count) break;
    }
  }
  
  const addedIds = [];
  availableIds.slice(0, count).forEach((botId, index) => {
    setTimeout(() => {
      if (!removedBots.has(botId)) {
        createNewBot(botId, false);
        addedIds.push(botId);
        botControlStates.set(botId, 'RUNNING');
      }
    }, index * 1000);
  });
  
  addGameLog(`[WEB] Adding ${count} random bot(s)`);
  res.json({ success: true, added: count, botIds: addedIds });
});

// Add custom bot with specific UUID
app.post('/api/bots/add-custom', (req, res) => {
  const { name, uuid } = req.body;
  
  if (!name || name.trim() === '') {
    return res.json({ success: false, error: 'Bot name is required' });
  }
  
  if (name.length < 4) {
    return res.json({ success: false, error: 'Bot name must be at least 4 characters' });
  }
  
  if (allBots.size >= MAX_BOTS) {
    return res.json({ success: false, error: `Maximum ${MAX_BOTS} bots reached` });
  }
  
  // Find next available ID
  let nextId = 1;
  for (let i = 1; i <= MAX_BOTS; i++) {
    if (!allBots.has(i) && !removedBots.has(i)) {
      nextId = i;
      break;
    }
  }
  
  // Create bot with custom identity
  const botId = nextId;
  if (!removedBots.has(botId)) {
    createNewBot(botId, true, name, uuid);
    botControlStates.set(botId, 'RUNNING');
  }
  
  addGameLog(`[WEB] Adding custom bot: ${name}`);
  res.json({ success: true, botId: botId, name: name });
});

app.post('/api/bots/remove', (req, res) => {
  const botId = parseInt(req.body.botId);
  const permanent = req.body.permanent === true;
  const botData = allBots.get(botId);
  
  if (botData) {
    const bot = botData.bot;
    
    if (bot) {
      bot.manuallyRemoved = true;
      bot.end();
    }
    
    if (permanent) {
      removedBots.add(botId);
      botIdentities.delete(botId);
      allBots.delete(botId);
      botControlStates.delete(botId);
      botTargets.delete(botId);
    } else {
      // Just mark as removed but keep in allBots
      botData.online = false;
      botData.status = 'removed';
    }
    
    const botName = bot ? bot.botName : `Bot_${botId}`;
    addGameLog(`[WEB] Removing bot ${botId} (${botName})`);
  }
  
  res.json({ success: true });
});

app.post('/api/bots/remove-all', (req, res) => {
  addGameLog(`[WEB] Removing all ${allBots.size} bots permanently`);
  
  allBots.forEach((botData, botId) => {
    const bot = botData.bot;
    if (bot) {
      bot.manuallyRemoved = true;
      bot.end();
    }
    removedBots.add(botId);
    botIdentities.delete(botId);
    botControlStates.delete(botId);
    botTargets.delete(botId);
  });
  
  allBots.clear();
  res.json({ success: true });
});

// Bot control API endpoints
app.get('/api/bot/:id/state', (req, res) => {
  const botId = parseInt(req.params.id);
  const state = botControlStates.get(botId) || 'RUNNING';
  res.json({ botId, state });
});

app.post('/api/bot/:id/stop', (req, res) => {
  const botId = parseInt(req.params.id);
  const success = stopBot(botId);
  res.json({ success, botId, state: 'STOPPED' });
});

app.post('/api/bot/:id/start', (req, res) => {
  const botId = parseInt(req.params.id);
  const success = startBot(botId);
  res.json({ success, botId, state: 'RUNNING' });
});

app.post('/api/bot/:id/toggle', (req, res) => {
  const botId = parseInt(req.params.id);
  const currentState = botControlStates.get(botId) || 'RUNNING';
  
  let success, newState;
  if (currentState === 'RUNNING') {
    success = stopBot(botId);
    newState = 'STOPPED';
  } else {
    success = startBot(botId);
    newState = 'RUNNING';
  }
  
  res.json({ success, botId, state: newState });
});

app.post('/api/command', (req, res) => {
  const { command, target = 'all' } = req.body;
  
  if (!command || command.trim() === '') {
    return res.json({ success: false, error: 'No command provided' });
  }
  
  let sentTo = [];
  
  if (target === 'all') {
    allBots.forEach((botData, botId) => {
      const bot = botData.bot;
      const controlState = botControlStates.get(botId);
      if (bot && botData.online && controlState !== 'STOPPED') {
        bot.chat(command);
        sentTo.push(botId);
      }
    });
    addGameLog(`[WEB] Command to all bots: ${command}`);
  } else {
    const botId = parseInt(target);
    const botData = allBots.get(botId);
    const controlState = botControlStates.get(botId);
    if (botData && botData.bot && botData.online && controlState !== 'STOPPED') {
      botData.bot.chat(command);
      sentTo.push(botId);
      addGameLog(`[WEB] Command to bot ${botId}: ${command}`);
    }
  }
  
  res.json({ 
    success: true, 
    command: command,
    sentTo: sentTo,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/update-server', (req, res) => {
  const { ip, port } = req.body;
  const newPort = parseInt(port);
  
  if (!ip || !port) {
    return res.json({ success: false, error: 'Missing IP or port' });
  }
  
  addToHistory(ip, newPort);
  
  config.server.ip = ip;
  config.server.port = newPort;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  addGameLog(`[WEB] Changing server to ${ip}:${newPort}`);
  
  // Disconnect all bots
  allBots.forEach((botData) => {
    const bot = botData.bot;
    if (bot) {
      bot.end();
    }
  });
  
  // Clear allBots but keep identities and control states
  allBots.clear();
  botTargets.clear();
  
  // Reconnect all bots to new server (except stopped ones)
  setTimeout(() => {
    const botIds = Array.from(botIdentities.keys());
    botIds.forEach((botId, index) => {
      if (!removedBots.has(botId) && botControlStates.get(botId) !== 'STOPPED') {
        setTimeout(() => createNewBot(botId, false), index * 1000);
      }
    });
  }, 2000);
  
  res.json({ success: true });
});

app.post('/api/settings', (req, res) => {
  const { autoReconnect, antiAfk, chatLog } = req.body;
  
  config.utils["auto-reconnect"] = autoReconnect;
  config.utils["anti-afk"] = antiAfk;
  config.utils["chat-log"] = chatLog;
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  res.json({ success: true });
});

// Start web server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WEB] Server running on port ${PORT}`);
  addGameLog(`[SYSTEM] Web server started on port ${PORT}`);
  
  const initialBots = config.botAccount?.initialCount || 1;
  if (initialBots > 0) {
    addGameLog(`[SYSTEM] Starting ${initialBots} initial bots...`);
    for (let i = 1; i <= initialBots; i++) {
      setTimeout(() => {
        createNewBot(i, false);
        botControlStates.set(i, 'RUNNING');
      }, i * 1000);
    }
  }
});

// Override console.log
const originalLog = console.log;
console.log = function(...args) {
  const message = args.join(' ');
  const logEntry = `[SYSTEM] ${message}`;
  gameLogs.unshift(logEntry);
  if (gameLogs.length > MAX_GAME_LOGS) gameLogs.pop();
  originalLog.apply(console, args);
};
