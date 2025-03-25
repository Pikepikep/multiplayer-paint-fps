// Import Three.js components
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.161.0/three.module.js';

// Initialize socket connection
const socket = io('https://multiplayer-paint-fps.onrender.com', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Add connection status handling
socket.on('connect', () => {
    console.log('Connected to server');
    if (gameStarted) {
        // Rejoin game if we were already playing
        socket.emit('joinGame', {
            team: playerTeam,
            position: player.position.toArray(),
            rotation: player.rotation.y
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
const SHOT_COOLDOWN = 250; // Reduced from 500ms to 250ms for more responsive shooting
const BASE_SPEED = 20;     // Increased from 5 to 20 for faster movement
const SPRINT_MULTIPLIER = 1.6; // Slightly increased sprint multiplier
let playerBody;
let playerHitbox;
let otherPlayers = new Map(); // Store other players' models
let paintProjectiles = [];
const PAINT_SPEED = 50; // Increased from 30 to 50 for faster projectiles
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
const FALL_RESPAWN_DELAY = 1500; // 1.5 seconds in milliseconds
const FALL_THRESHOLD = -10; // Y position that triggers fall detection

// Add after the global variables
let minimapCamera;
const MINIMAP_SIZE = 300;
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

// Create PointerLockControls
class PointerLockControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.isLocked = false;
        
        // Vertical rotation limits (in radians)
        this.maxVerticalAngle = Math.PI / 2.2; // ~82 degrees up/down like Overwatch
        this.currentVerticalRotation = 0;
        
        // Movement settings
        this.pointerSpeed = 0.4;
        this.mouseSensitivity = 0.001;
        
        // Camera smoothing
        this.targetRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.currentRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.smoothingFactor = 0.15;
        
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onPointerlockChange = this._onPointerlockChange.bind(this);
        this._onPointerlockError = this._onPointerlockError.bind(this);
        this.connect();
    }

    connect() {
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('pointerlockchange', this._onPointerlockChange);
        document.addEventListener('pointerlockerror', this._onPointerlockError);
    }

    disconnect() {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('pointerlockchange', this._onPointerlockChange);
        document.removeEventListener('pointerlockerror', this._onPointerlockError);
    }

    _onMouseMove(event) {
        if (!this.isLocked) return;

        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;

        // Apply smoothing to mouse movement
        const smoothX = movementX * this.mouseSensitivity * this.pointerSpeed;
        const smoothY = movementY * this.mouseSensitivity * this.pointerSpeed;

        // Update target rotation with smoothed values
        this.targetRotation.y -= smoothX;
        
        // Update vertical rotation with limits (negative smoothY to fix inversion)
        this.currentVerticalRotation -= smoothY;
        this.currentVerticalRotation = Math.max(
            -this.maxVerticalAngle,
            Math.min(this.maxVerticalAngle, this.currentVerticalRotation)
        );
        this.targetRotation.x = this.currentVerticalRotation;
    }

    _onPointerlockChange() {
        this.isLocked = document.pointerLockElement === this.domElement;
        if (this.isLocked) {
            this.currentVerticalRotation = 0;
            this.targetRotation.set(0, 0, 0);
            this.currentRotation.set(0, 0, 0);
            this.camera.rotation.set(0, 0, 0);
        }
    }

    _onPointerlockError() {
        console.error('PointerLockControls: Unable to use Pointer Lock API');
    }

    lock() {
        this.domElement.requestPointerLock();
    }

    unlock() {
        document.exitPointerLock();
    }

    moveForward(distance) {
        if (!this.isLocked) return;

        // Get forward direction from camera's rotation
        const forward = new THREE.Vector3();
        forward.setFromMatrixColumn(this.camera.matrix, 2);
        forward.y = 0;
        forward.normalize();
        forward.multiplyScalar(-distance);

        this.camera.position.add(forward);
    }

    moveRight(distance) {
        if (!this.isLocked) return;

        // Get right direction from camera's rotation
        const right = new THREE.Vector3();
        right.setFromMatrixColumn(this.camera.matrix, 0);
        right.y = 0;
        right.normalize();
        right.multiplyScalar(-distance);

        this.camera.position.add(right);
    }

    update() {
        // Smoothly interpolate current rotation towards target rotation
        this.currentRotation.x += (this.targetRotation.x - this.currentRotation.x) * this.smoothingFactor;
        this.currentRotation.y += (this.targetRotation.y - this.currentRotation.y) * this.smoothingFactor;
        
        // Force camera to stay level (no roll/tilt)
        this.currentRotation.z = 0;
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.copy(this.currentRotation);
    }
}

function createPlayerModel(color) {
    const group = new THREE.Group();
    const scale = 1.3;

    // Player body (thinner and shorter cylinder for the body)
    const bodyGeometry = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 0.7 * scale, 8);
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.6 * scale;
    group.add(body);

    // Head (sphere)
    const headGeometry = new THREE.SphereGeometry(0.2 * scale, 8, 8);
    const headMaterial = new THREE.MeshBasicMaterial({ color: color });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.1 * scale;
    group.add(head);

    // Arms (rectangles)
    const armGeometry = new THREE.BoxGeometry(0.1 * scale, 0.4 * scale, 0.1 * scale);
    const armMaterial = new THREE.MeshBasicMaterial({ color: color });
    
    // Left arm
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.25 * scale, 0.8 * scale, 0);
    leftArm.rotation.z = -Math.PI / 6;
    group.add(leftArm);

    // Right arm (weapon arm)
    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.25 * scale, 0.8 * scale, 0);
    rightArm.rotation.z = Math.PI / 6;
    group.add(rightArm);

    // Weapon for the right arm
    const weaponGeometry = new THREE.BoxGeometry(0.1 * scale, 0.1 * scale, 0.4 * scale);
    const weaponMaterial = new THREE.MeshBasicMaterial({ color: color });
    const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
    weapon.position.set(0.4 * scale, 0.8 * scale, 0.2 * scale);
    group.add(weapon);

    // Legs (rectangles)
    const legGeometry = new THREE.BoxGeometry(0.1 * scale, 0.5 * scale, 0.1 * scale);
    const legMaterial = new THREE.MeshBasicMaterial({ color: color });
    
    // Left leg
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.15 * scale, 0.25 * scale, 0);
    group.add(leftLeg);

    // Right leg
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.15 * scale, 0.25 * scale, 0);
    group.add(rightLeg);

    // Store references to limbs for animation
    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;
    group.userData.leftArm = leftArm;
    group.userData.rightArm = rightArm;
    group.userData.animationTime = 0;

    // Create a hitbox that covers the entire player model
    const hitboxGeometry = new THREE.BoxGeometry(0.6 * scale, 1.7 * scale, 0.6 * scale);
    const hitboxMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide
    });
    const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    hitbox.position.y = 0.85 * scale;
    hitbox.userData.isHitbox = true;  // Mark as hitbox
    hitbox.userData.parentModel = group;  // Reference to parent model
    group.add(hitbox);

    // Store hitbox reference
    group.userData.hitbox = hitbox;
    group.userData.team = color === 0xff0000 ? 'red' : 'blue';  // Store team color

    return { model: group, hitbox: hitbox };
}

