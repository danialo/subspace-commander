const assert = require('assert');

class BombDamageTester {
    constructor() {
        this.playerShip = {
            pos: { x: 0, y: 0 },
            energy: 1100,
            maxEnergy: 1100,
            deaths: 0,
            shieldActive: false,
            shieldTimer: 0,
            die() {
                this.deaths += 1;
                this.energy = this.maxEnergy;
                this.shieldActive = false;
                this.shieldTimer = 0;
            },
            activateShield(duration = 10) {
                this.shieldActive = true;
                this.shieldTimer = duration;
            },
            isShieldActive() {
                return this.shieldActive && this.shieldTimer > 0;
            }
        };
        this.viewport = {
            worldWidth: 8000,
            worldHeight: 6000
        };
        this.otherPlayers = new Map();
        this.sentMessages = [];
        this.lastDamageSource = null;
        this.deathLog = [];
        this.safeZone = null;
    }

    sendMultiplayerMessage(data) {
        this.sentMessages.push(data);
    }

    applyDamageToPlayerShip(damage, source = null) {
        if (!damage) {
            return;
        }

        if (source && source.attackerId) {
            this.lastDamageSource = {
                attackerId: source.attackerId,
                weapon: source.weapon || 'unknown'
            };
        }

        if (this.isInSafeZone(this.playerShip.pos.x, this.playerShip.pos.y)) {
            return;
        }

        if (this.playerShip.isShieldActive()) {
            return;
        }

        let remainingDamage = damage;
        this.playerShip.energy = Math.max(0, this.playerShip.energy - remainingDamage);

        if (this.playerShip.energy <= 0) {
            this.handlePlayerDeath(this.lastDamageSource);
            this.playerShip.die();
            this.lastDamageSource = null;
        }
    }

    handlePlayerDeath(killerInfo) {
        this.deathLog.push(killerInfo || null);
    }

    isInSafeZone() {
        return false;
    }

    // Copy of damagePlayersInRadius from subspace.html (lines 1883-1913)
    damagePlayersInRadius(x, y, radius, bombType, ownerId = null) {
        const localDx = this.playerShip.pos.x - x;
        const localDy = this.playerShip.pos.y - y;
        const localDistance = Math.sqrt(localDx * localDx + localDy * localDy);

        if (localDistance < radius) {
            const damageMult = 1 - (localDistance / radius);
            let baseDamage = bombType === 'yellow' ? 400 : 200;
            const finalDamage = Math.floor(baseDamage * damageMult);

            this.applyDamageToPlayerShip(finalDamage, {
                attackerId: ownerId,
                weapon: 'bomb'
            });
        }

        for (const [playerId, otherPlayer] of this.otherPlayers) {
            const dx = otherPlayer.pos.x - x;
            const dy = otherPlayer.pos.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < radius) {
                const damageMult = 1 - (distance / radius);
                let baseDamage = bombType === 'yellow' ? 400 : 200;
                const finalDamage = Math.floor(baseDamage * damageMult);

                this.sendMultiplayerMessage({
                    type: 'bombDamage',
                    targetId: playerId,
                    damage: finalDamage,
                    attackerId: ownerId
                });
            }
        }
    }
}

function runScenario(label, localDistance, opponentDistance, bombType = 'red', shieldDuration = 0) {
    const tester = new BombDamageTester();
    tester.playerShip.pos = { x: localDistance, y: 0 };
    tester.playerShip.energy = tester.playerShip.maxEnergy;
    if (shieldDuration > 0) {
        tester.playerShip.activateShield(shieldDuration);
    }
    tester.otherPlayers.set('opponent', { pos: { x: opponentDistance, y: 0 } });

    tester.damagePlayersInRadius(0, 0, 120, bombType, 'self');

    const localEnergyLost = tester.playerShip.maxEnergy - tester.playerShip.energy;
    const opponentMsg = tester.sentMessages.find(msg => msg.targetId === 'opponent');
    const opponentDamage = opponentMsg ? opponentMsg.damage : 0;

    console.log(`${label}: localDistance=${localDistance}, opponentDistance=${opponentDistance}`);
    console.log(`  -> Local energy lost: ${localEnergyLost}`);
    console.log(`  -> Shield active: ${tester.playerShip.isShieldActive()} (${tester.playerShip.shieldTimer.toFixed(1)}s left)`);
    console.log(`  -> Local deaths: ${tester.playerShip.deaths}`);
    console.log(`  -> Opponent damage: ${opponentDamage}\n`);

    return { localEnergyLost, opponentDamage };
}

runScenario('Close pass', 60, 0);
runScenario('Both nearby', 60, 40);
runScenario('Local safe distance', 140, 40);
runScenario('Yellow bomb vs opponent center', 40, 0, 'yellow');
runScenario('Shielded self-hit', 40, 0, 'red', 10);
