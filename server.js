const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Constantes de configuration du jeu
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 800;
const TICK_RATE = 30;
const PLAYER_SPEED = 7;
const SHARD_SPAWN_INTERVAL = 5000; // 5 secondes
const MAX_SHARDS = 8;

// État global du jeu (Stocké en mémoire sur le serveur)
let players = {};
let projectiles = [];
let shards = [];
let nextProjectileId = 0;

// Configurations des types de personnages disponibles
const BRAWLER_TYPES = {
    volt: { hp: 3000, maxHp: 3000, radius: 24, attackCooldown: 400, damage: 400, speed: 8, range: 400, bulletSpeed: 16, sprite: 'volt' },
    vortex: { hp: 4500, maxHp: 4500, radius: 28, attackCooldown: 700, damage: 600, speed: 6, range: 200, bulletSpeed: 10, sprite: 'vortex' }
};

// Logique d'apparition des éclats d'Aether
setInterval(() => {
    if (shards.length < MAX_SHARDS) {
        shards.push({
            id: Math.random().toString(36).substr(2, 9),
            x: Math.random() * (MAP_WIDTH - 100) + 50,
            y: Math.random() * (MAP_HEIGHT - 100) + 50,
            radius: 12
        });
        io.emit('shardsUpdate', shards);
    }
}, SHARD_SPAWN_INTERVAL);