function createWeaponModel() {
    const group = new THREE.Group();

    // Gun body
    const gunBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.4),
        new THREE.MeshBasicMaterial({ color: 0x333333 })
    );
    group.add(gunBody);

    // Gun barrel
    const gunBarrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x666666 })
    );
    gunBarrel.position.z = 0.3; // Extend forward
    group.add(gunBarrel);

    return group;
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
        // Reset frame count
        frameCount = 0;

        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        console.log("Scene created");

        // Main camera setup
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.y = 1.7;
        console.log("Camera created and positioned");

        // Minimap camera setup with adjusted view size
        minimapCamera = new THREE.OrthographicCamera(
            -95, 95,    // Left, Right (reduced from ±100 to ±95)
            95, -95,    // Top, Bottom (reduced from ±100 to ±95)
            1, 1000     // Near, Far
        );
        minimapCamera.position.set(0, 200, 0);
        minimapCamera.lookAt(0, 0, 0);
        minimapCamera.rotation.z = Math.PI;
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
        renderer.autoClear = false; // Important for rendering two views
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

        // Create player model
        const playerModels = createPlayerModel(0xcccccc);
        playerBody = playerModels.model;
        playerHitbox = playerModels.hitbox;
        scene.add(playerBody);
        console.log("Player model created");

        // Create and position weapon
        weapon = createWeaponModel();
        weapon.position.set(0.3, -0.2, -0.5);
        weapon.rotation.y = Math.PI / 12;
        camera.add(weapon);
        scene.add(camera);
        console.log("Weapon created and positioned");

        // Pointer Lock Controls - Initialize after camera is added to scene
        controls = new PointerLockControls(camera, document.body);
        console.log("Controls initialized");

        // Set up event listeners
        window.addEventListener('keydown', onKeyDown, false);
        window.addEventListener('keyup', onKeyUp, false);
        window.addEventListener('click', onMouseClick, false);
        window.addEventListener('resize', onWindowResize, false);
        console.log("Event listeners attached");

        // Set up environment
        createWorld();
        console.log("World created");

        // Start animation loop
        animate();
        console.log("Animation loop started");

        console.log("Game initialization completed successfully");
    } catch (error) {
        console.error("Error during initialization:", error);
        // Show error message to user
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
    // Store camera and player body before clearing
    const tempCamera = camera;
    const tempPlayerBody = playerBody;
    const tempWeapon = weapon;

    // Clear any existing objects
    while(scene.children.length > 0) { 
        scene.remove(scene.children[0]); 
    }
    obstacles = []; // Clear obstacles array

    // Add back camera and player body
    scene.add(tempCamera);
    if (tempPlayerBody) {
        scene.add(tempPlayerBody);
    }

    // Create floor with pure white color and collision - 50% larger
    const floorGeometry = new THREE.PlaneGeometry(150, 150); // Changed from 100 to 150
    const floorMaterial = new THREE.MeshBasicMaterial({ 
        color: new THREE.Color(1, 1, 1),
        side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);
    
    // Add floor collision box
    const floorBox = new THREE.Box3().setFromObject(floor);
    obstacles.push({ mesh: floor, box: floorBox });

    // Create and add dummy player in the middle
    const dummyPlayer = createPlayerModel(0x00ff00); // Green color for the dummy
    dummyPlayer.model.position.set(0, 0, 5); // Place 5 units in front of spawn
    scene.add(dummyPlayer.model);
    
    // Add dummy player to obstacles for collision
    const dummyBox = new THREE.Box3().setFromObject(dummyPlayer.model);
    obstacles.push({ mesh: dummyPlayer.model, box: dummyBox });

    // Add obstacles with light gray color
    const obstacleDefinitions = [
        { pos: [10, 2, 10], size: [2, 4, 2] },
        { pos: [-10, 2, -10], size: [2, 4, 2] },
        { pos: [0, 2, 15], size: [4, 4, 2] },
        { pos: [-5, 2, 5], size: [3, 4, 3] }
    ];

    obstacleDefinitions.forEach(obs => {
        const geometry = new THREE.BoxGeometry(...obs.size);
        const material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        const obstacle = new THREE.Mesh(geometry, material);
        obstacle.position.set(...obs.pos);
        scene.add(obstacle);
        
        // Add collision box
        const box = new THREE.Box3().setFromObject(obstacle);
        obstacles.push({ mesh: obstacle, box: box });
    });

    // Add triangular prism
    const triangleShape = new THREE.Shape();
    triangleShape.moveTo(-1.5, -1.5);
    triangleShape.lineTo(1.5, -1.5);
    triangleShape.lineTo(0, 1.5);
    triangleShape.lineTo(-1.5, -1.5);

    const extrudeSettings = {
        depth: 2,
        bevelEnabled: false
    };

    const triangleGeometry = new THREE.ExtrudeGeometry(triangleShape, extrudeSettings);
    const triangleMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    const trianglePrism = new THREE.Mesh(triangleGeometry, triangleMaterial);
    
    trianglePrism.position.set(5, 0, -5);
    trianglePrism.rotation.x = -Math.PI / 2;
    scene.add(trianglePrism);
    
    // Add collision box for triangle
    const triangleBox = new THREE.Box3().setFromObject(trianglePrism);
    obstacles.push({ mesh: trianglePrism, box: triangleBox });

    // Create map structures
    createMapStructures();
}

function createMapStructures() {
    // Create ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    scene.add(ground);

    // Create walls
    const wallMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.7,
        metalness: 0.3
    });

    // Outer walls
    const wallGeometry = new THREE.BoxGeometry(100, 20, 1);
    const walls = [
        { position: [0, 9.5, -50], rotation: [0, 0, 0] },      // North wall
        { position: [0, 9.5, 50], rotation: [0, Math.PI, 0] }, // South wall
        { position: [-50, 9.5, 0], rotation: [0, Math.PI / 2, 0] }, // West wall
        { position: [50, 9.5, 0], rotation: [0, -Math.PI / 2, 0] }  // East wall
    ];

    walls.forEach(wall => {
        const mesh = new THREE.Mesh(wallGeometry, wallMaterial);
        mesh.position.set(...wall.position);
        mesh.rotation.set(...wall.rotation);
        scene.add(mesh);
    });

    // Add rectangular structures
    const rectMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.6,
        metalness: 0.4
    });

    // Center structure
    const centerRect = new THREE.Mesh(
        new THREE.BoxGeometry(10, 8, 10),
        rectMaterial
    );
    centerRect.position.set(0, 4, 0);
    scene.add(centerRect);

    // Corner structures
    const cornerRects = [
        { position: [20, 4, 20], size: [8, 6, 8] },
        { position: [-20, 4, 20], size: [8, 6, 8] },
        { position: [20, 4, -20], size: [8, 6, 8] },
        { position: [-20, 4, -20], size: [8, 6, 8] }
    ];

    cornerRects.forEach(rect => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(...rect.size),
            rectMaterial
        );
        mesh.position.set(...rect.position);
        scene.add(mesh);
    });

    // Add cylindrical structures
    const cylinderMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.5,
        metalness: 0.5
    });

    const cylinders = [
        { position: [15, 3, 15], radius: 2, height: 6 },
        { position: [-15, 3, 15], radius: 2, height: 6 },
        { position: [15, 3, -15], radius: 2, height: 6 },
        { position: [-15, 3, -15], radius: 2, height: 6 }
    ];

    cylinders.forEach(cylinder => {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(cylinder.radius, cylinder.radius, cylinder.height, 8),
            cylinderMaterial
        );
        mesh.position.set(...cylinder.position);
        scene.add(mesh);
    });

    // Add a sphere structure
    const sphereMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.4,
        metalness: 0.6
    });

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(4, 16, 16),
        sphereMaterial
    );
    sphere.position.set(0, 4, 20);
    scene.add(sphere);

    // Add some cubes for cover
    const cubeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.7,
        metalness: 0.3
    });

    const cubes = [
        { position: [10, 2, 10], size: [4, 4, 4] },
        { position: [-10, 2, 10], size: [4, 4, 4] },
        { position: [10, 2, -10], size: [4, 4, 4] },
        { position: [-10, 2, -10], size: [4, 4, 4] }
    ];

    cubes.forEach(cube => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(...cube.size),
            cubeMaterial
        );
        mesh.position.set(...cube.position);
        scene.add(mesh);
    });
}

