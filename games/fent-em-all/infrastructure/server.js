// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",  // You could also specify the exact origin(s)
    methods: ["GET", "POST"]
  }
});
const path = require('path');
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory.
app.use(express.static(__dirname));

/*
  players: will be an object keyed by persistent userId.
  Each player object includes:
    - userId: the persistent ID from the client.
    - socketId: the current ephemeral socket id.
    - number: a sequential number for lobby ordering.
    - x, y, rotation, health, alive: gameplay state.
    - socket: the actual socket object (optional, for convenience).
*/
let players = {};
let nextPlayerNumber = 1; // Global counter for player numbers

io.on('connection', (socket) => {
  // Extract the persistent user id from the handshake query.
  const userId = socket.handshake.query.userId;
  console.log(`User connected: socket id ${socket.id}, persistent userId: ${userId}`);
  
  // Check if this persistent user already has an active connection.
  if (players[userId]) {
    console.log(`Duplicate connection for userId ${userId} detected. Disconnecting old socket ${players[userId].socketId}.`);
    // Disconnect the old socket connection.
    players[userId].socket.disconnect();
    // Remove the old record.
    delete players[userId];
  }
  
  // Add this player keyed by its persistent userId.
  players[userId] = {
    userId: userId,         // persistent id from client
    socketId: socket.id,    // current socket id
    number: nextPlayerNumber,
    x: 400,
    y: 300,
    rotation: 0,
    health: 3,
    alive: true,
  };
  nextPlayerNumber++;
  
  // Send current players (using persistent IDs) to the new client.
  socket.emit('currentPlayers', players);
  
  // Inform other clients about this new player.
  socket.broadcast.emit('newPlayer', players[userId]);
  
  // Broadcast the updated player count.
  io.emit('playerCount', Object.keys(players).length);
  
  // Listen for host to start the game.
  socket.on('startGame', () => {
    io.emit('startGame');
  });
  
  // Listen for player movement updates.
  socket.on('playerMovement', (movementData) => {
    if (players[userId]) {
      players[userId].x = movementData.x;
      players[userId].y = movementData.y;
      players[userId].rotation = movementData.rotation;
      // Broadcast this player's movement to all other clients.
      socket.broadcast.emit('playerMoved', players[userId]);
    }
  });
  
  // Listen for when a player dies.
  socket.on('playerDied', () => {
    if (players[userId]) {
      players[userId].alive = false;
      // Count how many players are still alive.
      const aliveCount = Object.values(players).filter(p => p.alive).length;
      console.log(`Player ${userId} died; ${aliveCount} still alive`);
      if (aliveCount === 0) {
        // All players are dead—notify everyone that the game is over.
        io.emit('gameOver');
      }
    }
  });
  
  // Optionally, listen for a reset request from a client.
  socket.on('requestResetGame', () => {
    io.emit('resetGame');
  });
  
  // Handle disconnections.
  socket.on('disconnect', () => {
    console.log(`User disconnected: socket id ${socket.id}, persistent userId: ${userId}`);
    delete players[userId];
    
    // Reset nextPlayerNumber if no players remain.
    if (Object.keys(players).length === 0) {
      nextPlayerNumber = 1;
    }
    
    // Inform all clients that this player has disconnected.
    io.emit('playerDisconnected', userId);
    io.emit('playerCount', Object.keys(players).length);
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on ${PORT}`);
});
