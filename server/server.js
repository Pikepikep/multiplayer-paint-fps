const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Game state
const players = new Map();
const MAX_PLAYERS = 50;
const TEAMS = {
    RED: 'red',
    BLUE: 'blue'
};

// Track team counts
let teamCounts = {
    [TEAMS.RED]: 0,
    [TEAMS.BLUE]: 0
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Serve static files from the 'client' directory
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Serve index.html explicitly when accessing "/"
app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Handle player joining the game
    socket.on('joinGame', (data) => {
        if (players.size >= MAX_PLAYERS) {
            socket.emit('error', { message: 'Server is full' });
            return;
        }

        const { team, position, rotation } = data;
        
        // Add player to the game state
        players.set(socket.id, {
            id: socket.id,
            team,
            position,
            rotation,
            hits: 0
        });

        // Update team counts
        teamCounts[team]++;

        // Send current players to the new player
        const playersData = {};
        players.forEach((player, id) => {
            if (id !== socket.id) {
                playersData[id] = player;
            }
        });
        socket.emit('currentPlayers', playersData);

        // Notify other players about the new player
        socket.broadcast.emit('playerJoined', {
            id: socket.id,
            team,
            position,
            rotation
        });

        console.log(`Player ${socket.id} joined team ${team}`);
        console.log('Current team counts:', teamCounts);
    });

    // Handle player position updates
    socket.on('updatePosition', (data) => {
        const player = players.get(socket.id);
        if (player) {
            player.position = data.position;
            player.rotation = data.rotation;
            player.animationState = data.animationState;

            // Broadcast position update to other players
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                position: data.position,
                rotation: data.rotation,
                animationState: data.animationState
            });
        }
    });

    // Handle paint surface events
    socket.on('paintSurface', (data) => {
        // Broadcast paint event to all players except sender
        socket.broadcast.emit('paintSurface', data);
    });

    // Handle player hits
    socket.on('playerHit', (data) => {
        const hitPlayer = players.get(data.hitPlayerId);
        if (hitPlayer) {
            hitPlayer.hits++;
            
            // Emit hit event to the hit player
            io.to(data.hitPlayerId).emit('hit', {
                currentHits: hitPlayer.hits,
                hitPosition: data.position,
                projectileTeam: data.projectileTeam
            });

            // Check if player needs to respawn
            if (hitPlayer.hits >= 3) {
                hitPlayer.hits = 0;
                io.to(data.hitPlayerId).emit('respawn');
            }
        }
    });

    // Handle player disconnection
    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            // Update team counts
            teamCounts[player.team]--;
            
            // Remove player from game state
            players.delete(socket.id);
            
            // Notify other players
            socket.broadcast.emit('playerLeft', socket.id);
            
            console.log(`Player ${socket.id} disconnected from team ${player.team}`);
            console.log('Current team counts:', teamCounts);
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Maximum players supported: ${MAX_PLAYERS}`);
});
