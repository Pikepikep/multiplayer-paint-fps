// Import Three.js components
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Initialize socket connection
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Add connection status handling
socket.on('connect', () => {
    console.log('Connected to server');
    if (gameStarted && playerBody) {
        // Rejoin game if we were already playing
        socket.emit('joinGame', {
            team: playerTeam,
            position: [camera.position.x, camera.position.y - 1.7, camera.position.z],
            rotation: camera.rotation.y
        });
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Global variables
let scene, camera, renderer, controls, weapon;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isJumping = false, canJump = true;
let isSprinting = false;  // Add sprint state
let playerTeam = null;
let playerHits = 0;
let paintSurfaces = [];
let lastShotTime = 0;
let gameStarted = false;  // Add gameStarted variable
const SHOT_COOLDOWN = 250; // Reduced from 500ms to 250ms for more responsive shooting
const BASE_SPEED = 20;     // Increased from 5 to 20 for faster movement
const SPRINT_MULTIPLIER = 1.6; // Slightly increased sprint multiplier
const PLAYER_HEIGHT = 1.7; // Player height in units
let playerBody;
let playerHitbox;
let otherPlayers = new Map(); // Store other players' models
let paintProjectiles = [];
const PAINT_SPEED = 75; // Increased from 50 to 75 for faster projectiles
const PAINT_LIFETIME = 2000; // Maximum lifetime of paint projectile in ms
let obstacles = [];
let playerVelocity = new THREE.Vector3();
const GRAVITY = -20;
let isOnGround = false;

// Move clock initialization to top with other globals
let clock = new THREE.Clock();

// Add these variables at the top with other globals
let isFalling = false;
let fallStartTime = 0;
const FALL_RESPAWN_DELAY = 2000; // 2 seconds in milliseconds
const FALL_THRESHOLD = -50; // Y position that triggers respawn

// Add after the global variables
let minimapCamera;
const MINIMAP_SIZE = 400;  // Increased from 300 to 400 to match coverage display width
const PAINT_GRID_SIZE = 50;
let paintGrid = new Array(PAINT_GRID_SIZE * PAINT_GRID_SIZE).fill(null);
let redCoverage = 0;
let blueCoverage = 0;
let frameCount = 0;  // Initialize frameCount

// Add to global variables at the top
const SPLAT_RADIUS = 0.7;  // Reduced from 1.0
const SPLAT_HEIGHT = 0.2;  // New constant for height
const OVERLAP_THRESHOLD = 0.7;
let paintSplats = [];

// Add these at the top with other constants
const PAINT_PROJECTILE_GEOMETRY = new THREE.SphereGeometry(0.2, 16, 16);
const PAINT_PROJECTILE_RED = new THREE.MeshBasicMaterial({ 
    color: 0xFF0000,  // Pure red
    transparent: true,
    opacity: 0.5,     // Increased from 0.4 to 0.5
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,  // Add additive blending for smoother effect
    toneMapped: false,  // Prevent tone mapping
    premultipliedAlpha: true  // Better transparency handling
});
const PAINT_PROJECTILE_BLUE = new THREE.MeshBasicMaterial({ 
    color: 0x0000FF,  // Pure blue
    transparent: true,
    opacity: 0.5,     // Increased from 0.4 to 0.5
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,  // Add additive blending for smoother effect
    toneMapped: false,  // Prevent tone mapping
    premultipliedAlpha: true  // Better transparency handling
});

// Add at the top with other global variables
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let joystickTouch = null;
let lookTouch = null;
let joystickPosition = { x: 0, y: 0 };
let lookDelta = { x: 0, y: 0 };

// Add at the top with other global variables
const PORTAL_RADIUS = 2;
const PORTAL_HEIGHT = 4;
let portal;
let portalParticles = [];
let portalLight;
let isInPortal = false;

// Add pause menu state
let isPaused = false;

// Add at the top with other global variables
let lastJumpTime = 0;
const JUMP_COOLDOWN = 100; // 100ms cooldown between jumps

// Add after the other global variables
let brickModels = [];

// Add to global variables at the top
let skybox;

// Add pause menu HTML
function createPauseMenu() {
    const pauseMenu = document.createElement('div');
    pauseMenu.id = 'pauseMenu';
    pauseMenu.className = 'hidden';
    pauseMenu.innerHTML = `
        <div class="pause-content">
            <h2>Game Paused</h2>
            <p>Click outside to resume</p>
        </div>
    `;
    document.body.appendChild(pauseMenu);

    // Add styles with transitions
    const style = document.createElement('style');
    style.textContent = `
        #pauseMenu {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.1s ease-out;
        }
        #pauseMenu:not(.hidden) {
            opacity: 1;
        }
        #pauseMenu.hidden {
            display: none;
        }
        .pause-content {
            background-color: rgba(0, 0, 0, 0.8);
            padding: 2rem;
            border-radius: 10px;
            color: white;
            text-align: center;
            transform: scale(0.95);
            transition: transform 0.1s ease-out;
        }
        #pauseMenu:not(.hidden) .pause-content {
            transform: scale(1);
        }
        .pause-content h2 {
            margin: 0 0 1rem 0;
            font-size: 2rem;
        }
        .pause-content p {
            margin: 0;
            font-size: 1.2rem;
        }
    `;
    document.head.appendChild(style);
}

// Add pause menu functions
function showPauseMenu() {
    if (!isPaused) {
        isPaused = true;
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.classList.remove('hidden');
            // Force a reflow to ensure the transition works
            pauseMenu.offsetHeight;
        }
        showCursor();
        if (controls) {
            controls.unlock();
        }
    }
}

function hidePauseMenu() {
    if (isPaused) {
        isPaused = false;
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.classList.add('hidden');
            // Force a reflow to ensure the transition works
            pauseMenu.offsetHeight;
        }
        if (gameStarted) {
            hideCursor();
            if (controls) {
                controls.lock();
                // Reset controls state
                controls.targetRotation.set(0, camera.rotation.y, 0);
                controls.currentVerticalRotation = -camera.rotation.x;
            }
        }
    }
}

// Create PointerLockControls
class PointerLockControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        this.isLocked = false;
        this.minVerticalAngle = -Math.PI / 2;
        this.maxVerticalAngle = Math.PI / 2;

        this.currentVerticalRotation = 0;
        this.targetRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.quaternion = new THREE.Quaternion();

        this.PI_2 = Math.PI / 2;

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onPointerlockChange = this.onPointerlockChange.bind(this);
        this.onPointerlockError = this.onPointerlockError.bind(this);

        this.connect();
    }

    connect() {
        if (!isMobile) {
            this.domElement.ownerDocument.addEventListener('mousemove', this.onMouseMove);
        }
        this.domElement.ownerDocument.addEventListener('pointerlockchange', this.onPointerlockChange);
        this.domElement.ownerDocument.addEventListener('pointerlockerror', this.onPointerlockError);
    }

    disconnect() {
        if (!isMobile) {
            this.domElement.ownerDocument.removeEventListener('mousemove', this.onMouseMove);
        }
        this.domElement.ownerDocument.removeEventListener('pointerlockchange', this.onPointerlockChange);
        this.domElement.ownerDocument.removeEventListener('pointerlockerror', this.onPointerlockError);
    }

    dispose() {
        this.disconnect();
    }

    getObject() {
        return this.camera;
    }

    onMouseMove(event) {
        if (!this.isLocked) return;

        const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        this.targetRotation.y -= movementX * 0.002;
        this.currentVerticalRotation -= movementY * 0.002;
        this.currentVerticalRotation = Math.max(
            -this.maxVerticalAngle,
            Math.min(this.maxVerticalAngle, this.currentVerticalRotation)
        );
        this.targetRotation.x = this.currentVerticalRotation;
    }

    onPointerlockChange() {
        if (this.domElement.ownerDocument.pointerLockElement === this.domElement) {
            this.dispatchEvent({ type: 'lock' });
            this.isLocked = true;
        } else {
            this.dispatchEvent({ type: 'unlock' });
            this.isLocked = false;
        }
    }

    onPointerlockError() {
        console.error('PointerLockControls: Unable to use Pointer Lock API');
    }

    lock() {
        if (isMobile) {
            this.isLocked = true;
            this.dispatchEvent({ type: 'lock' });
        } else {
            this.domElement.requestPointerLock();
        }
    }

    unlock() {
        if (isMobile) {
            this.isLocked = false;
            this.dispatchEvent({ type: 'unlock' });
        } else {
            this.domElement.ownerDocument.exitPointerLock();
        }
    }

    update() {
        this.quaternion.setFromEuler(this.targetRotation);
        this.camera.quaternion.copy(this.quaternion);
    }

    dispatchEvent(event) {
        if (this.domElement.dispatchEvent) {
            this.domElement.dispatchEvent(new CustomEvent(event.type));
        }
    }
}

