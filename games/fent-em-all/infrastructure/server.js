// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" directory.
// app.use(express.static(__dirname)); //+ '/public'
app.use(express.static(path.join(__dirname, '../public')));

let players = {};
let nextPlayerNumber = 1; // Global counter for player numbers

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);
  
  // Assign the new player a number.
  players[socket.id] = {
    playerId: socket.id,
    number: nextPlayerNumber,
    x: 400,
    y: 300,
    rotation: 0,
    health: 3
  };
  nextPlayerNumber++;
  
  // Send current players (including their assigned numbers) to the new client.
  socket.emit('currentPlayers', players);
  
  // Inform others about the new player.
  socket.broadcast.emit('newPlayer', players[socket.id]);
  
  // Broadcast the updated player count.
  io.emit('playerCount', Object.keys(players).length);
  
  // Listen for startGame from the host and then broadcast it to all clients.
  socket.on('startGame', () => {
    io.emit('startGame');
  });
  
  // Listen for player movement.
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].rotation = movementData.rotation;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });
  
  // Handle disconnections.
socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
  
    // Reset nextPlayerNumber if no players remain.
    if (Object.keys(players).length === 0) {
      nextPlayerNumber = 1;
    }
  
    io.emit('playerDisconnected', socket.id);
    io.emit('playerCount', Object.keys(players).length);
  });  
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on ${PORT}`);
});