io.on('connection', (socket) => {
    console.log(`Joueur connecté : ${socket.id}`);

    // Initialisation par défaut (Volt choisi automatiquement au départ)
    players[socket.id] = {
        id: socket.id,
        x: Math.random() * 200 + 100,
        y: Math.random() * 600 + 100,
        vx: 0,
        vy: 0,
        angle: 0,
        score: 0,
        type: 'volt',
        hp: BRAWLER_TYPES['volt'].hp,
        maxHp: BRAWLER_TYPES['volt'].maxHp,
        radius: BRAWLER_TYPES['volt'].radius,
        lastShot: 0
    };

    // Envoyer les données initiales au joueur
    socket.emit('init', { id: socket.id, map: { width: MAP_WIDTH, height: MAP_HEIGHT }, shards });
    io.emit('playersUpdate', players);

    // Changement de classe par le joueur
    socket.on('changeBrawler', (type) => {
        if (BRAWLER_TYPES[type] && players[socket.id]) {
            players[socket.id].type = type;
            players[socket.id].hp = BRAWLER_TYPES[type].hp;
            players[socket.id].maxHp = BRAWLER_TYPES[type].maxHp;
            players[socket.id].radius = BRAWLER_TYPES[type].radius;
            io.emit('playersUpdate', players);
        }
    });

    // Inputs de déplacement reçus du client
    socket.on('move', (inputData) => {
        const player = players[socket.id];
        if (!player) return;

        let moveX = 0;
        let moveY = 0;

        if (inputData.type === 'keyboard') {
            if (inputData.controls.left) moveX = -1;
            if (inputData.controls.right) moveX = 1;
            if (inputData.controls.up) moveY = -1;
            if (inputData.controls.down) moveY = 1;
        } else if (inputData.type === 'joystick') {
            moveX = inputData.axes.x;
            moveY = inputData.axes.y;
        }

        const brawlerConfig = BRAWLER_TYPES[player.type];
        const speed = brawlerConfig.speed;

        // Normalisation du vecteur pour éviter d'accélérer en diagonale
        const length = Math.sqrt(moveX * moveX + moveY * moveY);
        if (length > 0) {
            player.vx = (moveX / length) * speed;
            player.vy = (moveY / length) * speed;
        } else {
            player.vx = 0;
            player.vy = 0;
        }
        
        if (inputData.angle !== undefined) {
            player.angle = inputData.angle;
        }
    });

    // Input de tir reçu du client
    socket.on('shoot', (targetAngle) => {
        const player = players[socket.id];
        if (!player) return;

        const brawlerConfig = BRAWLER_TYPES[player.type];
        const now = Date.now();

        if (now - player.lastShot >= brawlerConfig.attackCooldown) {
            player.lastShot = now;
            player.angle = targetAngle;

            projectiles.push({
                id: nextProjectileId++,
                ownerId: player.id,
                x: player.x + Math.cos(targetAngle) * player.radius,
                y: player.y + Math.sin(targetAngle) * player.radius,
                vx: Math.cos(targetAngle) * brawlerConfig.bulletSpeed,
                vy: Math.sin(targetAngle) * brawlerConfig.bulletSpeed,
                damage: brawlerConfig.damage,
                radius: 8,
                rangeTraveled: 0,
                maxRange: brawlerConfig.range
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Joueur déconnecté : ${socket.id}`);
        // Si le joueur possédait des éclats, on les fait réapparaître au sol
        if (players[socket.id] && players[socket.id].score > 0) {
            for (let i = 0; i < players[socket.id].score; i++) {
                shards.push({
                    id: Math.random().toString(36).substr(2, 9),
                    x: players[socket.id].x + (Math.random() * 60 - 30),
                    y: players[socket.id].y + (Math.random() * 60 - 30),
                    radius: 12
                });
            }
            io.emit('shardsUpdate', shards);
        }
        delete players[socket.id];
        io.emit('playersUpdate', players);
    });
});

// Boucle principale du serveur (Tick Rate)
setInterval(() => {
    // 1. Mise à jour des positions des joueurs
    for (let id in players) {
        let p = players[id];
        p.x += p.vx;
        p.y += p.vy;

        // Collisions avec les bords de la carte
        if (p.x - p.radius < 0) p.x = p.radius;
        if (p.x + p.radius > MAP_WIDTH) p.x = MAP_WIDTH - p.radius;
        if (p.y - p.radius < 0) p.y = p.radius;
        if (p.y + p.radius > MAP_HEIGHT) p.y = MAP_HEIGHT - p.radius;

        // Collision avec les éclats d'Aether
        for (let i = shards.length - 1; i >= 0; i--) {
            let shard = shards[i];
            let dist = Math.hypot(p.x - shard.x, p.y - shard.y);
            if (dist < p.radius + shard.radius) {
                shards.splice(i, 1);
                p.score += 1;
                io.emit('shardsUpdate', shards);
                io.emit('playersUpdate', players);
                
                // Condition de victoire immédiate à 5 éclats récupérés
                if (p.score >= 5) {
                    io.emit('victory', { winnerId: p.id, type: p.type });
                    resetGame();
                    return;
                }
            }
        }
    }

    // 2. Mise à jour des projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let proj = projectiles[i];
        proj.x += proj.vx;
        proj.y += proj.vy;
        
        let distStep = Math.hypot(proj.vx, proj.vy);
        proj.rangeTraveled += distStep;

        let hit = false;

        // Collision avec les joueurs adverses
        for (let id in players) {
            let target = players[id];
            if (target.id !== proj.ownerId) {
                let dist = Math.hypot(proj.x - target.x, proj.y - target.y);
                if (dist < proj.radius + target.radius) {
                    target.hp -= proj.damage;
                    hit = true;

                    if (target.hp <= 0) {
                        // Le joueur éliminé lâche ses cristaux au sol
                        if (target.score > 0) {
                            for (let j = 0; j < target.score; j++) {
                                shards.push({
                                    id: Math.random().toString(36).substr(2, 9),
                                    x: target.x + (Math.random() * 80 - 40),
                                    y: target.y + (Math.random() * 80 - 40),
                                    radius: 12
                                });
                            }
                            io.emit('shardsUpdate', shards);
                        }
                        // Respawn automatique du joueur éliminé
                        target.hp = BRAWLER_TYPES[target.type].maxHp;
                        target.score = 0;
                        target.x = Math.random() * 200 + 100;
                        target.y = Math.random() * 600 + 100;
                    }
                    break;
                }
            }
        }

        // Suppression si hors de portée ou si collision validée
        if (hit || proj.rangeTraveled >= proj.maxRange || proj.x < 0 || proj.x > MAP_WIDTH || proj.y < 0 || proj.y > MAP_HEIGHT) {
            projectiles.splice(i, 1);
        }
    }

    // Envoi de l'état global synchronisé à l'ensemble des clients connectés
    io.emit('gameState', { players, projectiles });
}, 1000 / TICK_RATE);

function resetGame() {
    shards = [];
    projectiles = [];
    for (let id in players) {
        let p = players[id];
        p.score = 0;
        p.hp = BRAWLER_TYPES[p.type].hp;
        p.x = Math.random() * 200 + 100;
        p.y = Math.random() * 600 + 100;
    }
    io.emit('shardsUpdate', shards);
    io.emit('playersUpdate', players);
}

server.listen(PORT, () => {
    console.log(`Serveur de jeu actif sur le port : ${PORT}`);
});