function createPlayerModel(color) {
    return new Promise((resolve, reject) => {
        const group = new THREE.Group();

        // Load both bear and brush models simultaneously
        Promise.all([
            // Load bear model
            new Promise((resolveBear, rejectBear) => {
                const loader = new GLTFLoader();
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
                loader.setDRACOLoader(dracoLoader);
                
                loader.load('models/bear.gltf', 
                    (gltf) => resolveBear(gltf),
                    (progress) => console.log('Loading bear progress:', (progress.loaded / progress.total * 100) + '%'),
                    (error) => rejectBear(error)
                );
            }),
            // Load brush model
            new Promise((resolveBrush, rejectBrush) => {
                const loader = new GLTFLoader();
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
                loader.setDRACOLoader(dracoLoader);
                
                loader.load('models/model.gltf', 
                    (gltf) => resolveBrush(gltf),
                    (progress) => console.log('Loading brush progress:', (progress.loaded / progress.total * 100) + '%'),
                    (error) => rejectBrush(error)
                );
            })
        ]).then(([bearGltf, brushGltf]) => {
            // Process bear model
            const bearModel = bearGltf.scene;
            bearModel.position.set(0, 0, 0);
            bearModel.rotation.set(0, Math.PI, 0); // Bear faces forward
            bearModel.scale.set(2, 2, 2);
            group.add(bearModel);

            // Create hitbox for the player
            const hitboxGeometry = new THREE.BoxGeometry(HITBOX_WIDTH, HITBOX_HEIGHT, HITBOX_DEPTH);
            const hitboxMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.0, // Invisible hitbox
                depthWrite: false
            });
            const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
            hitbox.position.y = HITBOX_HEIGHT / 2; // Center vertically
            hitbox.userData.isHitbox = true;
            hitbox.userData.team = color === 0xff0000 ? 'red' : 'blue';
            hitbox.userData.parentModel = group;
            group.userData.hitbox = hitbox;
            group.add(hitbox);

            // Process brush model
            const brushModel = brushGltf.scene;
            brushModel.scale.set(0.5, 0.5, 0.5);
            brushModel.position.set(1.5, 1.0, -0.8);
            brushModel.rotation.set(0, Math.PI / 2, Math.PI / 6);
            group.add(brushModel);

            // Store the brush model reference
            group.userData.brushModel = brushModel;
            
            // Apply materials if color is provided
            if (color) {
                // Create materials once and reuse them
                const teamMaterial = new THREE.MeshStandardMaterial({
                    color: color,
                    side: THREE.DoubleSide,
                    transparent: false,
                    opacity: 1.0,
                    depthTest: true,
                    depthWrite: true,
                    shadowSide: THREE.FrontSide,
                    metalness: 0.1,
                    roughness: 0.8
                });

                const blackMaterial = new THREE.MeshStandardMaterial({
                    color: 0x000000,
                    side: THREE.DoubleSide,
                    transparent: false,
                    opacity: 1.0,
                    depthTest: true,
                    depthWrite: true,
                    shadowSide: THREE.FrontSide,
                    metalness: 0.1,
                    roughness: 0.8
                });

                // Apply materials to bear model
                bearModel.traverse((child) => {
                    if (child.isMesh) {
                        // Enable shadows for each mesh
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Apply materials based on mesh type
                        const isHeadPart = child.geometry && (
                            child.geometry.name === 'Cube.1337' ||
                            child.name === 'Cube.1337' ||
                            child.name.includes('Cube1337')
                        );

                        if (isHeadPart && child.material && child.material.name === 'Black.025') {
                            child.material = blackMaterial;
                        } else {
                            child.material = teamMaterial.clone();
                        }
                        child.material.needsUpdate = true;
                    }
                });

                // Apply materials to brush model
                brushModel.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        if (child.material && child.material.name === '039BE5') {
                            // Tip mesh - team colored
                            child.material = new THREE.MeshStandardMaterial({
                                color: color,
                                metalness: 0.5,
                                roughness: 0.5,
                                emissive: color,
                                emissiveIntensity: 0.5
                            });
                        } else if (child.position.y < 0 || child.name.toLowerCase().includes('handle')) {
                            // Handle - light brown
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x8B4513,
                                metalness: 0.3,
                                roughness: 0.7
                            });
                        } else {
                            // Main brush body - cyan
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x00FFFF,
                                metalness: 0.4,
                                roughness: 0.6
                            });
                        }
                    }
                });
            }

            // Store references and ensure visibility
            group.userData.model = bearModel;
            group.visible = true;
            bearModel.traverse(child => child.visible = true);
            brushModel.traverse(child => child.visible = true);

            resolve(group);
        }).catch(error => {
            console.error('Error loading models:', error);
            reject(error);
        });
    });
}

// Add these constants at the top with other constants
const PLAYER_CIRCLE_RADIUS = 1.0;
const PLAYER_CIRCLE_SEGMENTS = 32;
const HITBOX_WIDTH = 2.0;  // Width of the player hitbox
const HITBOX_HEIGHT = 3.0; // Height of the player hitbox (matches bear model height)
const HITBOX_DEPTH = 2.0;  // Depth of the player hitbox

// Modify createWeaponModel function to add the circle
function createWeaponModel() {
    return new Promise((resolve, reject) => {
        const group = new THREE.Group();

        // Create circle for minimap representation
        const circleGeometry = new THREE.CircleGeometry(PLAYER_CIRCLE_RADIUS, PLAYER_CIRCLE_SEGMENTS);
        const circleMaterial = new THREE.MeshBasicMaterial({
            color: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
            side: THREE.DoubleSide
        });
        const playerCircle = new THREE.Mesh(circleGeometry, circleMaterial);
        playerCircle.rotation.x = -Math.PI / 2; // Lay flat
        playerCircle.position.y = -1.7; // Position at player's feet (offset by player height)
        group.add(playerCircle);

        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);
        
        loader.load('models/model.gltf', 
            (gltf) => {
                console.log('Brush model loaded successfully:', gltf);
                const model = gltf.scene;
                
                // Reset transformations
                model.position.set(0, 0, 0);
                model.rotation.set(0, 0, 0);
                model.scale.set(1, 1, 1);
                
                // Scale for FPS view
                model.scale.set(0.8, 0.8, 0.8);
                
                // Position for FPS view - bottom right corner, moved slightly right
                model.position.set(1.2, -0.5, -1.0);
                
                // Rotate brush to show the team-colored tip
                model.rotation.set(0, Math.PI - Math.PI/3, 0);
                
                group.add(model);
                
                // Apply materials
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.visible = true;
                        child.castShadow = true;
                        child.receiveShadow = true;

                        if (child.material && child.material.name === '039BE5') {
                            // Tip mesh - team colored
                            child.material = new THREE.MeshStandardMaterial({
                                color: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
                                metalness: 0.5,
                                roughness: 0.5,
                                emissive: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
                                emissiveIntensity: 0.5
                            });
                        } else if (child.position.y < 0 || child.name.toLowerCase().includes('handle')) {
                            // Handle - light brown
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x8B4513,
                                metalness: 0.3,
                                roughness: 0.7
                            });
                        } else {
                            // Main brush body - cyan
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x00FFFF,
                                metalness: 0.4,
                                roughness: 0.6
                            });
                        }
                    }
                });
                
                // Add tip mesh for projectile origin
                const tipMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.08, 12, 12),
                    new THREE.MeshStandardMaterial({ 
                        color: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
                        metalness: 0.5,
                        roughness: 0.5,
                        emissive: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
                        emissiveIntensity: 0.5
                    })
                );
                tipMesh.position.set(0, 0, 2.0);
                group.add(tipMesh);
                group.userData.tipMesh = tipMesh;

                resolve(group);
            },
            (progress) => {
                console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
            },
            (error) => {
                console.error('Error loading brush model:', error);
                reject(error);
            }
        );
    });
}

function showCursor() {
    renderer.domElement.style.cursor = 'default';
    document.body.style.cursor = 'default';
}

function hideCursor() {
    renderer.domElement.style.cursor = 'none';
    document.body.style.cursor = 'none';
}

