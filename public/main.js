const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Variables globales de gestion du client
let myId = null;
let mapInfo = { width: 1200, height: 800 };
let localPlayers = {};
let localProjectiles = [];
let localShards = [];

// Configuration des inputs claviers PC
const keys = { up: false, down: false, left: false, right: false };
let mouseAngle = 0;

// Variables pour le Joystick virtuel Mobile
let isMobile = false;
let joystickActive = false;
let joystickStartPos = { x: 0, y: 0 };
let joystickCurrentPos = { x: 0, y: 0 };
let joystickVector = { x: 0, y: 0 };

// Chargement des images réelles depuis le web pour une immersion visuelle immédiate
const textures = {
    floor: new Image(),
    volt: new Image(),
    vortex: new Image(),
    shard: new Image()
};
textures.floor.src = 'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=600&auto=format&fit=crop&q=40'; // Texture d'arène technologique
textures.volt.src = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=100&auto=format&fit=crop&q=40'; // Avatar d'Énergie Bleu
textures.vortex.src = 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=100&auto=format&fit=crop&q=40'; // Avatar Cosmique Sombre
textures.shard.src = 'https://images.unsplash.com/photo-1551269901-5c5e14c25df7?w=50&auto=format&fit=crop&q=40'; // Cristal d'Émeraude Lumineux

// Initialisation de la taille du canvas de manière adaptative
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Détecter si l'appareil supporte le tactile
if ('造型' in window || navigator.maxTouchPoints > 0) {
    isMobile = true;
}

// --- ÉCOUTEURS DE FLUX DU SERVEUR (SOCKET) ---
socket.on('init', (data) => {
    myId = data.id;
    mapInfo = data.map;
    localShards = data.shards;
});

socket.on('shardsUpdate', (serverShards) => {
    localShards = serverShards;
});

socket.on('playersUpdate', (serverPlayers) => {
    localPlayers = serverPlayers;
    updateScoreboard();
});

socket.on('gameState', (state) => {
    localPlayers = state.players;
    localProjectiles = state.projectiles;
    updateScoreboard();
});

socket.on('victory', (data) => {
    alert(`FIN DE LA PARTIE ! Le joueur ayant le brawler [${data.type.toUpperCase()}] a collecté tous les éclats de l'Aether et triomphé !`);
});

function selectBrawler(type) {
    document.getElementById('btn-volt').classList.remove('selected');
    document.getElementById('btn-vortex').classList.remove('selected');
    document.getElementById(`btn-${type}`).classList.add('selected');
    socket.emit('changeBrawler', type);
}

function updateScoreboard() {
    let board = document.getElementById('scoreboard');
    if (!board) return;
    
    let text = "Statut de la partie : <br>";
    for (let id in localPlayers) {
        let p = localPlayers[id];
        let tag = p.id === myId ? " (Vous)" : " (Adversaire)";
        text += `Brawler ${p.type.toUpperCase()}${tag} : ${p.score} Éclat(s) [HP: ${p.hp}/${p.maxHp}]<br>`;
    }
    board.innerHTML = text;
}

// --- CONTRÔLES PC (CLAVIER / SOURIS) ---
window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'KeyW', 'Z', 'z'].includes(e.key)) keys.up = true;
    if (['ArrowDown', 'KeyS', 'S', 's'].includes(e.key)) keys.down = true;
    if (['ArrowLeft', 'KeyA', 'Q', 'q'].includes(e.key)) keys.left = true;
    if (['ArrowRight', 'KeyD', 'D', 'd'].includes(e.key)) keys.right = true;
    sendKeyboardInput();
});

window.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'KeyW', 'Z', 'z'].includes(e.key)) keys.up = false;
    if (['ArrowDown', 'KeyS', 'S', 's'].includes(e.key)) keys.down = false;
    if (['ArrowLeft', 'KeyA', 'Q', 'q'].includes(e.key)) keys.left = false;
    if (['ArrowRight', 'KeyD', 'D', 'd'].includes(e.key)) keys.right = false;
    sendKeyboardInput();
});

function sendKeyboardInput() {
    if (isMobile) return;
    socket.emit('move', {
        type: 'keyboard',
        controls: { up: keys.up, down: keys.down, left: keys.left, right: keys.right },
        angle: mouseAngle
    });
}

window.addEventListener('mousemove', (e) => {
    if (isMobile || !myId || !localPlayers[myId]) return;
    const me = localPlayers[myId];
    
    // Calcul de l'angle entre le joueur et la souris basé sur le repère de la caméra écran
    const screenCenterX = canvas.width / 2;
    const screenCenterY = canvas.height / 2;
    
    mouseAngle = Math.atan2(e.clientY - screenCenterY, e.clientX - screenCenterX);
    sendKeyboardInput();
});

window.addEventListener('click', () => {
    if (isMobile || !myId || !localPlayers[myId]) return;
    socket.emit('shoot', mouseAngle);
});

// --- CONTRÔLES MOBILES (TOUCHES TACTILES) ---
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');
const btnShoot = document.getElementById('btn-shoot');

joystickZone.addEventListener('touchstart', (e) => {
    joystickActive = true;
    const touch = e.touches[0];
    const rect = joystickZone.getBoundingClientRect();
    joystickStartPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});

