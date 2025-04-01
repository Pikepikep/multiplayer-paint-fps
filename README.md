# Multiplayer Paint FPS

A multiplayer first-person shooter game where players paint the environment and battle against each other. Created for Vibe Jam 2025.

## Features

- Team-based gameplay (Red vs Blue)
- Paint-based shooting mechanics
- Real-time multiplayer with WebSocket support
- 3D environment with paintable surfaces
- Player hitboxes and collision detection
- Minimap and paint coverage tracking
- Portal system for game transitions

## Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open http://localhost:3000 in your browser

## Deployment

The game can be deployed to any Node.js hosting platform. It requires:

- Node.js >= 18.0.0
- Environment Variables (optional):
  - `PORT`: Server port (default: 3000)
  - `HOST`: Server host (default: 0.0.0.0)
  - `CORS_ORIGIN`: CORS origin for WebSocket (default: *)
  - `NODE_ENV`: Environment (development/production)

### Deployment Steps

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the server: `npm start`

The server will automatically serve the client files from the `client` directory.

## License

All rights reserved. Created for Vibe Jam 2025. 