function init() {
    console.log("Starting game initialization...");
    
    try {
        // Add contest link
        const contestLink = document.createElement('a');
        contestLink.href = 'https://jam.pieter.com';
        contestLink.target = '_blank';
        contestLink.innerHTML = '🕹️ Vibe Jam 2025';
        contestLink.style.cssText = `
            font-family: 'system-ui', sans-serif;
            position: fixed;
            bottom: -1px;
            right: -1px;
            padding: 7px;
            font-size: 14px;
            font-weight: bold;
            background: #fff;
            color: #000;
            text-decoration: none;
            border-top-left-radius: 12px;
            z-index: 10000;
            border: 1px solid #fff;
        `;
        document.body.appendChild(contestLink);

        // Create pause menu
        createPauseMenu();
        
        // Reset frame count
        frameCount = 0;

        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        console.log("Scene created");

        // Add clouds to the scene
        createClouds();
        console.log("Clouds added to scene");

        // Create world first to set up obstacles
        createWorld();
        console.log("World created");

        // Main camera setup
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const spawnPoint = getRandomSpawnPoint();
        // Set camera position at player height (1.7 units above ground)
        camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
        camera.rotation.y = spawnPoint.rotation;  // Set initial rotation to face center
        scene.add(camera);  // Add camera to scene immediately
        console.log("Camera created and positioned at spawn point:", spawnPoint);

        // Minimap camera setup
        minimapCamera = new THREE.OrthographicCamera(
            -50, 50,    // Left, Right - Increased from 25 to 50
            50, -50,    // Top, Bottom - Increased from 25 to 50
            1, 1000     // Near, Far
        );
        minimapCamera.position.set(0, 100, 0);  // Increased height for better overview
        minimapCamera.lookAt(0, 0, 0);
        minimapCamera.rotation.z = Math.PI;
        minimapCamera.zoom = 1;  // Adjusted zoom for better coverage
        minimapCamera.updateProjectionMatrix();
        scene.add(minimapCamera);
        console.log("Minimap camera created");

        // Renderer setup
        renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: "high-performance",
            precision: "highp"
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setClearColor(0x87CEEB, 1);
        renderer.autoClear = false;
        document.body.appendChild(renderer.domElement);
        console.log("Renderer created and configured");

        // Start the clock
        clock.start();
        console.log("Clock started");

        // Show cursor initially for team selection
        showCursor();
        console.log("Cursor shown");

        // Add crosshair
        const crosshair = document.createElement('div');
        crosshair.className = 'crosshair';
        const horizontalLine = document.createElement('div');
        horizontalLine.className = 'crosshair-line crosshair-horizontal';
        const verticalLine = document.createElement('div');
        verticalLine.className = 'crosshair-line crosshair-vertical';
        crosshair.appendChild(horizontalLine);
        crosshair.appendChild(verticalLine);
        document.body.appendChild(crosshair);
        console.log("Crosshair added");

        // Initialize controls
        controls = new PointerLockControls(camera, document.body);
        console.log("Controls initialized");

        // Set up event listeners
        window.addEventListener('keydown', onKeyDown, false);
        window.addEventListener('keyup', onKeyUp, false);
        window.addEventListener('click', onMouseClick, false);
        window.addEventListener('resize', onWindowResize, false);
        console.log("Event listeners attached");

        // Initialize mobile controls if needed
        if (isMobile) {
            initMobileControls();
        }

        // Handle portal spawn if coming from another game
        handlePortalSpawn();

        // Render initial frame
        renderer.render(scene, camera);
        console.log("Initial frame rendered");

        console.log("Game initialization completed successfully");
    } catch (error) {
        console.error("Error during initialization:", error);
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '50%';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translate(-50%, -50%)';
        errorDiv.style.textAlign = 'center';
        errorDiv.innerHTML = `Game failed to initialize: ${error.message}<br>Please check the console for details.`;
        document.body.appendChild(errorDiv);
    }
}

function createWorld() {
    // Only store camera before clearing
    const tempCamera = camera;

    // Clear any existing objects
    while(scene.children.length > 0) { 
        scene.remove(scene.children[0]); 
    }
    obstacles = []; // Clear obstacles array

    // Add back camera
    if (tempCamera) {
        scene.add(tempCamera);
    }

    // Add ambient light for overall scene illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Increased from 0.5 to 0.7
    scene.add(ambientLight);

    // Add main directional light for primary shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7); // Reduced from 1.0 to 0.7
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;  // Increased for better shadow quality
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    directionalLight.shadow.bias = -0.001;  // Reduce shadow acne
    directionalLight.shadow.radius = 2;     // Add shadow blur
    scene.add(directionalLight);

    // Add secondary directional light from opposite direction
    const secondaryLight = new THREE.DirectionalLight(0xffffff, 0.5);
    secondaryLight.position.set(-5, 3, -5); // Opposite position to main light
    secondaryLight.castShadow = false;      // No shadows from secondary light
    scene.add(secondaryLight);

    // Add subtle hemisphere light for more natural ambient lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.3);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    // Create floor with pure white color and collision - exactly matching wall boundaries
    const floorGeometry = new THREE.PlaneGeometry(100, 100);
    const floorMaterial = new THREE.MeshBasicMaterial({ 
        color: new THREE.Color(1, 1, 1),
        side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;  // Ensure floor is at y=0
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Add floor collision box
    const floorBox = new THREE.Box3().setFromObject(floor);
    obstacles.push({ mesh: floor, box: floorBox });

    // Create and add obstacles with light gray color
    const obstacleDefinitions = [
        { pos: [10, 2, 10], size: [2, 4, 2] },
        { pos: [-10, 2, -10], size: [2, 4, 2] },
        { pos: [0, 2, 15], size: [4, 4, 2] },
        { pos: [-5, 2, 5], size: [3, 4, 3] }
    ];

    obstacleDefinitions.forEach(obs => {
        const geometry = new THREE.BoxGeometry(...obs.size);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xcccccc,
            metalness: 0.3,
            roughness: 0.7
        });
        const obstacle = new THREE.Mesh(geometry, material);
        obstacle.position.set(...obs.pos);
        obstacle.castShadow = true;
        obstacle.receiveShadow = true;
        scene.add(obstacle);
        
        // Add collision box
        const box = new THREE.Box3().setFromObject(obstacle);
        obstacles.push({ mesh: obstacle, box: box });
    });

    // Create solid material for structures
    const structureColor = 0x808080;  // Base gray color
    const structureMaterial = new THREE.MeshStandardMaterial({
        color: structureColor,
        metalness: 0.3,
        roughness: 0.7,
        side: THREE.DoubleSide
    });

    // Center structure
    const centerRect = new THREE.Mesh(
        new THREE.BoxGeometry(10, 8, 10),
        structureMaterial.clone()
    );
    centerRect.position.set(0, 4, 0);
    centerRect.userData.isStructure = true;  // Mark as non-paintable
    centerRect.castShadow = true;
    centerRect.receiveShadow = true;
    scene.add(centerRect);
    
    // Add collision box for center structure
    const centerBox = new THREE.Box3().setFromObject(centerRect);
    obstacles.push({ mesh: centerRect, box: centerBox });

    // Ensure the floor is properly positioned and visible
    floor.position.y = 0;
    floor.visible = true;
    floor.material.transparent = false;
    floor.material.opacity = 1;

    // Add brick structures
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);

    // Define fixed positions for bricks
    const brickPositions = [
        { x: 20, z: 20, rotation: Math.PI / 6 },    // Northeast quadrant
        { x: -20, z: 20, rotation: -Math.PI / 4 },  // Northwest quadrant
        { x: -20, z: -20, rotation: Math.PI / 3 },  // Southwest quadrant
        { x: 20, z: -20, rotation: -Math.PI / 6 }   // Southeast quadrant
    ];

    // Create bricks at fixed positions
    const brickPromises = brickPositions.map(pos => {
        return new Promise((resolve, reject) => {
            loader.load('models/brick.gltf',
                (gltf) => {
                    const brick = gltf.scene;
                    
                    // Position and rotate the brick
                    brick.position.set(pos.x, 0, pos.z);
                    brick.rotation.y = pos.rotation;
                    brick.scale.set(3, 3, 3);

                    // Enable shadows
                    brick.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    scene.add(brick);
                    brickModels.push(brick);

                    // Add collision box
                    const box = new THREE.Box3().setFromObject(brick);
                    obstacles.push({ mesh: brick, box: box });

                    resolve();
                },
                undefined,
                (error) => {
                    console.error('Error loading brick model:', error);
                    reject(error);
                }
            );
        });
    });

    // Wait for all bricks to be loaded
    Promise.all(brickPromises).then(() => {
        console.log('All brick models loaded successfully');
    }).catch(error => {
        console.error('Error loading brick models:', error);
    });

    // Create portal
    createPortal();
}

function onMouseClick() {
    if (!playerTeam || !controls.isLocked) return;
    shootPaint();
}