joystickZone.addEventListener('touchmove', (e) => {
    if (!joystickActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    
    let dx = touch.clientX - joystickStartPos.x;
    let dy = touch.clientY - joystickStartPos.y;
    let dist = Math.hypot(dx, dy);
    const maxRadius = 50;

    if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
        dist = maxRadius;
    }

    joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
    
    // Normalisation des axes entre -1 et 1
    joystickVector = { x: dx / maxRadius, y: dy / maxRadius };
    let angle = Math.atan2(dy, dx);

    socket.emit('move', {
        type: 'joystick',
        axes: joystickVector,
        angle: angle
    });
});

joystickZone.addEventListener('touchend', () => {
    joystickActive = false;
    joystickStick.style.transform = 'translate(0px, 0px)';
    joystickVector = { x: 0, y: 0 };
    socket.emit('move', { type: 'joystick', axes: joystickVector });
});

btnShoot.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!myId || !localPlayers[myId]) return;
    // Tir dans la direction courante face au personnage
    socket.emit('shoot', localPlayers[myId].angle);
});


// --- BOUCLE DE RENDU GRAPHIQUE (CLIENT-SIDE RENDER) ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!myId || !localPlayers[myId]) {
        ctx.fillStyle = "white";
        ctx.font = "20px Arial";
        ctx.fillText("En attente de synchronisation arène...", 50, 50);
        requestAnimationFrame(render);
        return;
    }

    const me = localPlayers[myId];

    // Calcul du décalage caméra pour centrer le point de vue sur notre personnage (Caméra Suiveuse)
    const offsetX = canvas.width / 2 - me.x;
    const offsetY = canvas.height / 2 - me.y;

    // 1. Dessin du sol texturé
    if (textures.floor.complete) {
        ctx.fillStyle = ctx.createPattern(textures.floor, 'repeat');
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.fillRect(0, 0, mapInfo.width, mapInfo.height);
        ctx.restore();
    } else {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(offsetX, offsetY, mapInfo.width, mapInfo.height);
    }

    // Bordures de la carte
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 6;
    ctx.strokeRect(offsetX, offsetY, mapInfo.width, mapInfo.height);

    // 2. Dessin des éclats de cristal d'Aether
    for (let shard of localShards) {
        ctx.save();
        ctx.translate(shard.x + offsetX, shard.y + offsetY);
        if (textures.shard.complete) {
            ctx.drawImage(textures.shard, -shard.radius, -shard.radius, shard.radius * 2, shard.radius * 2);
        } else {
            ctx.fillStyle = "#10b981";
            ctx.beginPath();
            ctx.arc(0, 0, shard.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        // Effet de halo lumineux autour du cristal
        ctx.strokeStyle = "rgba(16, 185, 129, 0.6)";
        ctx.lineWidth = 3;
        ctx.strokeRect(-shard.radius - 2, -shard.radius - 2, (shard.radius + 2) * 2, (shard.radius + 2) * 2);
        ctx.restore();
    }

    // 3. Dessin des Projectiles
    for (let proj of localProjectiles) {
        ctx.fillStyle = "#f59e0b";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#f59e0b";
        ctx.beginPath();
        ctx.arc(proj.x + offsetX, proj.y + offsetY, proj.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0; // Reset ombre de performance
    }

    // 4. Dessin des Joueurs (Brawlers)
    for (let id in localPlayers) {
        let p = localPlayers[id];

        ctx.save();
        ctx.translate(p.x + offsetX, p.y + offsetY);

        // Indicateur d'orientation directionnelle
        ctx.rotate(p.angle);
        ctx.strokeStyle = p.id === myId ? "#38bdf8" : "#f43f5e";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(p.radius + 15, 0);
        ctx.stroke();
        ctx.rotate(-p.angle); // Reset rotation pour affichage droit du sprite

        // Corps du Brawler (Image circulaire masquée)
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.clip();

        let img = p.type === 'volt' ? textures.volt : textures.vortex;
        if (img.complete) {
            ctx.drawImage(img, -p.radius, -p.radius, p.radius * 2, p.radius * 2);
        } else {
            ctx.fillStyle = p.id === myId ? "#3b82f6" : "#ef4444";
            ctx.fill();
        }
        ctx.restore();

        // Éléments d'interface utilisateur du personnage (Barre de vie au-dessus)
        ctx.save();
        ctx.translate(p.x + offsetX, p.y + offsetY);
        
        // Conteneur jauge de vie
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-30, -p.radius - 20, 60, 8);
        
        // Remplissage dynamique des HP
        let hpRatio = Math.max(0, p.hp / p.maxHp);
        ctx.fillStyle = p.id === myId ? "#10b981" : "#ef4444";
        ctx.fillRect(-30, -p.radius - 20, 60 * hpRatio, 8);

        // Affichage du compteur d'éclats possédés par ce Brawler
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`💎 ${p.score}`, 0, -p.radius - 28);
        ctx.restore();
    }

    requestAnimationFrame(render);
}

// Lancement immédiat du moteur graphique
requestAnimationFrame(render);
