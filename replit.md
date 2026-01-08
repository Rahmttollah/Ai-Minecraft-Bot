# Minecraft AFK Bot

## Overview

This is a Minecraft AFK (Away From Keyboard) bot built with Node.js using the Mineflayer library. The bot connects to a specified Minecraft server in offline mode and maintains an active presence. It includes features for automatic reconnection, pathfinding capabilities, and a simple web server to keep the process alive on hosting platforms like Render.

The bot generates random player identities (username and UUID) for connecting to offline-mode Minecraft servers, with the ability to regenerate identities when banned.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Application Structure

**Single-file Architecture**: The entire bot logic resides in `index.js`. This is a simple, single-purpose application that doesn't require complex module separation.

**Bot Instance Management**: 
- Uses a singleton pattern with `bot` and `botRunning` flags to prevent multiple bot instances from running simultaneously
- Identity management through `currentName` and `currentUUID` variables that persist across reconnections but can be regenerated on ban

**Configuration-driven Design**:
- Server connection details and bot settings are externalized to `settings.json`
- Supports configurable auto-reconnect, position holding, and auto-authentication features

### Web Server Component

A minimal Express.js server runs on port 8000 with a single health-check endpoint (`/`). This exists solely to keep the process alive on platforms that require an active HTTP listener (like Render, Railway, or similar hosting services).

### Bot Capabilities

The bot integrates several Mineflayer plugins:
- **mineflayer-pathfinder**: Navigation and movement automation with goal-based pathfinding
- **mineflayer-pvp**: Combat capabilities (available but implementation details are in truncated code)
- **minecraft-data**: Version-specific Minecraft data for compatibility

### Data Persistence

**scores.json**: Stores player statistics including wins, losses, scores, ranks, and levels. This suggests the bot may participate in or track some form of competitive gameplay.

**launcher_accounts.json**: Empty accounts array, likely prepared for future multi-account support.

## External Dependencies

### NPM Packages

| Package | Purpose |
|---------|---------|
| mineflayer | Core Minecraft bot framework - handles protocol, connection, and game state |
| mineflayer-pathfinder | A* pathfinding and movement automation |
| mineflayer-pvp | Combat and PvP automation |
| minecraft-data | Minecraft version-specific block, item, and entity data |
| express | Web server for keep-alive functionality |
| uuid | UUID v4 generation for player identity |

### External Services

**Minecraft Server**: Connects to an Aternos-hosted Minecraft server (RNR-SMP.aternos.me:29622) running version 1.20.1 in offline mode.

**Hosting Platform**: Designed for deployment on platforms like Render that require an HTTP endpoint to keep processes alive.

### Configuration Files

- **settings.json**: Primary configuration for server connection, bot credentials, position settings, and utility options
- **scores.json**: Runtime data storage for player statistics (read/write during operation)