function shootPaint() {
    const currentTime = Date.now();
    if (currentTime - lastShotTime < SHOT_COOLDOWN) return;
    lastShotTime = currentTime;

    // Get the weapon model from camera's children
    const weaponModel = camera.children.find(child => child.userData && child.userData.tipMesh);
    
    // Get the world position of the weapon model
    let projectileOrigin = new THREE.Vector3();
    if (weaponModel) {
        // Get the world position of the weapon model
        weaponModel.getWorldPosition(projectileOrigin);
        console.log('Weapon model world position:', projectileOrigin);
    } else {
        // Fallback to camera position if weapon model not found
        camera.getWorldPosition(projectileOrigin);
        console.log('Using camera position fallback:', projectileOrigin);
    }
    
    // Get the direction the camera is facing
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    // Create paint projectile using blob geometry
    const paintBlob = new THREE.Mesh(
        PAINT_PROJECTILE_GEOMETRY,
        playerTeam === 'red' ? PAINT_PROJECTILE_RED : PAINT_PROJECTILE_BLUE
    );

    // Add random rotation to make blobs look more varied
    paintBlob.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
    );
    
    paintBlob.position.copy(projectileOrigin);
    
    // Add to scene and store projectile data
    scene.add(paintBlob);
    paintProjectiles.push({
        mesh: paintBlob,
        direction: direction,
        startPosition: projectileOrigin.clone(),
        distanceTraveled: 0,
        team: playerTeam,
        startTime: currentTime,
        fadeInDuration: 100
    });
}

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'ShiftLeft': isSprinting = true; break;
        case 'ShiftRight': isSprinting = true; break;
        case 'Space':
            const currentTime = Date.now();
            if (isOnGround && currentTime - lastJumpTime >= JUMP_COOLDOWN) {
                playerVelocity.y = 8; // Jump velocity
                isOnGround = false;
                lastJumpTime = currentTime;
            }
            break;
        case 'Escape':
            if (gameStarted && !isPaused) {
                showPauseMenu();
            }
            break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'ShiftLeft': isSprinting = false; break;
        case 'ShiftRight': isSprinting = false; break;
    }
}

function onWindowResize() {
    // Update main camera
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    // Update minimap camera to maintain square aspect ratio
    minimapCamera.left = -50;   // Increased from -25 to -50
    minimapCamera.right = 50;   // Increased from 25 to 50
    minimapCamera.top = 50;     // Increased from 25 to 50
    minimapCamera.bottom = -50; // Increased from -25 to -50
    minimapCamera.zoom = 1;     // Maintain zoom level on resize
    minimapCamera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Modify the updatePlayerMovement function to handle jumping
function updatePlayerMovement(delta) {
    // Calculate movement speed
    const SPEED = isSprinting ? BASE_SPEED * SPRINT_MULTIPLIER : BASE_SPEED;

    // Apply gravity
    playerVelocity.y += GRAVITY * delta;

    // Update position with gravity
    camera.position.y += playerVelocity.y * delta;

    // Check for ground collision with the white floor
    const floorObstacle = obstacles[0]; // The white floor is always the first obstacle
    if (floorObstacle) {
        const floorBox = floorObstacle.box;
        const playerPosition = camera.position.clone();
        
        // Check if player is above the floor bounds
        const isAboveFloor = (
            playerPosition.x >= floorBox.min.x &&
            playerPosition.x <= floorBox.max.x &&
            playerPosition.z >= floorBox.min.z &&
            playerPosition.z <= floorBox.max.z
        );

        if (isAboveFloor && camera.position.y <= PLAYER_HEIGHT) {
            // Player is above the floor and at or below player height
            camera.position.y = PLAYER_HEIGHT;
            playerVelocity.y = 0;
            isOnGround = true;
            isFalling = false;
        } else if (!isAboveFloor) {
            // Player is outside floor bounds, initiate falling
            isOnGround = false;
            
            if (!isFalling) {
                // Start falling timer
                isFalling = true;
                fallStartTime = Date.now();
                console.log('Player started falling');
            } else if (Date.now() - fallStartTime >= FALL_RESPAWN_DELAY) {
                // After 2 seconds of falling, respawn
                console.log('Respawning after fall');
                respawn();
                return;
            }
        }
    }

    // Get movement direction
    if (isMobile && joystickPosition) {
        direction.x = -joystickPosition.x;
        direction.z = -joystickPosition.y;
    } else {
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveLeft) - Number(moveRight);
    }

    // Only normalize if there's actual movement
    if (direction.x !== 0 || direction.z !== 0) {
        direction.normalize();
        
        const potentialPosition = camera.position.clone();
        
        const forward = new THREE.Vector3();
        forward.setFromMatrixColumn(camera.matrix, 2);
        forward.y = 0;
        forward.normalize();
        
        const right = new THREE.Vector3();
        right.setFromMatrixColumn(camera.matrix, 0);
        right.y = 0;
        right.normalize();
        
        potentialPosition.add(forward.multiplyScalar(-direction.z * SPEED * delta));
        potentialPosition.add(right.multiplyScalar(-direction.x * SPEED * delta));

        // Create player collision box
        const playerBox = new THREE.Box3();
        const PLAYER_RADIUS = 0.3;
        playerBox.min.set(
            potentialPosition.x - PLAYER_RADIUS,
            potentialPosition.y - 2,
            potentialPosition.z - PLAYER_RADIUS
        );
        playerBox.max.set(
            potentialPosition.x + PLAYER_RADIUS,
            potentialPosition.y,
            potentialPosition.z + PLAYER_RADIUS
        );

        // Check collision with obstacles (excluding the floor)
        let collision = false;
        for (let i = 1; i < obstacles.length; i++) {
            if (playerBox.intersectsBox(obstacles[i].box)) {
                collision = true;
                break;
            }
        }

        // Move if no collision
        if (!collision) {
            camera.position.copy(potentialPosition);
        }
    }

    // Update invisible player body position to match camera
    if (playerBody) {
        playerBody.position.set(
            camera.position.x,
            camera.position.y - PLAYER_HEIGHT,
            camera.position.z
        );
        playerBody.rotation.y = camera.rotation.y;
        
        // Send position update to server
        socket.emit('updatePosition', {
            position: [playerBody.position.x, playerBody.position.y, playerBody.position.z],
            rotation: camera.rotation.y,
            animationState: {
                isMoving: direction.x !== 0 || direction.z !== 0,
                isSprinting: isSprinting,
                isJumping: !isOnGround,
                animationTime: Date.now() / 1000
            }
        });
    }
}

// Socket event handlers
socket.on('paintSurface', (data) => {
    if (!data || !data.position || !data.team) {
        console.error('Invalid paint surface data received:', data);
        return;
    }

    const position = new THREE.Vector3().fromArray(data.position);
    const normal = new THREE.Vector3().fromArray(data.normal);
    
    // Create flattened spherical paint splat using ellipsoid geometry
    const segments = 16;
    const paintGeometry = new THREE.SphereGeometry(SPLAT_RADIUS, segments, segments/2);
    paintGeometry.scale(1, SPLAT_HEIGHT, 1); // Flatten the sphere into an ellipsoid
    
    const paintMaterial = new THREE.MeshBasicMaterial({ 
        color: data.team === 'red' ? 0xff0000 : 0x0000ff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
    });
    
    const paintBlob = new THREE.Mesh(paintGeometry, paintMaterial);
    paintBlob.renderOrder = 1;  // Set renderOrder on the mesh
    paintBlob.position.copy(position);
    
    // Add a small offset in the Y direction to prevent z-fighting
    paintBlob.position.y += 0.01;
    
    // Always rotate flat around X axis first
    paintBlob.rotation.x = -Math.PI / 2;
    
    // Only apply additional rotation for non-horizontal surfaces
    const normalVector = new THREE.Vector3().copy(normal);
    if (Math.abs(normalVector.y) < 0.99) {  // If not a horizontal surface
        // Create a quaternion for the additional rotation
        const quaternion = new THREE.Quaternion();
        const upVector = new THREE.Vector3(0, 1, 0);
        
        // Calculate the angle between the up vector and the normal
        const angle = Math.acos(upVector.dot(normalVector));
        
        // Create a rotation axis perpendicular to both vectors
        const axis = new THREE.Vector3().crossVectors(upVector, normalVector);
        axis.normalize();
        
        // Set the quaternion rotation
        quaternion.setFromAxisAngle(axis, angle);
        
        // Apply the additional rotation
        paintBlob.quaternion.premultiply(quaternion);
    }
    
    // Store additional data with the paint splat
    paintBlob.userData.team = data.team;
    paintBlob.userData.radius = SPLAT_RADIUS;
    
    scene.add(paintBlob);
    paintSplats.push(paintBlob);
    
    updatePaintCoverage();
});

socket.on('hit', (data) => {
    console.log('Hit received from server with data:', data);
    if (data.currentHits !== undefined) {
        playerHits = data.currentHits;
        // Update the hits display
        const hitsDisplay = document.getElementById('hits');
        if (hitsDisplay) {
            hitsDisplay.textContent = `Hits: ${playerHits}/3`;
        }
    }
    
    // Visual feedback for being hit
    if (playerBody) {
        // Flash the player model red briefly
        const flashDuration = 200; // 200ms flash
        const originalColors = new Map();
        
        // Store original colors and set flash color
        playerBody.traverse((child) => {
            if (child.material && child.material.color) {
                originalColors.set(child, child.material.color.clone());
                child.material.color.setHex(0xff0000);
            }
        });

        // Reset colors after flash duration
        setTimeout(() => {
            playerBody.traverse((child) => {
                if (originalColors.has(child)) {
                    child.material.color.copy(originalColors.get(child));
                }
            });
        }, flashDuration);

        // Create hit effect at the hit position if provided
        if (data.hitPosition) {
            const hitEffect = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 8, 8),
                new THREE.MeshBasicMaterial({
                    color: 0xffff00,
                    transparent: true,
                    opacity: 0.8
                })
            );
            hitEffect.position.fromArray(data.hitPosition);
            scene.add(hitEffect);
            setTimeout(() => scene.remove(hitEffect), flashDuration);
        }
    }
    
    if (playerHits >= 3) {
        console.log('Player reached 3 hits, respawning...');
        respawn();
    }
});

