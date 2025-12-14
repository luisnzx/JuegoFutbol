// ========== FOOTBALL GAME - RED ==========

let scene, camera, renderer, raycaster, ground;
let goalNetMesh;
let scoreCount = 0;

function triggerLooseBallChase() {
    if (!ball) return;
    ball.userData.looseChaseActive = true;
    ball.userData.lastChaseUpdate = 0;
    const allies = getTeamPlayers(true);
    const enemies = getTeamPlayers(false);
    // Find nearest ally and enemy to current ball position
    let nearestAlly = null, nearestEnemy = null;
    let allyDist = Infinity, enemyDist = Infinity;
    for (const a of allies) {
        const d = a.mesh.position.distanceTo(ball.position);
        if (d < allyDist) { allyDist = d; nearestAlly = a; }
    }
    for (const e of enemies) {
        const d = e.mesh.position.distanceTo(ball.position);
        if (d < enemyDist) { enemyDist = d; nearestEnemy = e; }
    }
    // Send both to the ball; slightly faster if closer
    if (nearestAlly) setPlayerTarget(nearestAlly, ball.position.clone(), Math.max(6, 10 - allyDist * 0.2));
    if (nearestEnemy) setPlayerTarget(nearestEnemy, ball.position.clone(), Math.max(6, 10 - enemyDist * 0.2));
}
let players = [], ball, activePlayer = null;
let selectedPlayer = null; // Para táctica - seleccionar jugador
let tacticPositions = {}; // Mapea playerID -> posición táctica deseada
let drawPoints = [], drawLine = null, isDrawing = false;
let curve = null, curveStartTime = 0, curveDuration = 0;
let ballTrail = []; // For ball movement trail
let particles = []; // For pass effects
let trailMesh = null; // For fire trail effect
const fieldBounds = { minX: -60, maxX: 60, minZ: -75, maxZ: 75 };
const goalArea = { z: 57, minX: -7, maxX: 7 };
const GameState = { PAUSED: 'PAUSED', PLAYING: 'PLAYING', GAME_OVER: 'GAME_OVER' };
let gameState = GameState.PAUSED;
let firstPassMade = false;

let container, messageEl, stateEl, resetBtn, cameraBtn;
let cameraMode = 'follow'; // 'follow' or 'fifa'

window.startGame = async function() {
    console.log('startGame called');
    try {
        await init();
        animate();
        console.log('Game initialized and running');
    } catch (err) {
        console.error('Game init error:', err);
        throw err;
    }
};

async function init() {
    if (!window.THREE) {
        throw new Error('Three.js not loaded');
    }
    
    container = document.getElementById('container');
    messageEl = document.getElementById('message');
    stateEl = document.getElementById('state');
    resetBtn = document.getElementById('resetBtn');
    cameraBtn = document.getElementById('cameraBtn');
    
    if (!container || !messageEl || !stateEl || !resetBtn || !cameraBtn) {
        throw new Error('DOM elements not found');
    }
    
    const w = container.clientWidth;
    const h = container.clientHeight;
    
    renderer = new window.THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
    
    // ===== TONE MAPPING CINEMATOGRÁFICO =====
    renderer.toneMapping = window.THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.outputColorSpace = window.THREE.SRGBColorSpace;
    
    container.appendChild(renderer.domElement);
    
    scene = new window.THREE.Scene();
    scene.background = new window.THREE.Color(0x87CEEB);
    
    camera = new window.THREE.PerspectiveCamera(75, w / h, 0.1, 300);
    camera.position.set(0, 30, -60);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix(); // Update projection matrix after camera setup
    
    raycaster = new window.THREE.Raycaster();
    
    // ===== ILUMINACIÓN CORREGIDA (ESTILO FIFA DÍA) =====
    
    // 1. Luz Hemisférica (Mejor para exteriores)
    // Simula la luz del cielo (azulada arriba) y del suelo (verdosa abajo)
    const hemiLight = new window.THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);
    
    // 2. Luz Principal (El SOL)
    // Intensidad aumentada para compensar sin el SpotLight
    const directional = new window.THREE.DirectionalLight(0xffffff, 3.0);
    directional.position.set(-30, 50, 25);
    directional.castShadow = true;
    
    // Configuración de sombras optimizadas (2K para mejor FPS)
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.bias = -0.0001;
    directional.shadow.normalBias = 0.01;
    
    // Cámara de sombra ajustada para cubrir todo el campo
    const d = 60;
    directional.shadow.camera.left = -d;
    directional.shadow.camera.right = d;
    directional.shadow.camera.top = d;
    directional.shadow.camera.bottom = -d;
    directional.shadow.camera.near = 0.5;
    directional.shadow.camera.far = 150;
    
    scene.add(directional);
    
    // 3. Rim Light (Luz de Relleno)
    // Una luz suave desde atrás para perfilar a los jugadores
    const fillLight = new window.THREE.DirectionalLight(0x90c0ff, 0.8);
    fillLight.position.set(20, 20, -20);
    scene.add(fillLight);
    
    // Outer terrain/ground (large area around stadium)
    const outerGroundGeo = new window.THREE.PlaneGeometry(300, 300);
    const outerGroundMat = new window.THREE.MeshStandardMaterial({ 
        color: 0x1a3d1a, 
        roughness: 0.95,
        metalness: 0.05
    });
    const outerGround = new window.THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.y = -0.5;
    outerGround.receiveShadow = true;
    scene.add(outerGround);
    
    // Playing field (grass with stripes)
    const groundGeo = new window.THREE.PlaneGeometry(90, 120);
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 512;
    grassCanvas.height = 512;
    const gctx = grassCanvas.getContext('2d');
    gctx.fillStyle = '#2b6b2b';
    gctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) {
        gctx.fillStyle = i % 2 === 0 ? '#2f6f2f' : '#28622a';
        gctx.fillRect(0, i * 64, 512, 64);
    }
    const grassTex = new window.THREE.CanvasTexture(grassCanvas);
    grassTex.wrapS = grassTex.wrapT = window.THREE.RepeatWrapping;
    grassTex.repeat.set(1, 1);
    const groundMat = new window.THREE.MeshStandardMaterial({ 
        map: grassTex, 
        roughness: 1.0,
        metalness: 0.0,
        color: 0x77aa77
    });
    ground = new window.THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    
    // ===== GOAL POSTS AND NET (COMPLETE REBUILD) =====
    // Goal posts (vertical)
    const postMat = new window.THREE.MeshStandardMaterial({ color: 0xffffff });
    const postGeo = new window.THREE.CylinderGeometry(0.35, 0.35, 6);
    const postLeft = new window.THREE.Mesh(postGeo, postMat);
    postLeft.position.set(-7, 3, 57);
    postLeft.castShadow = true;
    postLeft.receiveShadow = true;
    scene.add(postLeft);
    
    const postRight = new window.THREE.Mesh(postGeo, postMat);
    postRight.position.set(7, 3, 57);
    postRight.castShadow = true;
    postRight.receiveShadow = true;
    scene.add(postRight);
    
    // Crossbar (horizontal, top)
    const crossbarGeo = new window.THREE.CylinderGeometry(0.3, 0.3, 14);
    const crossbar = new window.THREE.Mesh(crossbarGeo, postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, 6, 57);
    crossbar.castShadow = true;
    crossbar.receiveShadow = true;
    scene.add(crossbar);
    
    // ===== 3D NET BOX (Back + Roof + Sides + Bottom) =====
    const netGroup = new window.THREE.Group();
    const netMat = new window.THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        wireframe: true,
        side: window.THREE.DoubleSide
    });
    
    // Net dimensions: width 14 (between posts), height 6, depth 3.5 (into goal)
    const netWidth = 14;
    const netHeight = 6;
    const netDepth = 3.5;
    
    // Back panel (facing away from field)
    const netBackGeo = new window.THREE.PlaneGeometry(netWidth, netHeight, 20, 20);
    const netBack = new window.THREE.Mesh(netBackGeo, netMat.clone());
    netBack.position.set(0, 3, 57 + netDepth);
    
    // Top/roof panel (from crossbar back)
    const netRoofGeo = new window.THREE.PlaneGeometry(netWidth, netDepth, 20, 10);
    const netRoof = new window.THREE.Mesh(netRoofGeo, netMat.clone());
    netRoof.position.set(0, 6, 57 + netDepth / 2);
    netRoof.rotation.x = -Math.PI / 2;
    
    // Left side panel
    const netLeftGeo = new window.THREE.PlaneGeometry(netDepth, netHeight, 10, 20);
    const netLeft = new window.THREE.Mesh(netLeftGeo, netMat.clone());
    netLeft.position.set(-7, 3, 57 + netDepth / 2);
    netLeft.rotation.y = Math.PI / 2;
    
    // Right side panel
    const netRightGeo = new window.THREE.PlaneGeometry(netDepth, netHeight, 10, 20);
    const netRight = new window.THREE.Mesh(netRightGeo, netMat.clone());
    netRight.position.set(7, 3, 57 + netDepth / 2);
    netRight.rotation.y = -Math.PI / 2;
    
    // Bottom panel - REMOVED (no net on floor)
    const netBottom = null;
    
    netGroup.add(netBack);
    netGroup.add(netRoof);
    netGroup.add(netLeft);
    netGroup.add(netRight);
    scene.add(netGroup);
    goalNetMesh = netGroup;
    goalNetMesh.userData.netBack = netBack;
    goalNetMesh.userData.netRoof = netRoof;
    goalNetMesh.userData.netLeft = netLeft;
    goalNetMesh.userData.netRight = netRight;
    goalNetMesh.userData.netBottom = netBottom;
    goalNetMesh.userData.netDepth = netDepth;
    
    // Store original positions for spring physics (all panels deformable)
    const backPos = netBack.geometry.attributes.position;
    const roofPos = netRoof.geometry.attributes.position;
    const leftPos = netLeft.geometry.attributes.position;
    const rightPos = netRight.geometry.attributes.position;
    
    goalNetMesh.userData.netState = {
        // Back panel
        backOrig: backPos.array.slice(),
        backVel: new Float32Array(backPos.count * 3),
        // Roof panel
        roofOrig: roofPos.array.slice(),
        roofVel: new Float32Array(roofPos.count * 3),
        // Left panel
        leftOrig: leftPos.array.slice(),
        leftVel: new Float32Array(leftPos.count * 3),
        // Right panel
        rightOrig: rightPos.array.slice(),
        rightVel: new Float32Array(rightPos.count * 3)
    };
    
    // Stadium with 3D stands and spectators
    const stadiumGroup = new window.THREE.Group();
    
    // Create bleachers/stands
    const standMat = new window.THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.2, roughness: 0.9 });
    const spectatorColors = [0xff4444, 0x4444ff, 0xffff44, 0x44ff44, 0xff44ff];
    
    // Function to create a simple spectator
    function createSpectator(pos, colorIdx) {
        const group = new window.THREE.Group();
        const torsoGeo = new window.THREE.CylinderGeometry(0.15, 0.15, 0.4);
        const torsoMat = new window.THREE.MeshStandardMaterial({ color: spectatorColors[colorIdx % spectatorColors.length] });
        const torso = new window.THREE.Mesh(torsoGeo, torsoMat);
        torso.position.y = 0.2;
        group.add(torso);
        
        const headGeo = new window.THREE.SphereGeometry(0.12, 8, 8);
        const headMat = new window.THREE.MeshStandardMaterial({ color: 0xffdbac });
        const head = new window.THREE.Mesh(headGeo, headMat);
        head.position.y = 0.45;
        group.add(head);
        
        group.position.copy(pos);
        return group;
    }
    
    
    // Back stands (behind goals) - STAIRS GO UP AWAY FROM FIELD
    for (let row = 0; row < 6; row++) {
        const standGeo = new window.THREE.BoxGeometry(70, 2.2, 6);
        const stand = new window.THREE.Mesh(standGeo, standMat);
        const standZ = -80 - row * 1.5; // Moved further back
        stand.position.set(0, 1.1 + row * 2.8, standZ);
        stand.castShadow = true;
        stand.receiveShadow = true;
        stadiumGroup.add(stand);
        
        // Add spectators
        for (let spec = 0; spec < 20; spec++) {
            const specX = -30 + spec * 3;
            const specZ = standZ;
            const specY = 2.5 + row * 2.8;
            const spectator = createSpectator(new window.THREE.Vector3(specX, specY, specZ), row + spec);
            stadiumGroup.add(spectator);
        }
    }
    
    // Goal-end stands (opposite end) - STAIRS GO UP AWAY FROM FIELD
    for (let row = 0; row < 6; row++) {
        const standGeo = new window.THREE.BoxGeometry(70, 2.2, 6);
        const stand = new window.THREE.Mesh(standGeo, standMat);
        const standZ = 83 + row * 1.5; // Moved further forward
        stand.position.set(0, 1.1 + row * 2.8, standZ);
        stand.castShadow = true;
        stand.receiveShadow = true;
        stadiumGroup.add(stand);
        
        // Add spectators
        for (let spec = 0; spec < 20; spec++) {
            const specX = -30 + spec * 3;
            const specZ = standZ;
            const specY = 2.5 + row * 2.8;
            const spectator = createSpectator(new window.THREE.Vector3(specX, specY, specZ), row + spec);
            stadiumGroup.add(spectator);
        }
    }
    
    // Side stands - copy of back stands but rotated and positioned at sides
    for (const side of [-1, 1]) {
        for (let row = 0; row < 6; row++) {
            const standGeo = new window.THREE.BoxGeometry(70, 2.2, 6);
            const stand = new window.THREE.Mesh(standGeo, standMat);
            const standX = side * (55 + row * 1.5); // Closer to field, away from center
            stand.position.set(standX, 1.1 + row * 2.8, 0);
            stand.rotation.y = Math.PI / 2; // Rotate 90 degrees to face field
            stand.castShadow = true;
            stand.receiveShadow = true;
            stadiumGroup.add(stand);
            
            // Add spectators
            for (let spec = 0; spec < 20; spec++) {
                const specZ = -30 + spec * 3;
                const specX = standX;
                const specY = 2.5 + row * 2.8;
                const spectator = createSpectator(new window.THREE.Vector3(specX, specY, specZ), row + spec);
                stadiumGroup.add(spectator);
            }
        }
    }
    

    // Banner with text "CREATED BY LUISNZX"
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 2048;
    bannerCanvas.height = 256;
    const bannerCtx = bannerCanvas.getContext('2d');
    bannerCtx.fillStyle = '#ff0000';
    bannerCtx.fillRect(0, 0, 2048, 256);
    bannerCtx.fillStyle = '#ffffff';
    bannerCtx.font = 'bold 120px Arial';
    bannerCtx.textAlign = 'center';
    bannerCtx.fillText('CREATED BY LUISNZX', 1024, 160);
    
    const bannerTexture = new window.THREE.CanvasTexture(bannerCanvas);
    const bannerGeo = new window.THREE.PlaneGeometry(40, 4);
    const bannerMat = new window.THREE.MeshStandardMaterial({ 
        map: bannerTexture, 
        side: window.THREE.DoubleSide,
        emissive: 0x330000,
        emissiveIntensity: 0.3
    });
    const banner = new window.THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 6, 75);
    banner.rotation.y = Math.PI;
    scene.add(banner); // Add directly to scene, not stadiumGroup
    
    scene.add(stadiumGroup);
    
    // Initialize game
    createInitialActors();
    
    // Input handlers
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onWindowResize);
    
    resetBtn.addEventListener('click', resetGame);
    cameraBtn.addEventListener('click', toggleCameraMode);
    
    setState(GameState.PAUSED);
}

