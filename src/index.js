const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const config = require('../settings.json');

const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../settings.json');

// Web server for keep-alive and config
const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    const history = config.server.history || [];
    const historyHtml = history.map(h => `
        <div style="background: #334155; padding: 0.75rem; border-radius: 0.5rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div style="font-size: 0.875rem;">
                <div style="font-weight: 600;">${h.ip}</div>
                <div style="color: #94a3b8; font-size: 0.75rem;">Port: ${h.port}</div>
            </div>
            <form action="/update" method="POST" style="margin:0; width: auto;">
                <input type="hidden" name="ip" value="${h.ip}">
                <input type="hidden" name="port" value="${h.port}">
                <button type="submit" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; background: #334155; border: 1px solid #4f46e5; margin:0;">Connect</button>
            </form>
        </div>
    `).join('');

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Bot Controller Pro</title>
            <style>
                :root {
                    --primary: #4f46e5;
                    --bg: #0f172a;
                    --card: #1e293b;
                    --text: #f8fafc;
                    --success: #22c55e;
                    --danger: #ef4444;
                }
                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    background-color: var(--bg);
                    color: var(--text);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    padding: 1rem;
                }
                .container {
                    background-color: var(--card);
                    padding: 2rem;
                    border-radius: 1rem;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    width: 100%;
                    max-width: 400px;
                    border: 1px solid #334155;
                }
                h1 {
                    font-size: 1.5rem;
                    margin-bottom: 1.5rem;
                    text-align: center;
                    background: linear-gradient(to right, #818cf8, #c084fc);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .status-card {
                    background: #334155;
                    padding: 1rem;
                    border-radius: 0.5rem;
                    margin-bottom: 1.5rem;
                }
                .status-item {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 0.5rem;
                }
                .status-label { color: #94a3b8; font-size: 0.875rem; }
                .status-value { font-weight: 600; font-family: monospace; }
                .badge {
                    padding: 0.25rem 0.5rem;
                    border-radius: 9999px;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                }
                .badge-online { background: #065f46; color: #34d399; }
                .badge-offline { background: #7f1d1d; color: #f87171; }
                form { display: flex; flex-direction: column; gap: 1rem; }
                .field { display: flex; flex-direction: column; gap: 0.5rem; }
                label { font-size: 0.875rem; color: #94a3b8; }
                input {
                    background: #0f172a;
                    border: 1px solid #334155;
                    padding: 0.75rem;
                    border-radius: 0.5rem;
                    color: white;
                    outline: none;
                    transition: border-color 0.2s;
                }
                input:focus { border-color: var(--primary); }
                button {
                    background: var(--primary);
                    color: white;
                    border: none;
                    padding: 0.75rem;
                    border-radius: 0.5rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: opacity 0.2s;
                    margin-top: 0.5rem;
                }
                button:hover { opacity: 0.9; }
                .footer {
                    margin-top: 1.5rem;
                    text-align: center;
                    font-size: 0.75rem;
                    color: #64748b;
                }
                .history-title {
                    font-size: 0.875rem;
                    color: #94a3b8;
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Bot Control Center</h1>
                
                <div class="status-card">
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="badge ${bot?.entity ? 'badge-online' : 'badge-offline'}">${bot?.entity ? 'Online' : 'Connecting...'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Players</span>
                        <span class="status-value">${bot?.players ? Object.keys(bot.players).length : 0}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Current IP</span>
                        <span class="status-value">${config.server.ip}</span>
                    </div>
                </div>

                <form action="/update" method="POST">
                    <div class="field">
                        <label>Target IP Address</label>
                        <input type="text" name="ip" value="${config.server.ip}" placeholder="e.g. play.hypixel.net">
                    </div>
                    <div class="field">
                        <label>Server Port</label>
                        <input type="number" name="port" value="${config.server.port}" placeholder="25565">
                    </div>
                    <button type="submit">Update & Join Server</button>
                </form>

                ${history.length > 0 ? `
                    <div class="history-title">Recent Servers</div>
                    ${historyHtml}
                ` : ''}

                <div class="footer">
                    Bot identity: ${currentName}
                </div>
            </div>
            <script>
                // Auto-refresh every 10 seconds to show live status
                setTimeout(() => location.reload(), 10000);
            </script>
        </body>
        </html>
    `);
});

app.post('/update', (req, res) => {
    const { ip, port } = req.body;
    const newPort = parseInt(port);

    // Update history before changing current IP
    if (!config.server.history) config.server.history = [];
    
    // Add current to history if different
    if (config.server.ip !== ip || config.server.port !== newPort) {
        const entry = { ip: config.server.ip, port: config.server.port };
        // Avoid duplicates in history
        const exists = config.server.history.find(h => h.ip === entry.ip && h.port === entry.port);
        if (!exists) {
            config.server.history.unshift(entry);
            if (config.server.history.length > 3) config.server.history.pop();
        }
    }

    config.server.ip = ip;
    config.server.port = newPort;
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    if (bot) {
        bot.end();
    } else {
        createBot();
    }
    
    res.redirect('/');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`[WEB] Keep-alive server active on port ${PORT}`));

let bot = null;
let botRunning = false;
let currentName = "Player_" + Math.floor(Math.random() * 999999);
let currentUUID = uuidv4();

function createBot() {
    if (botRunning) return;
    botRunning = true;

    console.log(`\n[START] Connecting as ${currentName} to ${config.server.ip}:${config.server.port}`);

    bot = mineflayer.createBot({
        host: config.server.ip,
        port: config.server.port,
        username: currentName,
        uuid: currentUUID,
        version: "1.20.1",
        auth: "offline",
        checkTimeoutInterval: 60000
    });

    let defaultMove = null;

    bot.on('inject_allowed', () => {
        const mcData = require('minecraft-data')(bot.version || "1.20.1");
        if (mcData) {
            bot.loadPlugin(pathfinder);
            bot.loadPlugin(pvp);
            defaultMove = new Movements(bot, mcData);
            // Optimization for pathfinding
            defaultMove.canDig = false;
            defaultMove.allow1by1towers = false;
            bot.pathfinder.setMovements(defaultMove);
            console.log("[INIT] Plugins and movement data loaded.");
        }
    });

    bot.once('spawn', () => {
        console.log("[GAME] Bot spawned in world.");
        bot.settings.colorsEnabled = false;

        // Combat AI: Target only direct attacker
        let currentTarget = null;
        bot.on('entityHurt', (entity) => {
            if (entity !== bot.entity) return;
            
            const attacker = bot.nearestEntity(e => 
                (e.type === 'player' || e.type === 'mob') && 
                e.position.distanceTo(bot.entity.position) < 16
            );

            if (attacker && !currentTarget) {
                currentTarget = attacker;
                console.log(`[COMBAT] Focused on attacker: ${attacker.username || attacker.name}`);
                bot.pvp.attack(attacker);
            }
        });

        // Reset combat when target dies, bot dies, or target leaves
        bot.on('entityGone', (entity) => {
            if (currentTarget && entity === currentTarget) {
                console.log("[COMBAT] Target gone. Relaxing.");
                bot.pvp.stop();
                currentTarget = null;
            }
        });

        bot.on('death', () => {
            console.log("[COMBAT] Bot died. Stopping combat.");
            bot.pvp.stop();
            currentTarget = null;
        });

        bot.on('stoppedAttacking', () => {
            if (currentTarget && (!currentTarget.isValid || currentTarget.health <= 0)) {
                console.log("[COMBAT] Victory! Stopping.");
                currentTarget = null;
            }
        });

        // Sequence: 1. Register, 2. Login, 3. Join Command
        if (config.utils["auto-auth"]?.enabled) {
            const pass = config.utils["auto-auth"].password;
            
            // 1. Register (Step 1)
            setTimeout(() => {
                console.log("[AUTH] Sending register command...");
                bot.chat(`/register ${pass} ${pass}`);
                
                // 2. Login (Step 2 - 2 seconds after register)
                setTimeout(() => {
                    console.log("[AUTH] Sending login command...");
                    bot.chat(`/login ${pass}`);
                    
                    // 3. Join Command (Step 3 - 2 seconds after login)
                    if (config.utils["join-command"]?.enabled) {
                        const cmd = config.utils["join-command"].command;
                        setTimeout(() => {
                            console.log(`[GAME] Executing join command: ${cmd}`);
                            bot.chat(cmd);
                        }, 2000);
                    }
                }, 2000);
            }, 2000);
        } else if (config.utils["join-command"]?.enabled) {
            // If auth is disabled, just run join command after 4s
            const cmd = config.utils["join-command"].command;
            setTimeout(() => {
                console.log(`[GAME] Executing join command: ${cmd}`);
                bot.chat(cmd);
            }, 4000);
        }

        // Random movement to prevent AFK kick
        const movementLoop = () => {
            if (!bot?.entity) return setTimeout(movementLoop, 5000);
            
            const states = ['forward', 'back', 'left', 'right', 'jump', 'sprint'];
            const randomState = states[Math.floor(Math.random() * states.length)];
            
            bot.setControlState(randomState, true);
            setTimeout(() => {
                if (bot) bot.setControlState(randomState, false);
                setTimeout(movementLoop, Math.floor(Math.random() * 5000) + 5000);
            }, 1000);
        };
        movementLoop();

        // Auto-sleep logic
        const sleepInterval = setInterval(async () => {
            if (!bot?.entity || bot.time.isDay || !defaultMove) return;

            const bed = bot.findBlock({
                matching: b => bot.isABed(b),
                maxDistance: 16
            });

            if (bed) {
                console.log("[GAME] Bed found, attempting to sleep...");
                try {
                    bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
                    setTimeout(async () => {
                        try { await bot.sleep(bed); } catch (e) {}
                    }, 3000);
                } catch (err) {}
            }
        }, 15000);

        bot.once('end', () => clearInterval(sleepInterval));
    });

    bot.on('chat', (username, message) => {
        if (config.utils["chat-log"]) {
            console.log(`[CHAT] <${username}> ${message}`);
        }
    });

    bot.on('kicked', (reason) => {
        const kickMsg = typeof reason === 'string' ? reason : JSON.stringify(reason);
        console.log(`[KICK] Reason: ${kickMsg}`);
        
        if (kickMsg.toLowerCase().includes("ban")) {
            console.log("[AUTH] Ban detected. Generating new identity...");
            currentName = "Player_" + Math.floor(Math.random() * 999999);
            currentUUID = uuidv4();
        }
    });

    bot.on('error', (err) => {
        console.error(`[ERR] ${err.message}`);
    });

    bot.on('end', () => {
        console.log("[EXIT] Connection closed. Restarting in " + (config.utils["auto-recconect-delay"] / 1000) + "s...");
        botRunning = false;
        bot = null;
        setTimeout(createBot, config.utils["auto-recconect-delay"] || 10000);
    });
}

createBot();