socket.on('respawn', () => {
    console.log('Received respawn event from server');
    respawn();
});

function respawn() {
    // Get spawn position
    const spawnPoint = getRandomSpawnPoint();
    
    // Set camera position and rotation
    camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    camera.rotation.set(0, spawnPoint.rotation, 0);
    
    // Update controls rotation if they exist and have the required properties
    if (controls) {
        if (controls.targetRotation) {
            controls.targetRotation.set(0, spawnPoint.rotation, 0);
        }
        if (controls.currentRotation) {
            controls.currentRotation.set(0, spawnPoint.rotation, 0);
        }
        // Reset movement
        if (typeof controls.moveRight === 'function') {
            controls.moveRight(0);
        }
        if (typeof controls.moveForward === 'function') {
            controls.moveForward(0);
        }
    }
    
    if (playerBody) {
        playerBody.position.set(spawnPoint.x, 0, spawnPoint.z);
        playerBody.rotation.y = spawnPoint.rotation;
    }
    
    // Reset player state
    playerHits = 0;
    document.getElementById('hits').textContent = 'Hits: 0/3';
    
    // Reset falling state
    isFalling = false;
    fallStartTime = 0;
    playerVelocity.set(0, 0, 0);
    isOnGround = true;
    
    // Only remove paint blobs, preserve player body and camera
    const objectsToKeep = [camera, playerBody];
    scene.children = scene.children.filter(child => 
        objectsToKeep.includes(child) || 
        !(child instanceof THREE.Mesh && child.material.transparent)
    );
    
    createWorld();
    
    // Show cursor and unlock controls for team selection
    showCursor();
    if (controls) {
        controls.unlock();
    }
    
    // Show team selection screen
    document.getElementById('teamSelection').classList.remove('hidden');
    document.getElementById('gameUI').classList.add('hidden');
}

// Event listeners for team buttons
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Content Loaded");
    const redTeamBtn = document.getElementById("redTeamBtn");
    const blueTeamBtn = document.getElementById("blueTeamBtn");
    
    console.log("Red team button:", redTeamBtn);
    console.log("Blue team button:", blueTeamBtn);

    if (redTeamBtn && blueTeamBtn) {
        redTeamBtn.addEventListener("click", () => {
            console.log("Red team button clicked");
            selectTeam("red");
        });
        blueTeamBtn.addEventListener("click", () => {
            console.log("Blue team button clicked");
            selectTeam("blue");
        });
    } else {
        console.error("Team buttons not found!");
    }
});

// Handle new player joining
socket.on('playerJoined', (data) => {
    console.log('New player joined:', data);
    const { id, team, position, rotation } = data;
    
    // Don't create a model for ourselves
    if (id === socket.id) {
        console.log('Ignoring self player model creation');
        return;
    }
    
    console.log('Creating player model for:', { id, team });
    
    // Create player model for the new player
    createPlayerModel(team === 'red' ? 0xff0000 : 0x0000ff).then(playerModel => {
        // Set initial position and rotation
        playerModel.position.fromArray(position);
        playerModel.rotation.y = rotation;
        
        // Store in otherPlayers map
        otherPlayers.set(id, playerModel);
        scene.add(playerModel);
        console.log('Added player model to scene:', { id, position, rotation });
    }).catch(error => {
        console.error('Error creating player model:', error);
    });
});

// Handle existing players when joining
socket.on('currentPlayers', (players) => {
    console.log('Received current players:', players);
    
    // Clear existing other players
    otherPlayers.forEach((model) => {
        scene.remove(model);
    });
    otherPlayers.clear();
    
    // Add all current players
    Object.entries(players).forEach(([id, data]) => {
        if (id === socket.id) return; // Skip ourselves
        
        console.log('Creating model for existing player:', { id, data });
        
        createPlayerModel(data.team === 'red' ? 0xff0000 : 0x0000ff).then(playerModel => {
            // Set initial position and rotation
            playerModel.position.fromArray(data.position);
            playerModel.rotation.y = data.rotation;
            
            // Store in otherPlayers map
            otherPlayers.set(id, playerModel);
            scene.add(playerModel);
            console.log('Added existing player model to scene:', { id, position: playerModel.position });
        }).catch(error => {
            console.error('Error creating model for existing player:', error);
        });
    });
});

// Handle player leaving
socket.on('playerLeft', (playerId) => {
    console.log('Player left:', playerId);
    const playerModel = otherPlayers.get(playerId);
    if (playerModel) {
        scene.remove(playerModel);
        otherPlayers.delete(playerId);
    }
});

// Handle player position and rotation updates
socket.on('playerMoved', (data) => {
    const { id, position, rotation } = data;
    
    // Don't update our own position
    if (id === socket.id) {
        console.log('Ignoring self position update');
        return;
    }
    
    console.log('Received position update for player:', { id, position, rotation });
    
    const playerModel = otherPlayers.get(id);
    if (playerModel) {
        // Smoothly interpolate to new position and rotation
        const targetPosition = new THREE.Vector3().fromArray(position);
        playerModel.position.lerp(targetPosition, 0.3);
        
        // Update rotation to match the player's view direction
        playerModel.rotation.y = rotation;  // Removed the + Math.PI to fix backwards orientation
        
        console.log('Updated player model position:', { id, position: playerModel.position });
    } else {
        console.warn('Player model not found for update:', id);
    }
});

function updatePaintCoverage() {
    // Reset the grid
    paintGrid.fill(null);
    let totalPaintedCells = 0;
    let redCells = 0;
    let blueCells = 0;

    // Get all paint splats in the scene
    scene.traverse((object) => {
        if (object instanceof THREE.Mesh && 
            object.material.transparent && 
            (object.material.color.r === 1 || object.material.color.b === 1)) {
            
            // Convert world position to grid coordinates
            const gridX = Math.floor((object.position.x + 75) / 3); // 150x150 floor mapped to 50x50 grid
            const gridZ = Math.floor((object.position.z + 75) / 3);

            // Ensure position is within grid bounds
            if (gridX >= 0 && gridX < PAINT_GRID_SIZE && 
                gridZ >= 0 && gridZ < PAINT_GRID_SIZE) {
                
                const gridIndex = gridZ * PAINT_GRID_SIZE + gridX;
                const isRed = object.material.color.r === 1;

                // Update grid cell if empty or if new paint is on top (higher Y position)
                if (paintGrid[gridIndex] === null || 
                    object.position.y > paintGrid[gridIndex].y) {
                    paintGrid[gridIndex] = {
                        team: isRed ? 'red' : 'blue',
                        y: object.position.y
                    };
                }
            }
        }
    });

    // Count cells for each team
    paintGrid.forEach(cell => {
        if (cell !== null) {
            totalPaintedCells++;
            if (cell.team === 'red') redCells++;
            else blueCells++;
        }
    });

    // Calculate percentages
    redCoverage = totalPaintedCells > 0 ? (redCells / totalPaintedCells) * 100 : 0;
    blueCoverage = totalPaintedCells > 0 ? (blueCells / totalPaintedCells) * 100 : 0;

    // Update coverage display
    updateCoverageDisplay();
}

function updateCoverageDisplay() {
    // Create or update coverage display container
    let coverageDisplay = document.getElementById('coverageDisplay');
    if (!coverageDisplay) {
        coverageDisplay = document.createElement('div');
        coverageDisplay.id = 'coverageDisplay';
        coverageDisplay.style.position = 'absolute';
        coverageDisplay.style.left = '10px';  // Left padding
        coverageDisplay.style.top = '10px';   // Top padding
        coverageDisplay.style.width = MINIMAP_SIZE + 'px'; // Match minimap width
        coverageDisplay.style.color = 'white';
        coverageDisplay.style.fontFamily = 'Arial, sans-serif';
        coverageDisplay.style.fontWeight = 'bold';
        coverageDisplay.style.fontSize = '16px';
        coverageDisplay.style.textShadow = '2px 2px 2px rgba(0,0,0,0.5)';
        coverageDisplay.style.zIndex = '1000';
        coverageDisplay.style.textAlign = 'center';
        coverageDisplay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        coverageDisplay.style.padding = '4px';
        coverageDisplay.style.borderRadius = '5px';
        document.body.appendChild(coverageDisplay);
    } else {
        // Update position in case window was resized
        coverageDisplay.style.top = '10px';
    }

    // Update text with current coverage percentages
    coverageDisplay.innerHTML = `
        <span style="color: #ff6666">RED ${redCoverage.toFixed(1)}%</span> | 
        <span style="color: #6666ff">BLUE ${blueCoverage.toFixed(1)}%</span>
    `;
}