function toggleCameraMode() {
    cameraMode = cameraMode === 'follow' ? 'fifa' : 'follow';
    const modeName = cameraMode === 'fifa' ? 'Vista FIFA' : 'Vista Seguimiento';
    setMessage(modeName, 1000);
}

function createInitialActors() {
    players = [];
    
    // Create ball first
    createBall();
    
    // Ally team (blue)
    for (let i = 0; i < 5; i++) {
        const x = -22 + i * 11;
        players.push(createPlayer(new window.THREE.Vector3(x, 0, -30), 0x0066ff, true));
    }
    const allyKeeper = createPlayer(new window.THREE.Vector3(0, 0, -57), 0x0066ff, true, true);
    allyKeeper.isGoalkeeper = true;
    players.push(allyKeeper);
    
    // Enemy team (red) - add one more defender
    for (let i = 0; i < 5; i++) {
        const x = -24 + i * 12;
        players.push(createPlayer(new window.THREE.Vector3(x, 0, 15), 0xff0000, false, false));
    }
    const enemyKeeper = createPlayer(new window.THREE.Vector3(0, 0, 57), 0xff0000, false, true);
    enemyKeeper.isGoalkeeper = true;
    players.push(enemyKeeper);
    
    activePlayer = players[0];
    giveBallTo(activePlayer);
}

// Generate procedural skin texture
function createSkinTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Base skin tone
    ctx.fillStyle = '#ffd9b3';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add subtle pore texture
    ctx.fillStyle = 'rgba(200, 160, 120, 0.15)';
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const size = Math.random() * 1.5;
        ctx.fillRect(x, y, size, size);
    }
    
    // Subtle freckles/imperfections
    ctx.fillStyle = 'rgba(180, 140, 100, 0.08)';
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        ctx.beginPath();
        ctx.arc(x, y, Math.random() * 0.8 + 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const texture = new window.THREE.CanvasTexture(canvas);
    texture.magFilter = window.THREE.LinearFilter;
    texture.minFilter = window.THREE.LinearMipmapLinearFilter;
    return texture;
}