function onMouseClick() {
    if (!playerTeam || !controls.isLocked) return;

    const currentTime = Date.now();
    if (currentTime - lastShotTime < SHOT_COOLDOWN) return;

    lastShotTime = currentTime;
    shootPaint();
}

function shootPaint() {
    // Get weapon position (slightly offset from camera)
    const weaponPosition = new THREE.Vector3();
    weapon.getWorldPosition(weaponPosition);
    
    // Get the direction the camera is facing
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.normalize(); // Ensure direction is normalized
    
    // Create paint projectile
    const paintGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const paintMaterial = new THREE.MeshBasicMaterial({ 
        color: playerTeam === 'red' ? 0xff0000 : 0x0000ff,
        transparent: true,
        opacity: 0.8
    });
    
    const paintBlob = new THREE.Mesh(paintGeometry, paintMaterial);
    paintBlob.position.copy(weaponPosition);
    
    // Add to scene and store projectile data
    scene.add(paintBlob);
    paintProjectiles.push({
        mesh: paintBlob,
        direction: direction.clone(),
        startPosition: weaponPosition.clone(),
        distanceTraveled: 0,
        team: playerTeam
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
            if (isOnGround) {
                playerVelocity.y = 8; // Jump velocity
                isOnGround = false;
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
    
    // Update minimap camera with adjusted view size
    const aspectRatio = window.innerWidth / window.innerHeight;
    minimapCamera.left = -95 * aspectRatio;
    minimapCamera.right = 95 * aspectRatio;
    minimapCamera.top = 95;
    minimapCamera.bottom = -95;
    minimapCamera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updatePlayerMovement(delta) {
    // Calculate movement speed
    const SPEED = isSprinting ? BASE_SPEED * SPRINT_MULTIPLIER : BASE_SPEED;

    // Check for falling
    if (camera.position.y < FALL_THRESHOLD) {
        if (!isFalling) {
            isFalling = true;
            fallStartTime = Date.now();
            console.log('Player started falling');
        } else if (Date.now() - fallStartTime >= FALL_RESPAWN_DELAY) {
            console.log('Player fell out of bounds, respawning...');
            respawn();
            isFalling = false;
            return;
        }
    } else {
        isFalling = false;
    }

    // Get movement direction
    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveLeft) - Number(moveRight);

    // Only normalize if there's actual movement
    if (direction.x !== 0 || direction.z !== 0) {
        direction.normalize();
        
        // Calculate the potential new position
        const potentialPosition = camera.position.clone();
        if (moveForward || moveBackward) {
            // Get forward direction from camera's rotation
            const forward = new THREE.Vector3();
            forward.setFromMatrixColumn(camera.matrix, 2);
            forward.y = 0;
            forward.normalize();
            forward.multiplyScalar(-direction.z * SPEED * delta);
            potentialPosition.add(forward);
        }
        if (moveLeft || moveRight) {
            // Get right direction from camera's rotation
            const right = new THREE.Vector3();
            right.setFromMatrixColumn(camera.matrix, 0);
            right.y = 0;
            right.normalize();
            right.multiplyScalar(-direction.x * SPEED * delta);
            potentialPosition.add(right);
        }

        // Create player collision box at potential position
        const playerBox = new THREE.Box3();
        const PLAYER_RADIUS = 0.3;
        const PLAYER_HEIGHT = 1.7;
        playerBox.min.set(
            potentialPosition.x - PLAYER_RADIUS,
            potentialPosition.y - PLAYER_HEIGHT,
            potentialPosition.z - PLAYER_RADIUS
        );
        playerBox.max.set(
            potentialPosition.x + PLAYER_RADIUS,
            potentialPosition.y,
            potentialPosition.z + PLAYER_RADIUS
        );

        // Check collision with obstacles
        let collision = false;
        for (let i = 1; i < obstacles.length; i++) { // Start from 1 to skip floor
            if (playerBox.intersectsBox(obstacles[i].box)) {
                collision = true;
                break;
            }
        }

        // Only move if no collision
        if (!collision) {
            if (moveForward || moveBackward) {
                controls.moveForward(direction.z * SPEED * delta);
            }
            if (moveLeft || moveRight) {
                controls.moveRight(direction.x * SPEED * delta);
            }
        }
    }

    // Handle vertical movement (gravity and jumping)
    if (!isOnGround) {
        playerVelocity.y += GRAVITY * delta;
    }
    
    // Apply vertical movement
    camera.position.y += playerVelocity.y * delta;
    
    // Check for ground collision (only with floor)
    const playerBox = new THREE.Box3();
    playerBox.min.set(camera.position.x - 0.3, camera.position.y - 1.7, camera.position.z - 0.3);
    playerBox.max.set(camera.position.x + 0.3, camera.position.y, camera.position.z + 0.3);
    
    // Check collision with floor and obstacles for vertical movement
    isOnGround = false;
    let maxY = -Infinity;
    
    for (const obstacle of obstacles) {
        if (playerBox.intersectsBox(obstacle.box)) {
            if (playerVelocity.y < 0) { // Moving down
                maxY = Math.max(maxY, obstacle.box.max.y);
                isOnGround = true;
            } else if (playerVelocity.y > 0) { // Moving up (head collision)
                if (obstacle.box.min.y > camera.position.y) {
                    camera.position.y = obstacle.box.min.y - 1.7;
                    playerVelocity.y = 0;
                }
            }
        }
    }
    
    if (isOnGround) {
        camera.position.y = maxY + 1.7;
        playerVelocity.y = 0;
    }

    // Animation parameters
    const walkFrequency = 2;
    const runFrequency = 3;
    const walkAmplitude = Math.PI / 4; // 45 degrees
    const runAmplitude = Math.PI / 3; // 60 degrees
    const jumpAmplitude = Math.PI / 2.5; // ~72 degrees

    let animationState = {
        isMoving: direction.x !== 0 || direction.z !== 0,
        isJumping: !isOnGround,
        isSprinting: isSprinting,
        animationTime: playerBody ? playerBody.userData.animationTime : 0
    };

    if (playerBody) {
        // Handle jumping animation
        if (!isOnGround) {
            // Jump pose - arms up, legs slightly back
            playerBody.userData.leftLeg.rotation.x = jumpAmplitude * 0.5;
            playerBody.userData.rightLeg.rotation.x = jumpAmplitude * 0.5;
            playerBody.userData.leftArm.rotation.x = -jumpAmplitude;
            playerBody.userData.rightArm.rotation.x = -jumpAmplitude * 0.3;
        } else if (direction.x !== 0 || direction.z !== 0) {
            // Walking/Running animation
            playerBody.userData.animationTime += delta * SPEED;
            
            // Determine animation parameters based on sprinting
            const frequency = isSprinting ? runFrequency : walkFrequency;
            const amplitude = isSprinting ? runAmplitude : walkAmplitude;
            
            // Animate legs in opposite phases
            playerBody.userData.leftLeg.rotation.x = Math.sin(playerBody.userData.animationTime * frequency) * amplitude;
            playerBody.userData.rightLeg.rotation.x = -Math.sin(playerBody.userData.animationTime * frequency) * amplitude;

            // Animate arms in opposite phases to legs
            playerBody.userData.leftArm.rotation.x = -Math.sin(playerBody.userData.animationTime * frequency) * amplitude;
            playerBody.userData.rightArm.rotation.x = Math.sin(playerBody.userData.animationTime * frequency) * (amplitude * 0.3);

            // Add slight side-to-side movement for running
            if (isSprinting) {
                const sideAmplitude = Math.PI / 24;
                playerBody.userData.leftArm.rotation.z = -Math.PI / 6 + Math.cos(playerBody.userData.animationTime * frequency) * sideAmplitude;
                playerBody.userData.rightArm.rotation.z = Math.PI / 6 - Math.cos(playerBody.userData.animationTime * frequency) * sideAmplitude;
            }
        } else {
            // Reset to idle pose
            playerBody.userData.leftLeg.rotation.x = 0;
            playerBody.userData.rightLeg.rotation.x = 0;
            playerBody.userData.leftArm.rotation.x = 0;
            playerBody.userData.rightArm.rotation.x = 0;
            playerBody.userData.leftArm.rotation.z = -Math.PI / 6;
            playerBody.userData.rightArm.rotation.z = Math.PI / 6;
        }

        // Update player body position to follow camera
        playerBody.position.x = camera.position.x;
        playerBody.position.z = camera.position.z;
        playerBody.position.y = camera.position.y - 1.7;
        playerBody.rotation.y = camera.rotation.y;

        // Send position and animation state update to server
        socket.emit('updatePosition', {
            position: [camera.position.x, camera.position.y - 1.7, camera.position.z],
            rotation: camera.rotation.y,
            animationState: animationState
        });
    }
}

function updateWeaponColor() {
    if (weapon) {
        // Update all weapon parts to match team color
        weapon.children.forEach(part => {
            part.material.color.set(playerTeam === 'red' ? 0xff0000 : 0x0000ff);
        });
    }
}

function updatePaintProjectiles(delta) {
    const MAX_DISTANCE = 75;
    const COLLISION_THRESHOLD = 0.5; // Reduced from 0.8 to 0.5 for more precise hits

    for (let i = paintProjectiles.length - 1; i >= 0; i--) {
        const projectile = paintProjectiles[i];
        
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

        // Check for player hits using raycaster for more precise detection
        const raycaster = new THREE.Raycaster(
            projectile.mesh.position.clone().sub(movement), // Start from previous position
            projectile.direction.clone(),
            0,
            moveDistance + COLLISION_THRESHOLD
        );

        // Collect all player hitboxes
        const hitboxes = [];
        otherPlayers.forEach((playerModel) => {
            if (playerModel.userData.hitbox) {
                hitboxes.push(playerModel.userData.hitbox);
            }
        });

        const hitResults = raycaster.intersectObjects(hitboxes, false);
        
        if (hitResults.length > 0) {
            const hitResult = hitResults[0];
            const hitbox = hitResult.object;
            const hitPlayerModel = hitbox.userData.parentModel;
            const hitPlayerTeam = hitPlayerModel.userData.team;

            if (hitPlayerTeam !== projectile.team) {
                // Get the player ID from the otherPlayers map
                let hitPlayerId;
                otherPlayers.forEach((model, id) => {
                    if (model === hitPlayerModel) hitPlayerId = id;
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
                    hitEffect.position.copy(hitResult.point);
                    scene.add(hitEffect);
                    setTimeout(() => scene.remove(hitEffect), 200);

                    // Emit hit event
                    socket.emit('playerHit', {
                        hitPlayerId: hitPlayerId,
                        position: hitResult.point.toArray(),
                        projectileTeam: projectile.team
                    });

                    // Remove projectile
                    scene.remove(projectile.mesh);
                    paintProjectiles.splice(i, 1);
                    continue;
                }
            }
        }

        // Check for environment hits
        const envObjects = [];
        scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh && 
                !obj.userData.isHitbox && 
                obj !== projectile.mesh && 
                !obj.material.transparent) {
                envObjects.push(obj);
            }
        });

        const envHits = raycaster.intersectObjects(envObjects, false);
        
        if (envHits.length > 0) {
            const hit = envHits[0];
            createPaintSplat(hit.point, hit.face.normal, projectile.team);
            scene.remove(projectile.mesh);
            paintProjectiles.splice(i, 1);
        }
    }
}

// Helper function to create paint splats
function createPaintSplat(position, normal, team) {
    // Create flattened spherical paint splat using ellipsoid geometry
    const segments = 16;
    const paintGeometry = new THREE.SphereGeometry(SPLAT_RADIUS, segments, segments/2);
    paintGeometry.scale(1, SPLAT_HEIGHT, 1); // Flatten the sphere into an ellipsoid
    
    const paintMaterial = new THREE.MeshBasicMaterial({ 
        color: team === 'red' ? 0xff0000 : 0x0000ff,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
    });
    
    const paintBlob = new THREE.Mesh(paintGeometry, paintMaterial);
    paintBlob.position.copy(position);
    
    // Determine if the surface is the floor by checking the normal
    const isFloor = Math.abs(normal.y) > 0.9; // If the normal is pointing mostly up or down
    
    if (isFloor) {
        // For floor, rotate flat (around X axis)
        paintBlob.rotation.x = -Math.PI / 2;
    } else {
        // For walls/structures, align with the surface normal
        paintBlob.lookAt(position.clone().add(normal));
        paintBlob.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
    }
    
    // Store additional data with the paint splat
    paintBlob.userData.team = team;
    paintBlob.userData.radius = SPLAT_RADIUS;
    
    // Check for overlapping splats
    const overlappingSplats = paintSplats.filter(existingSplat => {
        const distance = position.distanceTo(existingSplat.position);
        return distance < (SPLAT_RADIUS + existingSplat.userData.radius);
    });
    
    // Process overlapping splats
    overlappingSplats.forEach(existingSplat => {
        const distance = position.distanceTo(existingSplat.position);
        const overlapAmount = 1 - (distance / (2 * SPLAT_RADIUS));
        
        if (overlapAmount > OVERLAP_THRESHOLD && existingSplat.userData.team !== team) {
            scene.remove(existingSplat);
            const index = paintSplats.indexOf(existingSplat);
            if (index > -1) {
                paintSplats.splice(index, 1);
            }
        }
    });
    
    scene.add(paintBlob);
    paintSplats.push(paintBlob);
    
    socket.emit('paintSurface', {
        position: position.toArray(),
        normal: normal.toArray(),
        team: team
    });
    
    updatePaintCoverage();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    
    // Update camera controls with smoothing
    if (controls) {
        controls.update();
    }
    
    // Update player movement and paint projectiles
    updatePlayerMovement(delta);
    updatePaintProjectiles(delta);
    
    // Update player body position to follow camera
    if (playerBody) {
        playerBody.position.x = camera.position.x;
        playerBody.position.z = camera.position.z;
        playerBody.position.y = camera.position.y - 1.7;
        playerBody.rotation.y = camera.rotation.y;
        
        // Send position update to server
        socket.emit('updatePosition', {
            position: [camera.position.x, camera.position.y - 1.7, camera.position.z],
            rotation: camera.rotation.y
        });
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
    renderer.render(scene, minimapCamera);
}

function selectTeam(teamColor) {
    playerTeam = teamColor;
    const teamColorHex = teamColor === 'red' ? 0xff0000 : 0x0000ff;
    
    // Update player model color
    if (playerBody) {
        playerBody.children.forEach(part => {
            if (part !== playerHitbox) { // Don't change hitbox color
                part.material.color.set(teamColorHex);
            }
        });
    }

    // Update weapon color
    if (weapon) {
        weapon.children.forEach(part => {
            part.material.color.set(teamColorHex);
        });
    }

    // Send join game event with initial position
    socket.emit('joinGame', {
        team: teamColor,
        position: [camera.position.x, camera.position.y - 1.7, camera.position.z],
        rotation: camera.rotation.y
    });
    
    document.getElementById('teamSelection').classList.add('hidden');
    document.getElementById('gameUI').classList.remove('hidden');
    
    // Hide cursor before locking pointer
    hideCursor();
    controls.lock();
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
        depthWrite: false
    });
    
    const paintBlob = new THREE.Mesh(paintGeometry, paintMaterial);
    paintBlob.position.copy(position);
    
    // Determine if the surface is the floor by checking the normal
    const isFloor = Math.abs(normal.y) > 0.9; // If the normal is pointing mostly up or down
    
    if (isFloor) {
        // For floor, rotate flat (around X axis)
        paintBlob.rotation.x = -Math.PI / 2;
    } else {
        // For walls/structures, align with the surface normal
        paintBlob.lookAt(position.clone().add(normal));
        paintBlob.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
    }
    
    // Store additional data with the paint splat
    paintBlob.userData.team = data.team;
    paintBlob.userData.radius = SPLAT_RADIUS;
    
    // Check for overlapping splats
    const overlappingSplats = paintSplats.filter(existingSplat => {
        const distance = position.distanceTo(existingSplat.position);
        return distance < (SPLAT_RADIUS + existingSplat.userData.radius);
    });
    
    // Process overlapping splats
    overlappingSplats.forEach(existingSplat => {
        const distance = position.distanceTo(existingSplat.position);
        const overlapAmount = 1 - (distance / (2 * SPLAT_RADIUS));
        
        if (overlapAmount > OVERLAP_THRESHOLD && existingSplat.userData.team !== data.team) {
            scene.remove(existingSplat);
            const index = paintSplats.indexOf(existingSplat);
            if (index > -1) {
                paintSplats.splice(index, 1);
            }
        }
    });
    
    scene.add(paintBlob);
    paintSplats.push(paintBlob);
    
    updatePaintCoverage();
});