// Update player spawn function
function getRandomSpawnPoint() {
    const SPAWN_ATTEMPTS = 20;  // Maximum attempts to find a valid spawn point
    const PLAYER_RADIUS = 1;    // Minimum distance from obstacles
    const PORTAL_SAFE_RADIUS = 8; // Safe distance from portals
    
    // Define portal positions
    const portalPositions = [
        new THREE.Vector3(40, 0, -40),  // Main portal
        new THREE.Vector3(-40, 0, -40)  // Return portal
    ];
    
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
        // Generate random position within the white floor area
        // Using 35 instead of 45 to keep more distance from walls
        const x = (Math.random() * 70 - 35);  // -35 to 35
        const z = (Math.random() * 70 - 35);  // -35 to 35
        
        // Check distance from portals
        const spawnPos = new THREE.Vector3(x, 0, z);
        let tooCloseToPortal = false;
        
        for (const portalPos of portalPositions) {
            if (spawnPos.distanceTo(portalPos) < PORTAL_SAFE_RADIUS) {
                tooCloseToPortal = true;
                break;
            }
        }
        
        if (tooCloseToPortal) continue;
        
        // Create a test box to check for collisions
        const testBox = new THREE.Box3();
        testBox.min.set(x - PLAYER_RADIUS, 0, z - PLAYER_RADIUS);
        testBox.max.set(x + PLAYER_RADIUS, PLAYER_HEIGHT, z + PLAYER_RADIUS);
        
        // Check for collisions with obstacles
        let hasCollision = false;
        for (let i = 1; i < obstacles.length; i++) {  // Start from 1 to skip floor
            if (testBox.intersectsBox(obstacles[i].box)) {
                hasCollision = true;
                break;
            }
        }
        
        // Check if there's floor beneath the spawn point
        const floorRaycaster = new THREE.Raycaster(
            new THREE.Vector3(x, PLAYER_HEIGHT + 1, z),
            new THREE.Vector3(0, -1, 0)
        );
        
        // Only check collision with the floor (obstacles[0])
        const floorIntersects = obstacles[0] ? floorRaycaster.intersectObject(obstacles[0].mesh) : [];
        
        if (!hasCollision && floorIntersects.length > 0) {
            // Calculate rotation to face center
            const angleToCenter = Math.atan2(-z, -x);  // Point towards (0,0)
            
            // Get the exact height where we hit the floor and add PLAYER_HEIGHT
            const floorY = floorIntersects[0].point.y + PLAYER_HEIGHT;
            
            return {
                x: x,
                y: floorY,  // Use the actual floor height plus player height
                z: z,
                rotation: angleToCenter
            };
        }
    }
    
    // Fallback spawn point if no valid position found
    console.warn("Could not find valid spawn point, using fallback");
    return {
        x: 0,  // Center as fallback
        y: PLAYER_HEIGHT,  // Use player height
        z: 10, // Slightly away from center
        rotation: Math.PI  // Face towards center
    };
}

// Initialize the game
try {
    init();
} catch (error) {
    console.error("Error during game initialization:", error);
}

function createProjectile(position, direction, team) {
    const projectileGeometry = new THREE.SphereGeometry(PROJECTILE_RADIUS, 8, 8);
    const projectileMaterial = new THREE.MeshBasicMaterial({
        color: team === 'red' ? 0xff0000 : 0x0000ff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: true
    });
    
    const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
    projectile.position.copy(position);
    
    // Store velocity and team data
    projectile.userData.velocity = direction.multiplyScalar(PROJECTILE_SPEED);
    projectile.userData.team = team;
    projectile.userData.timeCreated = Date.now();
    
    // Add to scene and projectiles array
    scene.add(projectile);
    projectiles.push(projectile);
    
    // Create a point light that follows the projectile
    const light = new THREE.PointLight(team === 'red' ? 0xff0000 : 0x0000ff, 0.5, 3);
    light.position.copy(position);
    projectile.userData.light = light;
    scene.add(light);
    
    return projectile;
}

// Update projectile movement in the animation loop
function updateProjectiles(deltaTime) {
    const now = Date.now();
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const projectile = projectiles[i];
        
        // Update position based on velocity
        projectile.position.add(projectile.userData.velocity.clone().multiplyScalar(deltaTime));
        
        // Update light position
        if (projectile.userData.light) {
            projectile.userData.light.position.copy(projectile.position);
        }
        
        // Check for collisions with structures
        const raycaster = new THREE.Raycaster(
            projectile.position.clone().sub(projectile.userData.velocity.clone().multiplyScalar(deltaTime)),
            projectile.userData.velocity.clone().normalize(),
            0,
            projectile.userData.velocity.length() * deltaTime
        );
        
        const intersects = raycaster.intersectObjects(structures);
        
        if (intersects.length > 0) {
            // Create paint splat at collision point
            socket.emit('paintSurface', {
                position: intersects[0].point.toArray(),
                normal: intersects[0].face.normal.toArray(),
                team: projectile.userData.team
            });
            
            // Remove projectile and its light
            scene.remove(projectile);
            if (projectile.userData.light) {
                scene.remove(projectile.userData.light);
            }
            projectiles.splice(i, 1);
            continue;
        }
        
        // Remove projectiles after 3 seconds
        if (now - projectile.userData.timeCreated > 3000) {
            scene.remove(projectile);
            if (projectile.userData.light) {
                scene.remove(projectile.userData.light);
            }
            projectiles.splice(i, 1);
        }
    }
}

// Add after init() function
function initMobileControls() {
    if (!isMobile) return;

    const joystickArea = document.getElementById('joystickArea');
    const joystickKnob = document.getElementById('joystickKnob');
    const lookArea = document.getElementById('lookArea');
    const shootButton = document.getElementById('shootButton');

    // Joystick controls
    joystickArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        joystickTouch = touch.identifier;
        updateJoystickPosition(touch);
    });

    joystickArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = Array.from(e.touches).find(t => t.identifier === joystickTouch);
        if (touch) {
            updateJoystickPosition(touch);
        }
    });

    joystickArea.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (Array.from(e.changedTouches).some(t => t.identifier === joystickTouch)) {
            joystickTouch = null;
            joystickPosition = { x: 0, y: 0 };
            joystickKnob.style.transform = 'translate(-50%, -50%)';
        }
    });

    // Look controls
    lookArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        lookTouch = {
            identifier: touch.identifier,
            lastX: touch.clientX,
            lastY: touch.clientY
        };
    });

    lookArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = Array.from(e.touches).find(t => t.identifier === lookTouch?.identifier);
        if (touch && lookTouch) {
            lookDelta.x = (touch.clientX - lookTouch.lastX) * 0.002;
            lookDelta.y = (touch.clientY - lookTouch.lastY) * 0.002;
            lookTouch.lastX = touch.clientX;
            lookTouch.lastY = touch.clientY;
            updateCameraRotation();
        }
    });

    lookArea.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (Array.from(e.changedTouches).some(t => t.identifier === lookTouch?.identifier)) {
            lookTouch = null;
            lookDelta = { x: 0, y: 0 };
        }
    });

    // Shoot button
    shootButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        shootPaint();
    });

    // Show mobile controls
    document.getElementById('mobileControls').classList.remove('hidden');
}

function updateJoystickPosition(touch) {
    const joystickArea = document.getElementById('joystickArea');
    const joystickKnob = document.getElementById('joystickKnob');
    const rect = joystickArea.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Calculate joystick position relative to center
    let x = (touch.clientX - centerX) / (rect.width / 2);
    let y = (touch.clientY - centerY) / (rect.height / 2);

    // Clamp to circle
    const length = Math.sqrt(x * x + y * y);
    if (length > 1) {
        x /= length;
        y /= length;
    }

    // Update joystick visuals
    const knobX = x * (rect.width / 2);
    const knobY = y * (rect.height / 2);
    joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

    // Store normalized joystick position
    joystickPosition = { x, y };
}

function updateCameraRotation() {
    if (!controls || !controls.isLocked) return;

    // Update camera rotation based on look delta
    controls.targetRotation.y -= lookDelta.x;
    controls.currentVerticalRotation -= lookDelta.y;
    controls.currentVerticalRotation = Math.max(
        -controls.maxVerticalAngle,
        Math.min(controls.maxVerticalAngle, controls.currentVerticalRotation)
    );
    controls.targetRotation.x = controls.currentVerticalRotation;
}