// Generate procedural cloth texture
function createClothTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Convert hex color to RGB
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, 512, 512);
    
    // Fabric weave texture
    ctx.strokeStyle = `rgba(${Math.max(0, r-30)}, ${Math.max(0, g-30)}, ${Math.max(0, b-30)}, 0.1)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
    }
    
    // Random fiber highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const len = Math.random() * 20;
        const angle = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
    }
    
    const texture = new window.THREE.CanvasTexture(canvas);
    texture.magFilter = window.THREE.LinearFilter;
    texture.minFilter = window.THREE.LinearMipmapLinearFilter;
    return texture;
}

// Generate normal map for enhanced detail
function createNormalMap() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Fill with neutral normal (0.5, 0.5, 1.0 = no normal perturbation)
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, 256, 256);
    
    // Add subtle bumps
    ctx.fillStyle = '#7a7aff';
    for (let i = 0; i < 1000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 2 + 1;
        ctx.fillRect(x, y, size, size);
    }
    
    const texture = new window.THREE.CanvasTexture(canvas);
    texture.magFilter = window.THREE.LinearFilter;
    texture.minFilter = window.THREE.LinearMipmapLinearFilter;
    return texture;
}

function createPlayer(pos, color, isAlly, isGoalkeeper = false) {
    const group = new window.THREE.Group();
    const scale = 1.0;
    const h = 4.0 * scale;
    
    // ===== MATERIALES ATLÉTICOS DIFERENCIADOS =====
    const skinMat = new window.THREE.MeshStandardMaterial({
        color: 0xffdcb1,
        roughness: 0.5,  // Piel más suave
        metalness: 0.0,
        emissive: 0x553333,
        emissiveIntensity: 0.06
    });
    
    const kitMat = new window.THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.8,  // Tela deportiva más áspera
        metalness: 0.05,
        emissive: isAlly ? 0x1a3a1a : 0x3a1a1a,
        emissiveIntensity: 0.06
    });
    
    const shortsMat = new window.THREE.MeshStandardMaterial({
        color: isAlly ? 0x001a4d : 0x4d001a,
        roughness: 0.8,  // Tela áspera
        metalness: 0.05
    });
    
    const sockMat = new window.THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.8,
        metalness: 0.0
    });
    
    const shoeMat = new window.THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.6,
        metalness: 0.2
    });
    
    // ===== CABEZA ATLÉTICA =====
    const headGeo = new window.THREE.IcosahedronGeometry(0.26 * scale, 4);
    const head = new window.THREE.Mesh(headGeo, skinMat);
    head.position.y = h * 0.90;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);
    
    // ===== CUELLO ROBUSTO =====
    const neckGeo = new window.THREE.CylinderGeometry(0.12 * scale, 0.13 * scale, h * 0.06, 12);
    const neck = new window.THREE.Mesh(neckGeo, skinMat);
    neck.position.y = h * 0.81;
    neck.castShadow = true;
    neck.receiveShadow = true;
    group.add(neck);
    
    // ===== TORSO TRAPEZOIDAL (HOMBROS ANCHOS) =====
    // CylinderGeometry con radio superior mayor que inferior para forma atlética
    const torsoGeo = new window.THREE.CylinderGeometry(
        0.42 * scale,  // Radio superior (hombros anchos)
        0.30 * scale,  // Radio inferior (cintura estrecha)
        h * 0.42,      // Altura del torso
        16             // Segmentos radiales
    );
    const torso = new window.THREE.Mesh(torsoGeo, kitMat);
    torso.position.y = h * 0.54;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);
    
    // ===== CADERA/SHORTS (CILINDRO) =====
    const hipsGeo = new window.THREE.CylinderGeometry(
        0.32 * scale,  // Radio superior
        0.30 * scale,  // Radio inferior
        h * 0.18,      // Altura
        16
    );
    const hips = new window.THREE.Mesh(hipsGeo, shortsMat);
    hips.position.y = h * 0.26;
    hips.castShadow = true;
    hips.receiveShadow = true;
    group.add(hips);
    
    // ===== FUNCIÓN PARA EXTREMIDADES MUSCULADAS =====
    function createLimb(radiusTop, radiusBottom, length, material, x, y) {
        const limbGrp = new window.THREE.Group();
        
        // CapsuleGeometry para forma redondeada y orgánica
        const avgRadius = (radiusTop + radiusBottom) / 2;
        const limbGeo = new window.THREE.CapsuleGeometry(avgRadius * scale, length, 6, 12);
        const limbMesh = new window.THREE.Mesh(limbGeo, material);
        limbMesh.position.y = -length / 2;
        limbMesh.castShadow = true;
        limbMesh.receiveShadow = true;
        limbGrp.add(limbMesh);
        
        limbGrp.position.set(x, y, 0);
        return limbGrp;
    }
    
    // ===== HOMBROS ESFÉRICOS GRANDES =====
    const shoulderL = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(0.20 * scale, 12, 12),
        kitMat
    );
    shoulderL.position.set(-0.42 * scale, h * 0.72, 0);
    shoulderL.castShadow = true;
    shoulderL.receiveShadow = true;
    group.add(shoulderL);
    
    const shoulderR = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(0.20 * scale, 12, 12),
        kitMat
    );
    shoulderR.position.set(0.42 * scale, h * 0.72, 0);
    shoulderR.castShadow = true;
    shoulderR.receiveShadow = true;
    group.add(shoulderR);
    
    // ===== BRAZOS SUPERIORES MUSCULADOS =====
    const armLUpper = createLimb(0.18, 0.15, h * 0.32, kitMat, -0.42 * scale, h * 0.68);
    const armRUpper = createLimb(0.18, 0.15, h * 0.32, kitMat, 0.42 * scale, h * 0.68);
    
    // ===== ANTEBRAZOS =====
    const armLFore = createLimb(0.15, 0.12, h * 0.28, skinMat, 0, -h * 0.32);
    const armRFore = createLimb(0.15, 0.12, h * 0.28, skinMat, 0, -h * 0.32);
    
    // ===== MANOS CAPSULARES =====
    const handLGeo = new window.THREE.CapsuleGeometry(0.06 * scale, 0.12 * scale, 2, 8);
    const handL = new window.THREE.Mesh(handLGeo, skinMat);
    handL.position.y = -h * 0.28;
    handL.castShadow = true;
    handL.receiveShadow = true;
    
    const handRGeo = new window.THREE.CapsuleGeometry(0.06 * scale, 0.12 * scale, 2, 8);
    const handR = new window.THREE.Mesh(handRGeo, skinMat);
    handR.position.y = -h * 0.28;
    handR.castShadow = true;
    handR.receiveShadow = true;
    
    // Ensamblar brazos
    armLFore.add(handL);
    armLUpper.add(armLFore);
    group.add(armLUpper);
    
    armRFore.add(handR);
    armRUpper.add(armRFore);
    group.add(armRUpper);
    
    // ===== PIERNAS - MUSLOS GRANDES Y MUSCULADOS =====
    const thighL = createLimb(0.22, 0.18, h * 0.38, shortsMat, -0.15 * scale, h * 0.20);
    const thighR = createLimb(0.22, 0.18, h * 0.38, shortsMat, 0.15 * scale, h * 0.20);
    
    // ===== RODILLAS ESFÉRICAS =====
    const kneeL = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(0.16 * scale, 10, 10),
        shortsMat
    );
    kneeL.position.y = -h * 0.38;
    kneeL.castShadow = true;
    kneeL.receiveShadow = true;
    thighL.add(kneeL);
    
    const kneeR = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(0.16 * scale, 10, 10),
        shortsMat
    );
    kneeR.position.y = -h * 0.38;
    kneeR.castShadow = true;
    kneeR.receiveShadow = true;
    thighR.add(kneeR);
    
    // ===== PANTORRILLAS (GEMELOS) =====
    const calfL = createLimb(0.18, 0.14, h * 0.36, sockMat, 0, -h * 0.38);
    const calfR = createLimb(0.18, 0.14, h * 0.36, sockMat, 0, -h * 0.38);
    
    // ===== TOBILLOS =====
    const ankleLGeo = new window.THREE.SphereGeometry(0.12 * scale, 8, 8);
    const ankleL = new window.THREE.Mesh(ankleLGeo, sockMat);
    ankleL.position.y = -h * 0.36;
    ankleL.castShadow = true;
    ankleL.receiveShadow = true;
    calfL.add(ankleL);
    
    const ankleRGeo = new window.THREE.SphereGeometry(0.12 * scale, 8, 8);
    const ankleR = new window.THREE.Mesh(ankleRGeo, sockMat);
    ankleR.position.y = -h * 0.36;
    ankleR.castShadow = true;
    ankleR.receiveShadow = true;
    calfR.add(ankleR);
    
    // ===== PIES/ZAPATOS =====
    const footLGeo = new window.THREE.CapsuleGeometry(0.08 * scale, 0.28 * scale, 4, 8);
    const footL = new window.THREE.Mesh(footLGeo, shoeMat);
    footL.position.set(0, -h * 0.40, 0.08 * scale);
    footL.rotation.x = Math.PI / 2;
    footL.castShadow = true;
    footL.receiveShadow = true;
    calfL.add(footL);
    
    const footRGeo = new window.THREE.CapsuleGeometry(0.08 * scale, 0.28 * scale, 4, 8);
    const footR = new window.THREE.Mesh(footRGeo, shoeMat);
    footR.position.set(0, -h * 0.40, 0.08 * scale);
    footR.rotation.x = Math.PI / 2;
    footR.castShadow = true;
    footR.receiveShadow = true;
    calfR.add(footR);
    
    // Ensamblar piernas (articulación vital para animación)
    thighL.add(calfL);
    thighR.add(calfR);
    group.add(thighL);
    group.add(thighR);
    
    // ===== SOMBRA DE CONTACTO =====
    const shadowGeo = new window.THREE.CircleGeometry(0.60 * scale, 20);
    const shadowMat = new window.THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
    });
    const shadow = new window.THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);
    
    group.position.set(pos.x, 0, pos.z);
    group.traverse(o => o.frustumCulled = true);
    scene.add(group);
    
    const playerData = {
        mesh: group,
        isAlly,
        isGoalkeeper,
        userData: {},
        homePos: pos.clone(),
        joints: {
            armLUpper: armLUpper, armRUpper: armRUpper,
            armLFore: armLFore, armRFore: armRFore,
            thighL: thighL, thighR: thighR,
            calfL: calfL, calfR: calfR
        }
    };
    
    return playerData;
}

function createBall() {
    const ballGeo = new window.THREE.SphereGeometry(0.55, 32, 32);
    const ballMat = new window.THREE.MeshStandardMaterial({
        color: 0xffffff, 
        metalness: 0.3, 
        roughness: 0.4, 
        emissive: 0x111111,
        envMapIntensity: 1.0
    });
    ball = new window.THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    ball.receiveShadow = true;
    ball.userData = { state: 'free', holder: null };
    scene.add(ball);
}

function createBackdrop() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 1024, 256);
    const bands = ['#b71c1c', '#2e7d32', '#0d47a1', '#f9a825'];
    for (let y = 0; y < 6; y++) {
        ctx.fillStyle = bands[y % bands.length];
        ctx.fillRect(0, y * 40, 1024, 30);
    }
    for (let i = 0; i < 1200; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(Math.random() * 1024, Math.random() * 256, Math.random() * 2 + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new window.THREE.CanvasTexture(canvas);
    const geom = new window.THREE.PlaneGeometry(200, 60);
    const mat = new window.THREE.MeshBasicMaterial({ map: tex, side: window.THREE.DoubleSide });
    const mesh = new window.THREE.Mesh(geom, mat);
    mesh.position.set(0, 18, 60);
    return mesh;
}

function giveBallTo(player) {
    if (!ball || !player) return;
    ball.userData.state = 'held';
    ball.userData.holder = player;
    delete ball.userData.issuer;
    delete ball.userData.ignoreTime;
    delete ball.userData.ignoreDuration;
    ball.position.copy(player.mesh.position);
    ball.position.y = 0.5;
    if (player.isAlly) {
        activePlayer = player;
        for (const p of players) {
            if (!p.isAlly) clearPlayerTarget(p);
        }
    }
}

function getTeamPlayers(isAlly) {
    return players.filter(p => p.isAlly === isAlly);
}

function clampToField(vec) {
    vec.x = Math.max(fieldBounds.minX, Math.min(fieldBounds.maxX, vec.x));
    vec.z = Math.max(fieldBounds.minZ, Math.min(fieldBounds.maxZ, vec.z));
    vec.y = 0;
}

function createPassEffect(startPos) {
    // Fire trail will be created during ball movement in animate()
}

function createFireTail(ballPos, direction) {
    // Create fire particles trailing behind the ball - like the image
    const particleCount = 6 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < particleCount; i++) {
        // Spread particles in a cone behind the ball
        const spreadAngle = (Math.random() - 0.5) * Math.PI * 0.6;
        const spreadTilt = (Math.random() - 0.5) * Math.PI * 0.6;
        
        // Create velocity opposite to direction, with spread
        const backDir = direction.clone().multiplyScalar(-1);
        const spread = new window.THREE.Vector3(
            Math.cos(spreadAngle) * Math.sin(spreadTilt),
            Math.sin(spreadTilt),
            Math.sin(spreadAngle)
        ).normalize();
        
        const particle = {
            pos: ballPos.clone().add(backDir.clone().multiplyScalar(0.5)),
            vel: backDir.clone().multiplyScalar(8 + Math.random() * 6).add(spread.multiplyScalar(4)),
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.5 + Math.random() * 0.3,
            mesh: null,
            scale: 0.4 + Math.random() * 0.3
        };
        
        // Create fire particle with gradient colors
        const pGeo = new window.THREE.SphereGeometry(particle.scale, 8, 8);
        const fireColors = [0xffff00, 0xffaa00, 0xff6600, 0xff4400, 0xff0000];
        const idx = Math.floor((i / particleCount) * fireColors.length);
        
        const pMat = new window.THREE.MeshBasicMaterial({
            color: fireColors[idx],
            emissive: fireColors[idx],
            emissiveIntensity: 1.2,
            transparent: true
        });
        
        particle.mesh = new window.THREE.Mesh(pGeo, pMat);
        particle.mesh.position.copy(particle.pos);
        scene.add(particle.mesh);
        particles.push(particle);
    }
}

function setPlayerTarget(player, pos, speed = 7) {
    // Validate position - reject invalid targets
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
        clearPlayerTarget(player);
        return;
    }
    
    // Clamp position to field bounds BEFORE assigning - prevent chasing outside field
    const clampedPos = new window.THREE.Vector3(
        Math.max(fieldBounds.minX, Math.min(fieldBounds.maxX, pos.x)),
        0,
        Math.max(fieldBounds.minZ, Math.min(fieldBounds.maxZ, pos.z))
    );
    
    if (player.isGoalkeeper) {
        const keeperHomeZ = player.isAlly ? -38 : 38;
        const minZ = keeperHomeZ - 3;
        const maxZ = keeperHomeZ + 3;
        const minX = goalArea.minX - 2;
        const maxX = goalArea.maxX + 2;
        const clamped = new window.THREE.Vector3(
            Math.max(minX, Math.min(maxX, clampedPos.x)), 0, Math.max(minZ, Math.min(maxZ, clampedPos.z))
        );
        player.userData.targetPos = clamped;
        // Goalkeeper is slower - moves at 6-8 units/sec
        player.userData.moveSpeed = Math.min(8, Math.max(3, speed * 0.5));
    } else {
        // For regular players, use the already clamped position
        player.userData.targetPos = clampedPos;
        player.userData.moveSpeed = speed;
        const now = performance.now() / 1000;
        // Enemies react immediately (no delay), allies have small delay
        const delay = player.isAlly ? (0.05 + Math.random() * 0.18) : 0;
        player.userData.startMoveTime = now + delay;
    }
}

function clearPlayerTarget(player) {
    if (player && player.userData) {
        delete player.userData.targetPos;
        delete player.userData.moveSpeed;
    }
}

function repositionAlliesDuringPass(passer, receiver) {
    if (!passer || !receiver) return;
    const allies = getTeamPlayers(true).filter(p => p !== passer && p !== receiver);
    const advanceAmount = 5.0;
    for (let i = 0; i < allies.length; i++) {
        const p = allies[i];
        const spread = (i - (allies.length - 1) / 2) * 3.5;
        const baseZ = passer.mesh.position.z + advanceAmount;
        const targetZ = Math.min(baseZ + (Math.random() - 0.5) * 2.0, goalArea.z - 8);
        const desired = new window.THREE.Vector3(p.mesh.position.x + spread, 0, targetZ);
        const clampX = Math.max(goalArea.minX - 18, Math.min(goalArea.maxX + 18, desired.x));
        desired.x = clampX;
        setPlayerTarget(p, desired, 3 + Math.random() * 1.5);
    }
}

function onPointerDown(e) {
    if (gameState !== GameState.PAUSED) return;
    
    // Get mouse position
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const mouse = new window.THREE.Vector2(x, y);
    raycaster.setFromCamera(mouse, camera);
    
    // Check if clicking on a player mesh
    const playerMeshes = players.map(p => p.mesh);
    const playerIntersects = raycaster.intersectObjects(playerMeshes, true);
    
    let clickedPlayer = null;
    if (playerIntersects.length > 0) {
        const clickedMesh = playerIntersects[0].object;
        // Find the player that owns this mesh
        clickedPlayer = players.find(p => {
            return p.mesh === clickedMesh || 
                   p.mesh.children.includes(clickedMesh) ||
                   clickedMesh.parent === p.mesh;
        });
    }
    
    // Handle player selection (only for ally field players)
    if (clickedPlayer && clickedPlayer.isAlly && !clickedPlayer.isGoalkeeper) {
        // Toggle selection
        if (selectedPlayer === clickedPlayer) {
            selectedPlayer = null;
            setMessage('Jugador deseleccionado', 800);
        } else {
            selectedPlayer = clickedPlayer;
            setMessage(`Jugador seleccionado - Click en campo para posicionar`, 900);
        }
        return;
    }
    
    // If a player is selected, click on field to set TACTIC position
    if (selectedPlayer) {
        // But allow pass if you have the ball (click on ball deselects player)
        if (activePlayer && activePlayer.isAlly && ball && ball.userData.holder === activePlayer) {
            // Check if clicking on the ball
            const ballIntersects = raycaster.intersectObject(ball);
            if (ballIntersects.length > 0) {
                // Click on ball deselects player and starts pass
                selectedPlayer = null;
                isDrawing = true;
                drawPoints = [];
                removeDrawLine();
                addPointFromEvent(e);
                return;
            }
        }
        
        const groundIntersects = raycaster.intersectObject(ground);
        if (groundIntersects.length) {
            const targetPos = groundIntersects[0].point.clone();
            // Permitir movimiento en todo el campo propio (hasta la línea media)
            if (targetPos.z < 45) { // Permitir hasta casi el centro del campo (ajustado para campo 120)
                // Store tactic position but don't move yet
                tacticPositions[selectedPlayer.mesh.uuid] = targetPos.clone();
                setMessage('Posición táctica guardada ✓', 800);
                selectedPlayer = null;
                return;
            } else {
                setMessage('¡Posición demasiado adelante! (Solo puedes mandar a tu mitad del campo)', 1000);
                return;
            }
        }
        return;
    }
    
    // Normal pass/shoot if no player selected and has ball
    if (!activePlayer || !activePlayer.isAlly || !ball || !ball.userData) {
        setMessage('No tienes el balón', 900);
        return;
    }
    if (ball.userData.holder !== activePlayer) {
        setMessage('No tienes el balón', 900);
        return;
    }
    isDrawing = true;
    drawPoints = [];
    removeDrawLine();
    addPointFromEvent(e);
}

function onPointerMove(e) {
    if (!isDrawing) return;
    addPointFromEvent(e);
    updateDrawLine();
}

function onPointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    addPointFromEvent(e);
    finalizeCurveAndShoot();
}

function addPointFromEvent(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const mouse = new window.THREE.Vector2(x, y);
    raycaster.setFromCamera(mouse, camera);
    
    // Try ground first
    const groundIntersects = raycaster.intersectObject(ground);
    if (groundIntersects.length) {
        drawPoints.push(groundIntersects[0].point.clone());
        return;
    }
    
    // Fallback: use plane at y=0
    const plane = new window.THREE.Plane(new window.THREE.Vector3(0, 1, 0), 0);
    const point = new window.THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, point)) {
        // Clamp to field bounds
        point.x = Math.max(fieldBounds.minX, Math.min(fieldBounds.maxX, point.x));
        point.z = Math.max(fieldBounds.minZ, Math.min(fieldBounds.maxZ, point.z));
        drawPoints.push(point.clone());
    }
}

function updateDrawLine() {
    removeDrawLine();
    if (drawPoints.length < 2) return;
    const pts = drawPoints.map(p => new window.THREE.Vector3(p.x, p.y + 0.1, p.z));
    const geo = new window.THREE.BufferGeometry().setFromPoints(pts);
    const mat = new window.THREE.LineBasicMaterial({ 
        color: 0xffff00,  // Más brillante: amarillo puro
        linewidth: 2,
        fog: false
    });
    drawLine = new window.THREE.Line(geo, mat);
    drawLine.renderOrder = 999; // Dibuja al final para no ser ocultado
    scene.add(drawLine);
}

function removeDrawLine() {
    if (drawLine) {
        scene.remove(drawLine);
        if (drawLine.geometry) drawLine.geometry.dispose();
        if (drawLine.material) drawLine.material.dispose();
        drawLine = null;
    }
}

function finalizeCurveAndShoot() {
    if (drawPoints.length < 2) {
        setMessage('Trayectoria muy corta', 1200);
        removeDrawLine();
        return;
    }
    if (!ball || !ball.userData || ball.userData.holder !== activePlayer) {
        setMessage('No eres el poseedor', 1000);
        removeDrawLine();
        return;
    }
    
    const startPos = ball.position.clone();
    const rawPts = [...drawPoints];
    const rawFinal = rawPts[rawPts.length - 1].clone();

    // Clamp final target to field bounds
    const finalPoint = new window.THREE.Vector3(
        Math.max(fieldBounds.minX, Math.min(fieldBounds.maxX, rawFinal.x)),
        0,
        Math.max(fieldBounds.minZ, Math.min(fieldBounds.maxZ, rawFinal.z))
    );

    // Build a constrained, smooth path to avoid unrealistic bends
    const straightDir = finalPoint.clone().sub(startPos);
    const straightDist = straightDir.length();
    if (straightDist < 0.5) {
        setMessage('Trayectoria muy corta', 1200);
        removeDrawLine();
        return;
    }
    straightDir.normalize();
    const perp = new window.THREE.Vector3(-straightDir.z, 0, straightDir.x).normalize();
    let maxOffset = 0;
    for (const p of rawPts) {
        const off = perp.dot(p.clone().sub(startPos));
        if (Math.abs(off) > Math.abs(maxOffset)) maxOffset = off;
    }
    const maxDev = Math.max(6, Math.min(18, straightDist * 0.50));
    const lateral = Math.max(-maxDev, Math.min(maxDev, maxOffset));
    const midPoint = startPos.clone()
        .add(straightDir.clone().multiplyScalar(straightDist * 0.5))
        .add(perp.clone().multiplyScalar(lateral * 1.2));

    // Agregar altura SOLO si hay curvatura real en el dibujo del usuario
    const curveIntensity = Math.abs(lateral) / (maxDev > 0 ? maxDev : 1);
    if (curveIntensity > 0.3) {
        // Solo sube si hay curva significativa (más del 30% de desviación máxima)
        midPoint.y += curveIntensity * straightDist * 0.4;
    }
    
    const pts = [startPos, midPoint, finalPoint];
    curve = new window.THREE.CatmullRomCurve3(pts, false);
    const length = approximateCurveLength(curve, 60);

    const isShot = finalPoint.z >= goalArea.z - 1;
    const baseSpeed = isShot ? (16 + straightDist * 0.45) : (12 + straightDist * 0.6);
    const speed = Math.max(isShot ? 15 : 12, Math.min(isShot ? 24 : 22, baseSpeed));
    curveDuration = Math.max(0.35, length / speed);
    curveStartTime = performance.now() / 1000;
    
    ball.userData.state = 'moving';
    ball.userData.holder = null;
    ball.userData.issuer = activePlayer;
    ball.userData.ignoreTime = performance.now() / 1000;
    ball.userData.ignoreDuration = Math.min(0.28, curveDuration * 0.22);
    const arcBase = isShot
        ? Math.min(7.5, Math.max(0.6, straightDist * 0.11))
        : Math.min(6.0, Math.max(0.6, straightDist * 0.08));
    ball.userData.arcHeight = arcBase;
    firstPassMade = true;
    
    // Apply tactic positions when pass starts
    for (const playerUUID in tacticPositions) {
        const targetPos = tacticPositions[playerUUID];
        const tacticalPlayer = players.find(p => p.mesh.uuid === playerUUID);
        if (tacticalPlayer) {
            setPlayerTarget(tacticalPlayer, targetPos, 7);
        }
    }
    // Clear tactic positions after applying
    tacticPositions = {};
    
    // Create pass effect at player position
    createPassEffect(activePlayer.mesh.position);
    
    const allied = getTeamPlayers(true);
    const enemies = getTeamPlayers(false);
    
    let receiver = null;
    let minDist = Infinity;
    for (const p of allied) {
        if (p === activePlayer) continue;
        const d = p.mesh.position.distanceTo(finalPoint);
        if (d < minDist) {
            minDist = d;
            receiver = p;
        }
    }
    
    if (isShot) {
        setMessage('¡TIRO A PUERTA!', 1000);
        const enemyKeeper = enemies.find(p => p.isGoalkeeper);
        if (enemyKeeper) {
            // Mark that a shot is incoming so keeper chases the ball during animate()
            enemyKeeper.userData.shotIncoming = true;
        }
    } else {
        setMessage('PASE', 800);
        if (receiver) {
            setPlayerTarget(receiver, finalPoint.clone(), 8);
            repositionAlliesDuringPass(activePlayer, receiver);
            
            // Enemies try to block the pass - move towards the receiver or intercept point
            const enemies = getTeamPlayers(false);
            for (const e of enemies) {
                if (e.isGoalkeeper) continue;
                
                // Check if this enemy is close to the pass line
                const distToReceiver = e.mesh.position.distanceTo(receiver.mesh.position);
                const distToFinalPoint = e.mesh.position.distanceTo(finalPoint);
                
                // If enemy is relatively close to the pass path, try to intercept
                if (distToReceiver < 20 || distToFinalPoint < 15) {
                    // Move towards the final point to block the pass
                    // Use receiver position as intercept point (more reliable)
                    setPlayerTarget(e, receiver.mesh.position.clone(), 9);
                }
            }
        }
    }
    
    if (!isShot && activePlayer && activePlayer.isAlly) {
        const enemies = getTeamPlayers(false);
        let closest = null;
        let minDist = Infinity;
        for (const e of enemies) {
            if (e.isGoalkeeper) continue;
            const d = e.mesh.position.distanceTo(activePlayer.mesh.position);
            if (d < minDist) {
                minDist = d;
                closest = e;
            }
        }
        if (closest && minDist < 25) {
            setPlayerTarget(closest, activePlayer.mesh.position.clone(), 8);
        }
    }
    
    setState(GameState.PLAYING);
}

function approximateCurveLength(curve, segments = 100) {
    let len = 0;
    let prev = curve.getPoint(0);
    for (let i = 1; i <= segments; i++) {
        const pt = curve.getPoint(i / segments);
        len += pt.distanceTo(prev);
        prev = pt;
    }
    return len;
}

function animate() {
    requestAnimationFrame(animate);
    
    if (!scene || !camera || !renderer) return;
    
    try {
        const now = performance.now() / 1000;
        const dt = 1 / 60;
        
        if (gameState === GameState.PLAYING && curve) {
            const t = Math.min(1, (now - curveStartTime) / curveDuration);
            const p = curve.getPoint(t);
            ball.position.copy(p);
            const tangent = curve.getTangent(Math.max(0, Math.min(1, t + 0.001)));
            ball.userData.dir = tangent.clone().normalize();
            const arc = (ball.userData && ball.userData.arcHeight) ? ball.userData.arcHeight : 0;
            // Improved arc: smooth parabola instead of sin
            const arcHeight = arc * Math.sin(t * Math.PI);
            ball.position.y = (p.y || 0) + arcHeight;
            ball.rotation.x += 0.8;
            ball.rotation.y += 0.4;

            // Check post / crossbar collisions for bounces
            const postRadius = 0.35;
            const ballRadius = 0.55;
            const posts = [
                new window.THREE.Vector2(-7, goalArea.z),
                new window.THREE.Vector2(7, goalArea.z)
            ];
            let bounced = false;
            for (const post of posts) {
                const dx = ball.position.x - post.x;
                const dz = ball.position.z - post.y;
                const dist = Math.hypot(dx, dz);
                if (dist < postRadius + ballRadius) {
                    const normal = new window.THREE.Vector3(dx, 0, dz).normalize();
                    const dir = (ball.userData.dir || new window.THREE.Vector3(0,0,1)).clone();
                    const reflected = dir.sub(normal.clone().multiplyScalar(2 * dir.dot(normal))).normalize();
                    ball.userData.state = 'free';
                    ball.userData.holder = null;
                    ball.userData.vel = reflected.multiplyScalar(14);
                    curve = null;
                    bounced = true;
                    triggerLooseBallChase();
                    break;
                }
            }

            // Crossbar bounce (top bar at y≈6, along x between posts, z=goalArea.z)
            if (!bounced) {
                const withinX = ball.position.x >= goalArea.minX - 0.6 && ball.position.x <= goalArea.maxX + 0.6;
                const nearZ = Math.abs(ball.position.z - goalArea.z) < 0.5;
                const nearY = ball.position.y > 5.0 && ball.position.y < 6.6;
                if (withinX && nearZ && nearY) {
                    const dir = (ball.userData.dir || new window.THREE.Vector3(0,1,0)).clone();
                    dir.y = -Math.abs(dir.y || 0.4);
                    dir.x *= 0.9;
                    dir.z *= 0.9;
                    ball.userData.state = 'free';
                    ball.userData.holder = null;
                    ball.userData.vel = dir.normalize().multiplyScalar(12);
                    curve = null;
                    bounced = true;
                    triggerLooseBallChase();
                }
            }

            // Net collision (back curtain) to stop the ball going out and keep play alive
            if (!bounced) {
                const withinXNet = ball.position.x >= -7.5 && ball.position.x <= 7.5;
                const withinZNet = ball.position.z > 38 && ball.position.z < 41.5;
                const withinHeight = ball.position.y <= 6.4;
                if (withinXNet && withinZNet && withinHeight) {
                    const dir = (ball.userData.dir || new window.THREE.Vector3(0,0,1)).clone();
                    const velMag = Math.max(10, dir.length() * 14);
                    dir.z = -Math.abs(dir.z || 0.3) * 0.1; // minimal rebound - ball stays in net
                    dir.x *= 0.15; // reduce side rebound
                    dir.y *= 0.1; // reduce vertical rebound
                    ball.userData.state = 'free';
                    ball.userData.holder = null;
                    ball.userData.vel = dir.normalize().multiplyScalar(velMag * 0.08);
                    ball.position.z = goalArea.z + 0.12;
                    
                    // Apply impulse to ALL net panels near impact point
                    if (goalNetMesh && goalNetMesh.userData && goalNetMesh.userData.netState) {
                        const ns = goalNetMesh.userData.netState;
                        const ballPos = ball.position;
                        const impactRadius = 4.0; // how far impact spreads
                        
                        // Helper function to apply impulse to a panel
                        function applyNetImpulse(panelMesh, velArray, origArray, panelName) {
                            if (!panelMesh) return;
                            const pos = panelMesh.geometry.attributes.position;
                            const pArr = pos.array;
                            for (let i = 0; i < pos.count; i++) {
                                const ix = i * 3;
                                const localX = pArr[ix];
                                const localY = pArr[ix + 1];
                                const localZ = pArr[ix + 2];
                                
                                // Convert to world coords
                                const worldX = localX + panelMesh.position.x;
                                const worldY = localY + panelMesh.position.y;
                                const worldZ = localZ + panelMesh.position.z;
                                
                                // Distance from ball
                                const dx = worldX - ballPos.x;
                                const dy = worldY - ballPos.y;
                                const dz = worldZ - ballPos.z;
                                const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
                                const influence = Math.max(0, 1 - d / impactRadius);
                                
                                if (influence > 0.05) {
                                    // Push vertices away from ball
                                    velArray[ix]     += -dx * 4.8 * influence;
                                    velArray[ix + 1] += -dy * 3.9 * influence;
                                    velArray[ix + 2] += -dz * 5.4 * influence;
                                }
                            }
                            pos.needsUpdate = true;
                        }
                        
                        // Apply impulse to all panels (bottom removed)
                        applyNetImpulse(goalNetMesh.userData.netBack, ns.backVel, ns.backOrig, 'back');
                        applyNetImpulse(goalNetMesh.userData.netRoof, ns.roofVel, ns.roofOrig, 'roof');
                        applyNetImpulse(goalNetMesh.userData.netLeft, ns.leftVel, ns.leftOrig, 'left');
                        applyNetImpulse(goalNetMesh.userData.netRight, ns.rightVel, ns.rightOrig, 'right');
                    }
                    
                    removeDrawLine();
                    curve = null;
                    bounced = true;
                    triggerLooseBallChase();
                }
            }
            
            // Create fire trail effect behind the ball
            if (Math.floor(t * 100) % 2 === 0) {
                ballTrail.push(ball.position.clone());
                if (ballTrail.length > 20) ballTrail.shift();
                // Create fire tail every few frames
                if (ballTrail.length > 1) {
                    const direction = ball.position.clone().sub(ballTrail[ballTrail.length - 2]).normalize();
                    createFireTail(ball.position, direction);
                }
            }
            
            // Goalkeeper prediction: move toward expected landing point (slightly delayed)
            const enemies = getTeamPlayers(false);
            const keeper = enemies.find(pk => pk.isGoalkeeper);
            if (keeper && keeper.userData.shotIncoming && t > 0.25) {
                const predicted = curve ? curve.getPoint(1).clone() : ball.position.clone();
                predicted.x = Math.max(goalArea.minX - 2.5, Math.min(goalArea.maxX + 2.5, predicted.x));
                predicted.z = keeper.isAlly ? Math.max(-63, Math.min(-51, predicted.z)) : Math.max(51, Math.min(63, predicted.z));
                setPlayerTarget(keeper, predicted, 12);

                // Dive/jump animation based on relative height and lateral offset
                const relX = ball.position.x - keeper.mesh.position.x;
                const relZ = ball.position.z - keeper.mesh.position.z;
                const horizDist = Math.hypot(relX, relZ);
                const height = ball.position.y;

                // Improved goalkeeper animation with actual jumping
                if (height > 1.5 && horizDist < 12) {
                    // High ball - jump upward with arms raised
                    const jumpAmount = Math.min(0.55, 0.4 + (height - 1.5) * 0.15);
                    keeper.mesh.rotation.x = jumpAmount;
                    keeper.mesh.rotation.z = 0;
                    // Lift keeper off ground slightly
                    keeper.mesh.position.y = Math.min(2.5, 0.3 + (height - 1.5) * 0.4);
                } else if (horizDist > 2.5) {
                    // Lateral dive - rotate more dramatically
                    const dive = Math.min(Math.PI / 2.5, 0.3 + horizDist * 0.06);
                    keeper.mesh.rotation.x = 0.15; // slight forward lean
                    keeper.mesh.rotation.z = relX > 0 ? dive : -dive;
                    // Slight lift for dive
                    keeper.mesh.position.y = Math.min(1.2, 0.1 + horizDist * 0.05);
                } else if (horizDist > 0.8) {
                    // Ready stance
                    keeper.mesh.rotation.x = 0.1;
                    keeper.mesh.rotation.z = relX > 0 ? 0.08 : -0.08;
                    keeper.mesh.position.y *= 0.92; // settle back down
                } else {
                    // Reset smoothly
                    keeper.mesh.rotation.x *= 0.88;
                    keeper.mesh.rotation.z *= 0.88;
                    keeper.mesh.position.y *= 0.88;
                }
            }
            
            // Early goal detection: STRICT - must be between posts AND under crossbar AND past goal line
            // Solo gol si está DENTRO de la portería (entre palos, bajo travesaño, Y dentro de la red)
            if (ball.position.z >= goalArea.z + 0.5 &&  // Must be INSIDE the goal net (not just at the line)
                ball.position.z <= goalArea.z + 3.5 &&  // But not too far back (within net depth)
                ball.position.x > goalArea.minX &&
                ball.position.x < goalArea.maxX &&
                ball.position.y > 0.2 &&  // Above ground
                ball.position.y < 6.0) { // Must be under crossbar
                showGoalAndNext();
                return;
            }

            checkCollisions();
            
            if (t >= 1) {
                // Do not pause the game here; keep playing so free-ball physics continue
                setState(GameState.PLAYING);
                removeDrawLine();
                ballTrail = []; // Clear trail
                // Clear shot flag from keeper
                const enemies = getTeamPlayers(false);
                const keeper = enemies.find(pk => pk.isGoalkeeper);
                if (keeper) keeper.userData.shotIncoming = false;
                
                // Final goal check - strict conditions with net depth
                if (ball.position.z >= goalArea.z + 0.5 &&
                    ball.position.z <= goalArea.z + 3.5 &&
                    ball.position.x > goalArea.minX &&
                    ball.position.x < goalArea.maxX &&
                    ball.position.y > 0.2 &&
                    ball.position.y < 6.0) {
                    showGoalAndNext();
                } else {
                    // Ball lands - let checkCollisions find the receiver
                    if (ball.userData) {
                        ball.userData.state = 'free';
                        ball.userData.holder = null;
                        ball.userData.vel = (ball.userData.dir || new window.THREE.Vector3(0,0,1)).clone().multiplyScalar(6);
                    }
                }
                curve = null;
            }
        }

        // Free ball simple physics (after bounces/landing)
        if (ball && ball.userData && ball.userData.state === 'free' && ball.userData.vel) {
            const vel = ball.userData.vel;
            ball.position.addScaledVector(vel, dt);
            vel.y -= 9 * dt; // gravity
            vel.multiplyScalar(0.985); // air drag
            // Ground bounce
            if (ball.position.y < 0.5) {
                ball.position.y = 0.5;
                if (vel.y < 0) vel.y = -vel.y * 0.45;
                vel.x *= 0.85;
                vel.z *= 0.85;
            }
            // Net backstop during free state - ball stays in net and falls naturally
            const withinXNet = ball.position.x >= -7.5 && ball.position.x <= 7.5;
            const withinZNet = ball.position.z > 38 && ball.position.z < 41.5;
            const withinHeight = ball.position.y >= 0 && ball.position.y <= 6.5;
            if (withinXNet && withinZNet && withinHeight) {
                // Ball is inside net - apply net drag and gravity
                vel.multiplyScalar(0.88); // strong net drag slows ball down
                vel.y -= 12 * dt; // stronger gravity pulls ball down in net
                
                // Soft boundaries keep ball in net
                if (ball.position.z > 41.3) {
                    ball.position.z = 41.3;
                    vel.z *= -0.2;
                }
                if (ball.position.z < 38.2) {
                    ball.position.z = 38.2;
                    vel.z *= -0.15;
                }
                if (ball.position.x < -6.8) {
                    ball.position.x = -6.8;
                    vel.x *= -0.2;
                }
                if (ball.position.x > 6.8) {
                    ball.position.x = 6.8;
                    vel.x *= -0.2;
                }
                
                // Continuous net deformation while ball moves in net
                if (vel.length() > 0.5 && goalNetMesh && goalNetMesh.userData && goalNetMesh.userData.netState) {
                    const ns = goalNetMesh.userData.netState;
                    const ballPos = ball.position;
                    const impactRadius = 3.5;
                    
                    function applyNetImpulseContinuous(panelMesh, velArray) {
                        if (!panelMesh) return;
                        const pos = panelMesh.geometry.attributes.position;
                        const pArr = pos.array;
                        for (let i = 0; i < pos.count; i++) {
                            const ix = i * 3;
                            const worldX = pArr[ix] + panelMesh.position.x;
                            const worldY = pArr[ix + 1] + panelMesh.position.y;
                            const worldZ = pArr[ix + 2] + panelMesh.position.z;
                            const dx = worldX - ballPos.x;
                            const dy = worldY - ballPos.y;
                            const dz = worldZ - ballPos.z;
                            const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
                            const influence = Math.max(0, 1 - d / impactRadius);
                            if (influence > 0.05) {
                                velArray[ix]     += -dx * 0.7 * influence * dt * 60;
                                velArray[ix + 1] += -dy * 0.5 * influence * dt * 60;
                                velArray[ix + 2] += -dz * 0.8 * influence * dt * 60;
                            }
                        }
                    }
                    
                    applyNetImpulseContinuous(goalNetMesh.userData.netBack, ns.backVel);
                    applyNetImpulseContinuous(goalNetMesh.userData.netRoof, ns.roofVel);
                    applyNetImpulseContinuous(goalNetMesh.userData.netLeft, ns.leftVel);
                    applyNetImpulseContinuous(goalNetMesh.userData.netRight, ns.rightVel);
                    applyNetImpulseContinuous(goalNetMesh.userData.netBottom, ns.bottomVel);
                }
            }
            // Stop tiny motion
            if (vel.length() < 0.4) {
                vel.set(0,0,0);
            }

            // Continuous loose ball chase retargeting every ~0.15s
            if (ball.userData.looseChaseActive) {
                if (!ball.userData.lastChaseUpdate || now - ball.userData.lastChaseUpdate > 0.15) {
                    triggerLooseBallChase();
                    ball.userData.lastChaseUpdate = now;
                }
            }
        }

        // Net spring physics update - ALL PANELS deform realistically
        if (goalNetMesh && goalNetMesh.userData && goalNetMesh.userData.netState) {
            const ns = goalNetMesh.userData.netState;
            const spring = 25.0; // softer spring for more visible deformation
            const damping = 2.5; // less damping for longer oscillation
            
            // Helper function to update panel physics
            function updateNetPanel(panelMesh, velArray, origArray) {
                if (!panelMesh) return;
                const pos = panelMesh.geometry.attributes.position;
                const pArr = pos.array;
                const maxDeformation = 1.5; // max distance from original position
                const maxVelocity = 25.0; // max velocity per vertex
                
                for (let i = 0; i < pos.count; i++) {
                    const ix = i * 3;
                    const px = pArr[ix];
                    const py = pArr[ix + 1];
                    const pz = pArr[ix + 2];
                    const ox = origArray[ix];
                    const oy = origArray[ix + 1];
                    const oz = origArray[ix + 2];
                    
                    // Spring forces pull vertices back to original position
                    const ax = (ox - px) * spring - velArray[ix] * damping;
                    const ay = (oy - py) * spring - velArray[ix + 1] * damping;
                    const az = (oz - pz) * spring - velArray[ix + 2] * damping;
                    
                    velArray[ix]     += ax * dt;
                    velArray[ix + 1] += ay * dt;
                    velArray[ix + 2] += az * dt;
                    
                    // Clamp velocity to prevent explosions
                    velArray[ix] = Math.max(-maxVelocity, Math.min(maxVelocity, velArray[ix]));
                    velArray[ix + 1] = Math.max(-maxVelocity, Math.min(maxVelocity, velArray[ix + 1]));
                    velArray[ix + 2] = Math.max(-maxVelocity, Math.min(maxVelocity, velArray[ix + 2]));
                    
                    pArr[ix]     += velArray[ix] * dt;
                    pArr[ix + 1] += velArray[ix + 1] * dt;
                    pArr[ix + 2] += velArray[ix + 2] * dt;
                    
                    // Clamp deformation to prevent vertices going too far
                    const dx = pArr[ix] - ox;
                    const dy = pArr[ix + 1] - oy;
                    const dz = pArr[ix + 2] - oz;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    if (dist > maxDeformation) {
                        const scale = maxDeformation / dist;
                        pArr[ix] = ox + dx * scale;
                        pArr[ix + 1] = oy + dy * scale;
                        pArr[ix + 2] = oz + dz * scale;
                        // Dampen velocity when hitting max deformation
                        velArray[ix] *= 0.3;
                        velArray[ix + 1] *= 0.3;
                        velArray[ix + 2] *= 0.3;
                    }
                }
                pos.needsUpdate = true;
            }
            
            // Update all net panels (bottom removed)
            updateNetPanel(goalNetMesh.userData.netBack, ns.backVel, ns.backOrig);
            updateNetPanel(goalNetMesh.userData.netRoof, ns.roofVel, ns.roofOrig);
            updateNetPanel(goalNetMesh.userData.netLeft, ns.leftVel, ns.leftOrig);
            updateNetPanel(goalNetMesh.userData.netRight, ns.rightVel, ns.rightOrig);
        }
        
        // Always check for collisions (for free ball or held ball)
        checkCollisions();
        
        if (ball && ball.userData && ball.userData.state === 'held' && ball.userData.holder) {
            const h = ball.userData.holder;
            ball.position.copy(h.mesh.position);
            ball.position.y = 0.5;
        }
        
        for (const p of players) {
            // ENSURE PLAYER IS ALWAYS VISIBLE
            p.mesh.visible = true;
            p.mesh.traverse(o => { o.visible = true; });
            
            // CRITICAL: Always keep Y at 0 and prevent tilting (except goalkeeper dive)
            p.mesh.position.y = 0;
            // Prevent players from tilting/sinking - keep upright unless actively diving/jumping
            if (!p.isGoalkeeper || !p.userData.targetPos) {
                p.mesh.rotation.x = 0;
                p.mesh.rotation.z = 0;
            } else {
                // Clamp dive rotations to avoid flipping out of view
                p.mesh.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, p.mesh.rotation.x));
                p.mesh.rotation.z = Math.max(-Math.PI/2, Math.min(Math.PI/2, p.mesh.rotation.z));
            }
            const nowSec = now;

            // Safety net: if a player ever leaves the pitch or gets NaN, snap back home
            if (!Number.isFinite(p.mesh.position.x) || !Number.isFinite(p.mesh.position.z) ||
                Math.abs(p.mesh.position.x) > 120 || Math.abs(p.mesh.position.z) > 120) {
                if (p.homePos) {
                    p.mesh.position.copy(p.homePos);
                } else {
                    p.mesh.position.set(0, 0, 0);
                }
                clearPlayerTarget(p);
            }

            // Keep players visible even if something glitched
            p.mesh.visible = true;
            
            // FORCE Y=0 always before any calculation
            p.mesh.position.y = 0;
            
            // Player separation/repulsion logic - prevent stacking
            for (const other of players) {
                if (other === p) continue;
                const dist = p.mesh.position.distanceTo(other.mesh.position);
                const minDist = 2.0; // Minimum distance between players
                if (dist < minDist && dist > 0.01) {
                    const dir = p.mesh.position.clone().sub(other.mesh.position).normalize();
                    const separation = (minDist - dist) * 0.3;
                    p.mesh.position.x += dir.x * separation;
                    p.mesh.position.z += dir.z * separation;
                }
            }
            
            // CRITICAL: Always force Y to ground level after separation (unless goalkeeper jumping)
            if (!p.isGoalkeeper || !p.userData.targetPos || ball.userData.state !== 'moving') {
                p.mesh.position.y = 0;
            }
            
            if (!p.userData.targetPos) {
                if (!p.userData._idlePhase) p.userData._idlePhase = Math.random() * Math.PI * 2;
                const lean = Math.sin(nowSec * 1.5 + p.userData._idlePhase) * 0.02;
                p.mesh.rotation.z = lean;
                // Reset goalkeeper rotations when idle
                if (p.isGoalkeeper) {
                    p.mesh.rotation.x *= 0.9;
                    p.mesh.rotation.z *= 0.9;
                    p.mesh.position.y *= 0.9;
                }
                continue;
            }
            
            if (p.userData.startMoveTime && nowSec < p.userData.startMoveTime) continue;
            
            const cur = p.mesh.position;
            const target = p.userData.targetPos;
            const spd = p.userData.moveSpeed || 7;
            const dir = new window.THREE.Vector3(target.x - cur.x, 0, target.z - cur.z);
            const dist = dir.length();
            
            if (dist > 0.1) {
                dir.normalize();
                const moveAmount = Math.min(dist, spd * dt);
                cur.x += dir.x * moveAmount;
                cur.z += dir.z * moveAmount;
                
                // FORCE Y=0 immediately after movement (unless goalkeeper jumping)
                if (!p.isGoalkeeper || ball.userData.state !== 'moving') {
                    cur.y = 0;
                    p.mesh.position.y = 0;
                }
                clampToField(cur);
                // FORCE Y=0 after clamping (unless goalkeeper jumping)
                if (!p.isGoalkeeper || ball.userData.state !== 'moving') {
                    p.mesh.position.y = 0;
                }
                
                // Running animation - más realista con flexión natural
                const runSpeed = spd * 2.2; // Faster leg movement for running
                const t = now * runSpeed;
                
                if (p.joints) {
                    // Brazos: balanceo más amplio y flexión de codos realista
                    const armSwing = Math.sin(t) * 0.65; // Larger arm swing for running
                    const armCycle = Math.sin(t + Math.PI) * 0.65;
                    
                    // Upper arm swings forward/backward
                    p.joints.armLUpper.rotation.x = armSwing;
                    p.joints.armRUpper.rotation.x = armCycle;
                    
                    // Forearms flex with natural cocking motion (90-120 degrees when arm is forward)
                    // More pronounced flexion for realistic running form
                    p.joints.armLFore.rotation.x = -0.3 - Math.max(0.25, Math.abs(armSwing) * 0.5);
                    p.joints.armRFore.rotation.x = -0.3 - Math.max(0.25, Math.abs(armCycle) * 0.5);
                    
                    // Thighs: large stride (0 to 90 degrees forward/backward)
                    const thighL = Math.sin(t + Math.PI) * 0.7; // Reduced from 0.8
                    const thighR = Math.sin(t) * 0.7;
                    p.joints.thighL.rotation.x = thighL;
                    p.joints.thighR.rotation.x = thighR;
                    
                    // Calves: controlled knee bends - only bend backward to prevent ground clipping
                    // When thigh is forward (positive), knee bends back (positive calf rotation)
                    p.joints.calfL.rotation.x = Math.max(0, thighL * 0.9 + 0.3); // Only positive (backward bend)
                    p.joints.calfR.rotation.x = Math.max(0, thighR * 0.9 + 0.3);
                }
                
                // Goalkeeper dive/block animation with arm movements
                if (p.isGoalkeeper && p.userData.targetPos && ball && ball.userData.state === 'moving') {
                    const ballDist = p.mesh.position.distanceTo(ball.position);
                    const relX = ball.position.x - p.mesh.position.x;
                    const relZ = ball.position.z - p.mesh.position.z;
                    const ballHeight = ball.position.y;
                    
                    if (ballDist < 5) {
                        // Close save - use arms and dive
                        if (ballHeight > 1.2) {
                            // High ball - arms up to punch/block
                            p.joints.armLUpper.rotation.x = -1.5; // Raise arm up
                            p.joints.armRUpper.rotation.x = -1.5;
                            p.joints.armLFore.rotation.x = 0.3; // Extend forearm
                            p.joints.armRFore.rotation.x = 0.3;
                            // Slight lean forward
                            p.mesh.rotation.x = 0.25;
                        } else {
                            // Low ball - full dive to ground
                            p.mesh.rotation.x = Math.PI / 3.5; // Pitch forward (dive)
                            // Arms extend forward/down for ground save
                            p.joints.armLUpper.rotation.x = 0.8;
                            p.joints.armRUpper.rotation.x = 0.8;
                            p.joints.armLFore.rotation.x = -0.5;
                            p.joints.armRFore.rotation.x = -0.5;
                        }
                    } else if (ballDist < 10) {
                        // Medium distance - ready position with arms high
                        if (ballHeight > 0.8) {
                            // Arms ready to block/punch
                            p.joints.armLUpper.rotation.x = -0.8;
                            p.joints.armRUpper.rotation.x = -0.8;
                            p.joints.armLFore.rotation.x = 0.1;
                            p.joints.armRFore.rotation.x = 0.1;
                        }
                        // Light lean
                        p.mesh.rotation.x = Math.min(0.25, 0.25 * (1 - ballDist / 10));
                    } else {
                        // Far - reset to idle ready position
                        p.mesh.rotation.x *= 0.88;
                        p.joints.armLUpper.rotation.x *= 0.88;
                        p.joints.armRUpper.rotation.x *= 0.88;
                    }
                }
                
                const lookAtQuat = new window.THREE.Quaternion();
                const fwd = new window.THREE.Vector3(dir.x, 0, dir.z).normalize();
                lookAtQuat.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z));
                p.mesh.quaternion.slerp(lookAtQuat, 0.12);
            } else {
                // Reset limbs to idle
                if (p.joints) {
                    p.joints.armLUpper.rotation.x *= 0.88;
                    p.joints.armRUpper.rotation.x *= 0.88;
                    p.joints.armLFore.rotation.x *= 0.88;
                    p.joints.armRFore.rotation.x *= 0.88;
                    p.joints.thighL.rotation.x *= 0.88;
                    p.joints.thighR.rotation.x *= 0.88;
                    p.joints.calfL.rotation.x *= 0.88;
                    p.joints.calfR.rotation.x *= 0.88;
                }
                // Reset body rotations (goalkeeper dive/lean)
                p.mesh.rotation.x *= 0.90;
                p.mesh.rotation.z *= 0.92;
                clearPlayerTarget(p);
            }

            // Final clamp to ensure no drift outside the pitch bounds
            clampToField(p.mesh.position);
            // ABSOLUTELY FINAL: Ensure Y is ALWAYS 0
            p.mesh.position.y = 0;
            
            // Visual feedback for selected player - make them glow/pulse
            if (selectedPlayer === p) {
                const pulse = Math.sin(now * 4) * 0.5 + 0.5; // Pulsing effect
                p.mesh.traverse(child => {
                    if (child.material && child.material.emissive) {
                        child.material.emissive.setHex(0xffff00); // Yellow glow
                        child.material.emissiveIntensity = pulse * 0.6;
                    }
                });
            } else {
                // Reset emissive for non-selected players
                p.mesh.traverse(child => {
                    if (child.material && child.material.emissive) {
                        child.material.emissive.setHex(0x000000);
                        child.material.emissiveIntensity = 0;
                    }
                });
            }
        }
        
        // Camera update based on mode
        if (ball) {
            if (cameraMode === 'follow') {
                // Original follow camera (behind the action) - adjusted for larger field
                const desired = new window.THREE.Vector3(ball.position.x, ball.position.y + 30, ball.position.z - 50);
                camera.position.lerp(desired, 0.08);
                camera.lookAt(ball.position.x, 2, ball.position.z + 8);
            } else {
                // FIFA-style camera (broadcast view from side elevation) - adjusted for larger field
                const desired = new window.THREE.Vector3(
                    ball.position.x * 0.3 + 70, 
                    52, 
                    ball.position.z * 0.5
                );
                camera.position.lerp(desired, 0.04);
                camera.lookAt(ball.position.x * 0.2, 0, ball.position.z * 0.7);
            }
        }
        
        // Enemy AI: roles (press, cover, anchor) when play is paused and ally holds ball
        // DESACTIVADO - Los defensas solo se mueven durante el pase (cuando ball está 'moving')
        /*
        if (gameState === GameState.PAUSED && activePlayer && activePlayer.isAlly) {
            const enemies = getTeamPlayers(false).filter(e => !e.isGoalkeeper);
            if (enemies.length) {
                // Assign nearest to press ball holder
                let presser = null;
                let minDist = Infinity;
                for (const e of enemies) {
                    const d = e.mesh.position.distanceTo(activePlayer.mesh.position);
                    if (d < minDist) { minDist = d; presser = e; }
                }
                if (presser) {
                    const pressPos = activePlayer.mesh.position.clone();
                    pressPos.z = Math.min(pressPos.z, 10);
                    setPlayerTarget(presser, pressPos, 9);
                }

                // Anchor: furthest stays back near box center
                let anchor = null;
                let maxDist = -Infinity;
                for (const e of enemies) {
                    const d = e.mesh.position.distanceTo(new window.THREE.Vector3(0,0,goalArea.z));
                    if (d > maxDist) { maxDist = d; anchor = e; }
                }
                if (anchor) {
                    const anchorPos = new window.THREE.Vector3(0, 0, goalArea.z - 6);
                    setPlayerTarget(anchor, anchorPos, 5.5);
                }

                // Remaining cover lanes between ball and goal
                for (const e of enemies) {
                    if (e === presser || e === anchor) continue;
                    const lanePos = new window.THREE.Vector3(
                        activePlayer.mesh.position.x * 0.6,
                        0,
                        Math.min(goalArea.z - 10, Math.max(4, activePlayer.mesh.position.z + 6))
                    );
                    setPlayerTarget(e, lanePos, 7.5);
                }
            }
        }
        */
        
        // Defensive AI during pass/shot - make defenders chase and intercept
        // Activar MIENTRAS hay un pase en vuelo (curve exists)
        if (ball && ball.userData.state === 'moving' && curve) {
            const t = Math.min(1, (now - curveStartTime) / curveDuration);
            const enemies = getTeamPlayers(false).filter(e => !e.isGoalkeeper);
            
            if (enemies.length > 0) {
                // Sort by distance to ball
                const sortedEnemies = enemies.slice().sort((a, b) => {
                    const distA = a.mesh.position.distanceTo(ball.position);
                    const distB = b.mesh.position.distanceTo(ball.position);
                    return distA - distB;
                });
                
                // ALWAYS make sure at least 2 defenders go for the ball
                for (let i = 0; i < Math.min(2, sortedEnemies.length); i++) {
                    const defender = sortedEnemies[i];
                    // Go directly to ball's CURRENT position and keep chasing
                    setPlayerTarget(defender, ball.position.clone(), 8);
                }
                
                // Next 1-2 defenders try to intercept on the predicted path
                if (sortedEnemies.length > 2) {
                    for (let i = 2; i < Math.min(4, sortedEnemies.length); i++) {
                        const defender = sortedEnemies[i];
                        // Predict where ball will be and cut it off
                        const predictedBall = curve.getPoint(Math.min(1, t + 0.3)).clone();
                        setPlayerTarget(defender, predictedBall, 7.5);
                    }
                }
                
                // Remaining defenders stay in defensive positions
                for (let i = Math.min(4, sortedEnemies.length); i < sortedEnemies.length; i++) {
                    const defender = sortedEnemies[i];
                    // Stay near goal line
                    const defensivePos = new window.THREE.Vector3(
                        defender.mesh.position.x,
                        0,
                        Math.max(goalArea.z - 15, Math.min(goalArea.z - 5, ball.position.z + 8))
                    );
                    setPlayerTarget(defender, defensivePos, 8);
                }
            }
        }
        
        // ALLY PRESSING AI - when enemy has the ball (paused state)
        // Make allies press and chase when enemy holds possession
        if (gameState === GameState.PAUSED && activePlayer && !activePlayer.isAlly) {
            const allies = getTeamPlayers(true).filter(a => !a.isGoalkeeper);
            
            if (allies.length > 0) {
                // Sort allies by distance to ball holder
                const sortedAllies = allies.slice().sort((a, b) => {
                    const distA = a.mesh.position.distanceTo(activePlayer.mesh.position);
                    const distB = b.mesh.position.distanceTo(activePlayer.mesh.position);
                    return distA - distB;
                });
                
                // Closest 2 allies press the ball aggressively
                for (let i = 0; i < Math.min(2, sortedAllies.length); i++) {
                    const presser = sortedAllies[i];
                    const pressPos = activePlayer.mesh.position.clone();
                    // Don't go past own half too much
                    pressPos.z = Math.max(pressPos.z, -40);
                    setPlayerTarget(presser, pressPos, 9);
                }
                
                // Next 2 allies cover passing lanes
                if (sortedAllies.length > 2) {
                    for (let i = 2; i < Math.min(4, sortedAllies.length); i++) {
                        const coverer = sortedAllies[i];
                        // Position between ball and our goal
                        const coverPos = new window.THREE.Vector3(
                            activePlayer.mesh.position.x * 0.5 + (i - 2.5) * 8,
                            0,
                            Math.max(activePlayer.mesh.position.z - 10, -50)
                        );
                        setPlayerTarget(coverer, coverPos, 7);
                    }
                }
                
                // Remaining allies hold defensive line
                for (let i = Math.min(4, sortedAllies.length); i < sortedAllies.length; i++) {
                    const defender = sortedAllies[i];
                    const defensivePos = new window.THREE.Vector3(
                        defender.mesh.position.x,
                        0,
                        Math.max(-55, activePlayer.mesh.position.z - 15)
                    );
                    setPlayerTarget(defender, defensivePos, 6);
                }
            }
        }
        
        // Update fire particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                scene.remove(p.mesh);
                if (p.mesh.geometry) p.mesh.geometry.dispose();
                if (p.mesh.material) p.mesh.material.dispose();
                particles.splice(i, 1);
                continue;
            }
            // Apply gravity and drag
            p.vel.y -= 6 * dt; // Less gravity for floating effect
            p.vel.multiplyScalar(0.96); // Air resistance
            p.pos.add(p.vel.clone().multiplyScalar(dt));
            p.mesh.position.copy(p.pos);
            // Fade out
            const alpha = p.life / p.maxLife;
            p.mesh.material.opacity = alpha;
            // Scale down
            const scale = (p.scale * alpha);
            p.mesh.scale.set(scale, scale, scale);
        }
        
        renderer.render(scene, camera);
    } catch (e) {
        console.error('Animation loop error:', e);
    }
}

function checkCollisions() {
    if (!ball || !ball.userData) return;
    if (ball.userData.state !== 'moving' && ball.userData.state !== 'free') return;
    const now = performance.now() / 1000;
    
    // Larger radius for 'free' ball, smaller for 'moving'
    const collisionRadius = (ball.userData.state === 'free') ? 2.5 : 2.0;

    // FIRST check for enemy interceptions (defenders get priority)
    for (const p of players) {
        if (p.isAlly) continue; // Skip allies for now
        
        if (ball.userData.issuer && p === ball.userData.issuer && ball.userData.ignoreTime) {
            if (now - ball.userData.ignoreTime < (ball.userData.ignoreDuration || 0.35)) {
                continue;
            }
        }

        // Goalkeeper has slightly larger interception zone for shot-stopping
        let effectiveRadius = (p.isGoalkeeper && ball.userData.state === 'moving') 
            ? Math.max(2.3, collisionRadius * 1.3) // 2.3 units max for keeper saves
            : collisionRadius;
        
        // Enemy field players also get larger radius during moving ball or free ball
        if (!p.isAlly && !p.isGoalkeeper && (ball.userData.state === 'moving' || ball.userData.state === 'free')) {
            effectiveRadius = 2.5; // Easier interception for defenders
        }

        const dist = p.mesh.position.distanceTo(ball.position);
        if (dist <= effectiveRadius) {
            if (p.isGoalkeeper && ball.userData.state === 'moving') {
                setState(GameState.PAUSED);
                messageEl.style.display = 'block';
                messageEl.textContent = '¡PARADA ESPECTACULAR!';
                setTimeout(() => messageEl.style.display = 'none', 1200);
                giveBallTo(p);
                curve = null;
                for (const pl of players) clearPlayerTarget(pl);
                // Restart play after save
                setTimeout(() => resetGame(), 1400);
                return;
            }
            // Defender interception - only for field players, not goalkeeper
            // Intercept both 'moving' passes and 'free' balls
            if (!p.isGoalkeeper && (ball.userData.state === 'moving' || ball.userData.state === 'free')) {
                setState(GameState.GAME_OVER);
                messageEl.style.display = 'block';
                messageEl.textContent = '¡INTERCEPTADO!';
                setTimeout(() => resetGame(), 1600);
                return;
            }
        }
    }
    
    // THEN check for ally receptions
    for (const p of players) {
        if (!p.isAlly) continue; // Skip enemies
        
        if (ball.userData.issuer && p === ball.userData.issuer && ball.userData.ignoreTime) {
            if (now - ball.userData.ignoreTime < (ball.userData.ignoreDuration || 0.35)) {
                continue;
            }
        }

        const collisionRadius2 = (ball.userData.state === 'free') ? 2.5 : 2.0;
        const dist = p.mesh.position.distanceTo(ball.position);
        if (dist <= collisionRadius2) {
            giveBallTo(p);
            setState(GameState.PAUSED);
            removeDrawLine();
            setMessage('¡Pase completado!', 1000);
            curve = null;
            return;
        }
    }
    
    // Check if ball went out of bounds (fuera)
    if (ball.userData.state === 'moving' || ball.userData.state === 'free') {
        // Out of bounds in x or z direction (outside field)
        if (Math.abs(ball.position.x) > fieldBounds.maxX + 2 ||
            ball.position.z < fieldBounds.minZ - 2 ||
            ball.position.z > fieldBounds.maxZ + 2) {
            setState(GameState.GAME_OVER);
            messageEl.style.display = 'block';
            messageEl.textContent = '¡FUERA!';
            setTimeout(() => resetGame(), 1400);
            return;
        }
    }
}

function showGoalAndNext() {
    messageEl.style.display = 'block';
    messageEl.textContent = '¡¡¡GOLAZO!!!';
    // Update score counter
    const scoreEl = document.getElementById('scoreCount');
    if (scoreEl) {
        scoreCount += 1;
        scoreEl.textContent = String(scoreCount);
    }
    setTimeout(() => resetGame(), 1200);
}

function setMessage(txt, ms = 900) {
    const prev = stateEl.textContent;
    stateEl.textContent = txt;
    setTimeout(() => { stateEl.textContent = prev; }, ms);
}

function setState(s) {
    gameState = s;
    stateEl.textContent = s;
}

function resetGame() {
    for (const p of players) {
        if (p.mesh) scene.remove(p.mesh);
    }
    players = [];
    if (ball) scene.remove(ball);
    removeDrawLine();
    firstPassMade = false;
    createInitialActors();
    setState(GameState.PAUSED);
    messageEl.style.display = 'none';
}

function onWindowResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (camera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    if (renderer) {
        renderer.setSize(w, h);
    }
}