socket.on('hit', (data) => {
    console.log('Hit received from server with data:', data);
    playerHits = data.currentHits;
    document.getElementById('hits').textContent = `Hits: ${playerHits}/3`;
    
    // Visual feedback for being hit
    if (playerBody) {
        // Flash the player model red briefly
        playerBody.children.forEach(part => {
            if (part !== playerHitbox) {
                const originalColor = part.material.color.clone();
                part.material.color.setHex(0xff0000);
                setTimeout(() => {
                    part.material.color.copy(originalColor);
                }, 200);
            }
        });

        // Create hit effect at the hit position
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
            setTimeout(() => scene.remove(hitEffect), 200);
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
    camera.position.set(0, 1.7, 0);
    if (playerBody) {
        playerBody.position.set(0, 0, 0);
    }
    controls.moveRight(0);
    controls.moveForward(0);
    
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
    controls.unlock();
    
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
    if (id === socket.id) return;
    
    // Create player model for the new player
    const playerModels = createPlayerModel(team === 'red' ? 0xff0000 : 0x0000ff);
    const playerModel = playerModels.model;
    
    // Set initial position and rotation
    playerModel.position.fromArray(position);
    playerModel.rotation.y = rotation;

    // Store references to limbs for animation
    playerModel.userData.leftLeg = playerModel.children.find(child => child.position.x < 0 && child.position.y < 0.5);
    playerModel.userData.rightLeg = playerModel.children.find(child => child.position.x > 0 && child.position.y < 0.5);
    playerModel.userData.leftArm = playerModel.children.find(child => child.position.x < 0 && child.position.y > 0.5);
    playerModel.userData.rightArm = playerModel.children.find(child => child.position.x > 0 && child.position.y > 0.5);
    playerModel.userData.animationTime = 0;
    
    // Store in otherPlayers map
    otherPlayers.set(id, playerModel);
    scene.add(playerModel);
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
    const { id, position, rotation, animationState } = data;
    
    // Don't update our own position
    if (id === socket.id) return;
    
    const playerModel = otherPlayers.get(id);
    if (playerModel) {
        // Smoothly interpolate to new position and rotation
        const targetPosition = new THREE.Vector3().fromArray(position);
        playerModel.position.lerp(targetPosition, 0.3);
        playerModel.rotation.y = rotation;

        // Apply animations based on state
        if (animationState) {
            const walkFrequency = 2;
            const runFrequency = 3;
            const walkAmplitude = Math.PI / 4;
            const runAmplitude = Math.PI / 3;
            const jumpAmplitude = Math.PI / 2.5;

            if (animationState.isJumping) {
                // Jump animation
                playerModel.userData.leftLeg.rotation.x = jumpAmplitude * 0.5;
                playerModel.userData.rightLeg.rotation.x = jumpAmplitude * 0.5;
                playerModel.userData.leftArm.rotation.x = -jumpAmplitude;
                playerModel.userData.rightArm.rotation.x = -jumpAmplitude * 0.3;
            } else if (animationState.isMoving) {
                // Walking/Running animation
                const frequency = animationState.isSprinting ? runFrequency : walkFrequency;
                const amplitude = animationState.isSprinting ? runAmplitude : walkAmplitude;
                
                playerModel.userData.animationTime = animationState.animationTime;
                
                // Apply animations
                playerModel.userData.leftLeg.rotation.x = Math.sin(playerModel.userData.animationTime * frequency) * amplitude;
                playerModel.userData.rightLeg.rotation.x = -Math.sin(playerModel.userData.animationTime * frequency) * amplitude;
                playerModel.userData.leftArm.rotation.x = -Math.sin(playerModel.userData.animationTime * frequency) * amplitude;
                playerModel.userData.rightArm.rotation.x = Math.sin(playerModel.userData.animationTime * frequency) * (amplitude * 0.3);

                if (animationState.isSprinting) {
                    const sideAmplitude = Math.PI / 24;
                    playerModel.userData.leftArm.rotation.z = -Math.PI / 6 + Math.cos(playerModel.userData.animationTime * frequency) * sideAmplitude;
                    playerModel.userData.rightArm.rotation.z = Math.PI / 6 - Math.cos(playerModel.userData.animationTime * frequency) * sideAmplitude;
                }
            } else {
                // Reset to idle pose
                playerModel.userData.leftLeg.rotation.x = 0;
                playerModel.userData.rightLeg.rotation.x = 0;
                playerModel.userData.leftArm.rotation.x = 0;
                playerModel.userData.rightArm.rotation.x = 0;
                playerModel.userData.leftArm.rotation.z = -Math.PI / 6;
                playerModel.userData.rightArm.rotation.z = Math.PI / 6;
            }
        }
    }
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
        
        const playerModels = createPlayerModel(data.team === 'red' ? 0xff0000 : 0x0000ff);
        const playerModel = playerModels.model;
        playerModel.position.fromArray(data.position);
        playerModel.rotation.y = data.rotation;

        // Store references to limbs for animation
        playerModel.userData.leftLeg = playerModel.children.find(child => child.position.x < 0 && child.position.y < 0.5);
        playerModel.userData.rightLeg = playerModel.children.find(child => child.position.x > 0 && child.position.y < 0.5);
        playerModel.userData.leftArm = playerModel.children.find(child => child.position.x < 0 && child.position.y > 0.5);
        playerModel.userData.rightArm = playerModel.children.find(child => child.position.x > 0 && child.position.y > 0.5);
        playerModel.userData.animationTime = 0;
        
        otherPlayers.set(id, playerModel);
        scene.add(playerModel);
    });
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

// Initialize the game
try {
    init();
} catch (error) {
    console.error("Error during game initialization:", error);
}