// Add after createWorld function
function createPortal() {
    // Create portal ring
    const torusGeometry = new THREE.TorusGeometry(PORTAL_RADIUS, 0.3, 16, 32);
    const portalMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    portal = new THREE.Mesh(torusGeometry, portalMaterial);
    // Move portal to the northeast corner and make it vertical
    portal.position.set(42, PORTAL_HEIGHT, -40); // Moved from 38 to 42 on X axis
    portal.rotation.y = Math.PI / 4; // Rotate 45 degrees to face inward
    scene.add(portal);

    // Add portal light
    portalLight = new THREE.PointLight(0x00ffff, 2, 10);
    portalLight.position.copy(portal.position);
    scene.add(portalLight);

    // Add a small platform under the portal
    const platformGeometry = new THREE.BoxGeometry(6, 0.5, 6);
    const platformMaterial = new THREE.MeshBasicMaterial({ color: 0x808080 });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(portal.position.x, 0.25, portal.position.z);
    scene.add(platform);
}

function createReturnPortal(destination) {
    const returnPortal = new THREE.Mesh(
        new THREE.TorusGeometry(PORTAL_RADIUS, 0.3, 16, 32),
        new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        })
    );
    // Place return portal in the northwest corner, standing vertically
    returnPortal.position.set(-40, PORTAL_HEIGHT, -40);
    returnPortal.rotation.y = -Math.PI / 4; // Rotate -45 degrees to face inward
    scene.add(returnPortal);

    // Add return portal light
    const returnLight = new THREE.PointLight(0xff00ff, 2, 10);
    returnLight.position.copy(returnPortal.position);
    scene.add(returnLight);

    // Add a small platform under the return portal
    const platformGeometry = new THREE.BoxGeometry(6, 0.5, 6);
    const platformMaterial = new THREE.MeshBasicMaterial({ color: 0x808080 });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(returnPortal.position.x, 0.25, returnPortal.position.z);
    scene.add(platform);

    // Store portal data
    returnPortal.userData.isReturnPortal = true;
    returnPortal.userData.destination = destination;
}

// Add to init() function after createWorld();
createPortal();

// Add to animate() function before renderer.render()
// Update portal effects
if (portal) {
    portal.rotation.z += 0.005; // Rotate the portal ring
    
    // Update portal particles
    portalParticles.forEach(particleSystem => {
        const positions = particleSystem.mesh.geometry.attributes.position.array;
        const velocities = particleSystem.velocities;
        
        for(let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i/3].x;
            positions[i + 1] += velocities[i/3].y;
            positions[i + 2] += velocities[i/3].z;
            
            // Reset particles that move too far from center
            const distance = Math.sqrt(
                positions[i] * positions[i] + 
                positions[i + 1] * positions[i + 1] + 
                positions[i + 2] * positions[i + 2]
            );
            
            if(distance > PORTAL_RADIUS) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * PORTAL_RADIUS * 0.5;
                positions[i] = Math.cos(angle) * radius;
                positions[i + 1] = Math.sin(angle) * radius;
                positions[i + 2] = 0;
            }
        }
        particleSystem.mesh.geometry.attributes.position.needsUpdate = true;
    });

    // Check if player is in portal
    const portals = scene.children.filter(child => 
        child instanceof THREE.Mesh && 
        child.geometry instanceof THREE.TorusGeometry
    );

    let inPortal = false;
    for (const portalObj of portals) {
        const distance = camera.position.distanceTo(portalObj.position);
        if (distance < PORTAL_RADIUS * 1.5) {
            inPortal = true;
            break;
        }
    }

    // Update portal state
    if (inPortal && !isInPortal) {
        isInPortal = true;
        enterPortal();
    } else if (!inPortal) {
        isInPortal = false;
    }
}

// Add portal entry function
function enterPortal() {
    // Only proceed if player is actually in the portal
    if (!isInPortal) return;

    // Get the portal the player is near (main portal or return portal)
    const portals = scene.children.filter(child => 
        child instanceof THREE.Mesh && 
        child.geometry instanceof THREE.TorusGeometry
    );

    let activePortal = null;
    for (const portal of portals) {
        const distance = camera.position.distanceTo(portal.position);
        if (distance < PORTAL_RADIUS * 1.5) {
            activePortal = portal;
            break;
        }
    }

    if (!activePortal) return;

    // If it's a return portal, use its stored destination
    if (activePortal.userData.isReturnPortal && activePortal.userData.destination) {
        window.location.href = activePortal.userData.destination;
        return;
    }

    // Otherwise, construct portal URL with parameters for the main portal
    const params = new URLSearchParams({
        portal: 'true',
        username: playerTeam === 'red' ? 'RedPlayer' : 'BluePlayer',
        color: playerTeam || 'blue',
        speed: BASE_SPEED.toString(),
        ref: window.location.href,
        speed_x: velocity.x.toString(),
        speed_y: velocity.y.toString(),
        speed_z: velocity.z.toString(),
        rotation_x: camera.rotation.x.toString(),
        rotation_y: camera.rotation.y.toString(),
        rotation_z: camera.rotation.z.toString()
    });

    // Redirect to portal
    window.location.href = `https://portal.pieter.com/?${params.toString()}`;
}

// Add portal spawn handling at the start of init()
function handlePortalSpawn() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('portal') === 'true') {
        // Get parameters from URL
        const color = urlParams.get('color') || 'blue';
        const speedX = parseFloat(urlParams.get('speed_x')) || 0;
        const speedY = parseFloat(urlParams.get('speed_y')) || 0;
        const speedZ = parseFloat(urlParams.get('speed_z')) || 0;
        const rotationX = parseFloat(urlParams.get('rotation_x')) || 0;
        const rotationY = parseFloat(urlParams.get('rotation_y')) || 0;
        const rotationZ = parseFloat(urlParams.get('rotation_z')) || 0;
        const ref = urlParams.get('ref');

        // Set initial player state
        playerTeam = color;
        velocity.set(speedX, speedY, speedZ);
        camera.rotation.set(rotationX, rotationY, rotationZ);

        // Create return portal near spawn point if we have a reference URL
        if (ref) {
            createReturnPortal(ref);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    
    // Update camera controls with smoothing
    if (controls) {
        controls.update();
    }
    
    // Only update player movement if the game has started
    if (gameStarted) {
        // Update player movement and paint projectiles
        updatePlayerMovement(delta);
        updatePaintProjectiles(delta);
    }
    
    // Update player body position to follow camera
    if (playerBody) {
        // Position the model at the camera's position
        playerBody.position.set(
            camera.position.x,
            0,  // Keep model at ground level
            camera.position.z
        );
        
        // Set the model's rotation to match the camera's direction
        playerBody.rotation.y = camera.rotation.y + Math.PI;
    }

    // Update paint coverage periodically (every 30 frames)
    if (frameCount % 30 === 0) {
        updatePaintCoverage();
    }
    frameCount++;

    // Clear the entire renderer
    renderer.clear();

    // Render main view (full screen)
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);

    // Render minimap (top left corner)
    const padding = 10;
    const minimapX = padding;
    const minimapY = padding;
    
    renderer.setViewport(minimapX, window.innerHeight - MINIMAP_SIZE - minimapY, MINIMAP_SIZE, MINIMAP_SIZE);
    renderer.setScissor(minimapX, window.innerHeight - MINIMAP_SIZE - minimapY, MINIMAP_SIZE, MINIMAP_SIZE);
    renderer.setScissorTest(true);
    
    // Clear background for minimap to white
    renderer.setClearColor(0xFFFFFF);
    renderer.render(scene, minimapCamera);
    renderer.setClearColor(0x87CEEB);  // Reset to sky blue for main view

    // Update portal effects
    if (portal) {
        portal.rotation.z += 0.005; // Rotate the portal ring
        
        // Update portal particles
        portalParticles.forEach(particleSystem => {
            const positions = particleSystem.mesh.geometry.attributes.position.array;
            const velocities = particleSystem.velocities;
            
            for(let i = 0; i < positions.length; i += 3) {
                positions[i] += velocities[i/3].x;
                positions[i + 1] += velocities[i/3].y;
                positions[i + 2] += velocities[i/3].z;
                
                // Reset particles that move too far from center
                const distance = Math.sqrt(
                    positions[i] * positions[i] + 
                    positions[i + 1] * positions[i + 1] + 
                    positions[i + 2] * positions[i + 2]
                );
                
                if(distance > PORTAL_RADIUS) {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = Math.random() * PORTAL_RADIUS * 0.5;
                    positions[i] = Math.cos(angle) * radius;
                    positions[i + 1] = Math.sin(angle) * radius;
                    positions[i + 2] = 0;
                }
            }
            particleSystem.mesh.geometry.attributes.position.needsUpdate = true;
        });

        // Check if player is in portal
        const portals = scene.children.filter(child => 
            child instanceof THREE.Mesh && 
            child.geometry instanceof THREE.TorusGeometry
        );

        let inPortal = false;
        for (const portalObj of portals) {
            const distance = camera.position.distanceTo(portalObj.position);
            if (distance < PORTAL_RADIUS * 1.5) {
                inPortal = true;
                break;
            }
        }

        // Update portal state
        if (inPortal && !isInPortal) {
            isInPortal = true;
            enterPortal();
        } else if (!inPortal) {
            isInPortal = false;
        }
    }
}

async function selectTeam(teamColor) {
    playerTeam = teamColor;
    const teamColorHex = teamColor === 'red' ? 0xff0000 : 0x0000ff;
    gameStarted = true;
    
    try {
        // Reset player state
        playerVelocity.set(0, 0, 0);
        isOnGround = true;
        isFalling = false;
        fallStartTime = 0;

        // Create the world
        createWorld();
        console.log("World created");

        // Get spawn point
        const spawnPoint = getRandomSpawnPoint();
        console.log("New spawn point:", spawnPoint);

        // Create invisible player model for collision and networking
        playerBody = await createPlayerModel(teamColorHex);
        if (playerBody) {
            playerBody.visible = false; // Make player model invisible
            playerBody.position.set(spawnPoint.x, 0, spawnPoint.z);
            playerBody.rotation.set(0, spawnPoint.rotation, 0);
            scene.add(playerBody);

            // Create hitbox for the player
            const hitboxGeometry = new THREE.BoxGeometry(HITBOX_WIDTH, HITBOX_HEIGHT, HITBOX_DEPTH);
            const hitboxMaterial = new THREE.MeshBasicMaterial({
                color: teamColorHex,
                transparent: true,
                opacity: 0.0, // Invisible hitbox
                depthWrite: false
            });
            playerHitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
            playerHitbox.position.y = HITBOX_HEIGHT / 2; // Center vertically
            playerHitbox.userData.isHitbox = true;
            playerHitbox.userData.team = teamColor;
            playerBody.add(playerHitbox);
            
            // Position camera at spawn point
            camera.position.set(
                spawnPoint.x,
                2,  // Eye level height
                spawnPoint.z
            );
            camera.rotation.set(0, spawnPoint.rotation, 0);
        }

        // Create and position weapon for FPS view
        weapon = await createWeaponModel();
        camera.add(weapon);

        // Send join game event
        socket.emit('joinGame', {
            team: teamColor,
            position: [camera.position.x, camera.position.y, camera.position.z],
            rotation: camera.rotation.y
        });
        
        document.getElementById('teamSelection').classList.add('hidden');
        document.getElementById('gameUI').classList.remove('hidden');
        
        hideCursor();
        controls.lock();

        animate();
        console.log("Animation loop started");
    } catch (error) {
        console.error('Error setting up player model:', error);
        alert('Failed to load player model. Please try again.');
    }
}

function updatePaintProjectiles(delta) {
    const MAX_DISTANCE = 75;
    const COLLISION_THRESHOLD = 0.5;
    const currentTime = Date.now();

    for (let i = paintProjectiles.length - 1; i >= 0; i--) {
        const projectile = paintProjectiles[i];
        
        // Calculate fade-in effect
        const age = currentTime - projectile.startTime;
        const fadeInProgress = Math.min(age / projectile.fadeInDuration, 1);
        projectile.mesh.material.opacity = 0.5 * fadeInProgress;
        
        // Calculate movement for this frame
        const moveDistance = PAINT_SPEED * delta;
        const movement = projectile.direction.clone().multiplyScalar(moveDistance);
        
        // Update position
        projectile.mesh.position.add(movement);
        projectile.distanceTraveled += moveDistance;
        
        // Remove if traveled too far
        if (projectile.distanceTraveled > MAX_DISTANCE) {
            scene.remove(projectile.mesh);
            paintProjectiles.splice(i, 1);
            continue;
        }

        // Check for collisions using raycaster
        const raycaster = new THREE.Raycaster(
            projectile.mesh.position.clone().sub(movement),
            projectile.direction.clone(),
            0,
            moveDistance + COLLISION_THRESHOLD
        );

        // Get all collidable objects
        const collidableObjects = [];
        
        // Add all obstacles
        obstacles.forEach(obstacle => {
            collidableObjects.push(obstacle.mesh);
        });
        
        // Add player hitboxes from other players
        otherPlayers.forEach((playerModel) => {
            if (playerModel.userData.hitbox) {
                collidableObjects.push(playerModel.userData.hitbox);
            }
        });

        const intersects = raycaster.intersectObjects(collidableObjects, true);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitObject = hit.object;

            if (hitObject.userData.isHitbox) {
                // Handle player hit
                const hitPlayerTeam = hitObject.userData.team;

                // Only process hit if it's an enemy (different team)
                if (hitPlayerTeam !== projectile.team) {
                    let hitPlayerId;
                    otherPlayers.forEach((model, id) => {
                        if (model.userData.hitbox === hitObject) {
                            hitPlayerId = id;
                        }
                    });

                    if (hitPlayerId) {
                        // Create hit effect
                        const hitEffect = new THREE.Mesh(
                            new THREE.SphereGeometry(0.3, 8, 8),
                            new THREE.MeshBasicMaterial({
                                color: 0xffff00,
                                transparent: true,
                                opacity: 0.8
                            })
                        );
                        hitEffect.position.copy(hit.point);
                        scene.add(hitEffect);
                        setTimeout(() => scene.remove(hitEffect), 200);

                        // Emit hit event to server
                        socket.emit('playerHit', {
                            hitPlayerId: hitPlayerId,
                            position: hit.point.toArray(),
                            projectileTeam: projectile.team
                        });

                        // Remove projectile after hit
                        scene.remove(projectile.mesh);
                        paintProjectiles.splice(i, 1);
                    }
                }
            } else {
                // Create paint splat for non-hitbox collisions
                createPaintSplat(hit.point, hit.face.normal, projectile.team);
                
                // Remove projectile after creating splat
                scene.remove(projectile.mesh);
                paintProjectiles.splice(i, 1);
            }
            continue;
        }
    }
}

function createPaintSplat(position, normal, team) {
    // Create a simple spherical paint splat
    const splat = new THREE.Mesh(
        new THREE.SphereGeometry(SPLAT_RADIUS, 16, 16),
        new THREE.MeshBasicMaterial({ 
            color: team === 'red' ? 0xff0000 : 0x0000ff,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        })
    );
    
    splat.position.copy(position);
    splat.position.y += 0.01; // Small offset to prevent z-fighting
    
    // Store additional data with the paint splat
    splat.userData.team = team;
    splat.userData.radius = SPLAT_RADIUS;
    
    scene.add(splat);
    paintSplats.push(splat);
    
    updatePaintCoverage();
}

// Add to init() function after scene creation
function createClouds() {
    // Create a large sphere for the skybox
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87CEEB,
        side: THREE.BackSide
    });
    skybox = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skybox);

    // Create clouds as part of the skybox
    const cloudLayers = [
        { width: 200, height: 100, opacity: 0.5 },
        { width: 150, height: 75, opacity: 0.4 },
        { width: 180, height: 90, opacity: 0.45 }
    ];

    // Fixed cloud positions on the skybox
    const cloudPositions = [
        { phi: Math.PI/4, theta: Math.PI/6, scale: 1.0 },
        { phi: Math.PI/3, theta: Math.PI/2, scale: 1.2 },
        { phi: Math.PI/4, theta: Math.PI, scale: 1.1 },
        { phi: Math.PI/3, theta: 3*Math.PI/2, scale: 1.3 },
        { phi: Math.PI/5, theta: Math.PI/3, scale: 0.9 },
        { phi: Math.PI/4, theta: 2*Math.PI/3, scale: 1.2 },
        { phi: Math.PI/3, theta: 5*Math.PI/6, scale: 1.1 },
        { phi: Math.PI/4, theta: 7*Math.PI/6, scale: 1.0 },
        { phi: Math.PI/3, theta: 4*Math.PI/3, scale: 1.2 },
        { phi: Math.PI/4, theta: 11*Math.PI/6, scale: 1.1 }
    ];

    cloudPositions.forEach(pos => {
        cloudLayers.forEach(layer => {
            const cloudGeometry = new THREE.PlaneGeometry(layer.width, layer.height);
            const cloudMaterial = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: layer.opacity,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
            
            // Convert spherical coordinates to Cartesian
            const radius = 450; // Slightly inside the skybox
            const x = radius * Math.sin(pos.phi) * Math.cos(pos.theta);
            const y = radius * Math.cos(pos.phi);
            const z = radius * Math.sin(pos.phi) * Math.sin(pos.theta);
            
            cloud.position.set(x, y, z);
            
            // Make cloud face center of skybox
            cloud.lookAt(0, 0, 0);
            
            // Add random rotation around normal axis
            cloud.rotateOnWorldAxis(
                new THREE.Vector3(x, y, z).normalize(),
                Math.random() * Math.PI * 2
            );
            
            // Scale the cloud
            const scale = pos.scale * (0.9 + Math.random() * 0.2);
            cloud.scale.set(scale, scale, scale);

            skybox.add(cloud);
        });
    });
}

// Add visibility change handler
document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameStarted) {
        showPauseMenu();
    }
});

// Add click handler for pause menu
document.addEventListener('click', (event) => {
    if (isPaused && event.target.id === 'pauseMenu') {
        hidePauseMenu();
    }
});

