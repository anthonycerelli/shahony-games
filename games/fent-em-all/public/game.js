// Define a base resolution for the game.
const BASE_WIDTH = 800;
const BASE_HEIGHT = 600;

// Global socket variable.
let socket;

// A very simple seeded random function.
function seededRandom(seed) {
  // Create a pseudo-random number between 0 and 1 based on the seed.
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Generate a fixed set of obstacle positions using a constant seed.
function getObstaclePositions() {
  const OBSTACLE_SEED = 12345;  // Change this seed to get a different layout.
  const positions = [];
  let seed = OBSTACLE_SEED;
  // For example, create 7 obstacles.
  for (let i = 0; i < 7; i++) {
    // Use the seededRandom function to generate x and y positions.
    const x = 50 + seededRandom(seed++) * (BASE_WIDTH - 100);
    const y = 50 + seededRandom(seed++) * (BASE_HEIGHT - 100);
    positions.push({ x, y });
  }
  return positions;
}

class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });
  }
  
  preload() {
    // Load the "dude" spritesheet (used for players and enemies).
    this.load.spritesheet('dude', 'https://labs.phaser.io/assets/sprites/dude.png', {
      frameWidth: 32,
      frameHeight: 48
    });
  }
  
  create() {
    // --- Animations ---
    this.anims.create({
      key: 'left',
      frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1
    });
    this.anims.create({
      key: 'turn',
      frames: [{ key: 'dude', frame: 4 }],
      frameRate: 20
    });
    this.anims.create({
      key: 'right',
      frames: this.anims.generateFrameNumbers('dude', { start: 5, end: 8 }),
      frameRate: 10,
      repeat: -1
    });
    this.anims.create({
      key: 'enemy_walk',
      frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }),
      frameRate: 6,
      repeat: -1
    });
    
    // --- Background & World Setup ---
    this.cameras.main.setBackgroundColor('#228B22');
    this.physics.world.setBounds(0, 0, BASE_WIDTH, BASE_HEIGHT);
    
    // --- Game State & Lobby ---
    this.gameStarted = false;  // Starts in lobby mode.
    this.isHost = false;       // Determined by Socket.IO join order.
    this.playerName = "Player" + Math.floor(Math.random() * 1000);
    this.isDead = false;
    
    // --- Player ---
    // Spawn the local player at the center (safe zone).
    this.player = this.physics.add.sprite(BASE_WIDTH / 2, BASE_HEIGHT / 2, 'dude');
    this.player.setCollideWorldBounds(true);
    // Reduce hitbox size to 20x30 with offset (for a 32x48 sprite).
    this.player.body.setSize(20, 30);
    this.player.body.setOffset(6, 9);
    this.player.lastDirection = new Phaser.Math.Vector2(0, 1);
    
    // --- Groups ---
    this.sprayGroup = this.physics.add.group();       // Player sprays.
    this.enemySprayGroup = this.physics.add.group();    // Enemy sprays.
    this.enemyGroup = this.physics.add.group();         // Enemies.
    this.otherPlayers = this.physics.add.group();       // Remote players.
    
    // --- Obstacles & Boundaries ---
    this.obstacles = this.physics.add.staticGroup();
    if (!this.textures.exists('tree')) {
      let gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x006400, 1);
      gfx.fillRect(0, 0, 60, 60);
      gfx.generateTexture('tree', 60, 60);
    }
    // Create obstacles using a fixed seed so all clients have the same layout.
    const obstaclePositions = getObstaclePositions();
    obstaclePositions.forEach((pos) => {
      this.obstacles.create(pos.x, pos.y, 'tree');
    });
    // Boundary obstacles.
    const boundaryThickness = 20;
    const topBottomScaleX = BASE_WIDTH / 60;
    const topBottomScaleY = boundaryThickness / 60;
    this.boundaryTop = this.obstacles.create(BASE_WIDTH / 2, boundaryThickness / 2, 'tree')
      .setScale(topBottomScaleX, topBottomScaleY)
      .refreshBody();
    this.boundaryBottom = this.obstacles.create(BASE_WIDTH / 2, BASE_HEIGHT - (boundaryThickness / 2), 'tree')
      .setScale(topBottomScaleX, topBottomScaleY)
      .refreshBody();
    const sideScaleX = 20 / 60;
    const sideScaleY = BASE_HEIGHT / 60;
    this.boundaryLeft = this.obstacles.create(20 / 2, BASE_HEIGHT / 2, 'tree')
      .setScale(sideScaleX, sideScaleY)
      .refreshBody();
    this.boundaryRight = this.obstacles.create(BASE_WIDTH - (20 / 2), BASE_HEIGHT / 2, 'tree')
      .setScale(sideScaleX, sideScaleY)
      .refreshBody();
    
    // --- Collisions ---
    this.physics.add.overlap(this.sprayGroup, this.enemyGroup, this.handleSprayHit, null, this);
    this.physics.add.overlap(this.enemySprayGroup, this.player, this.handleEnemySprayHit, null, this);
    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.enemyGroup, this.obstacles);
    this.physics.add.collider(this.sprayGroup, this.obstacles, (spray, obs) => { spray.destroy(); });
    this.physics.add.collider(this.enemySprayGroup, this.obstacles, (spray, obs) => { spray.destroy(); });
    // If the player touches an enemy, it's game over.
    this.physics.add.collider(this.player, this.enemyGroup, this.handlePlayerEnemyCollision, null, this);
    
    // --- Input ---
    // Use arrow keys for 8-direction movement.
    this.cursors = this.input.keyboard.createCursorKeys();
    this.sprayKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.startKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    
    // --- UI Texts ---
    this.lobbyText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2 - 50, '', { font: '32px Arial', fill: '#ffffff' }).setOrigin(0.5);
    this.lobbyCountText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2 + 10, '', { font: '28px Arial', fill: '#ffffff' }).setOrigin(0.5);
    this.statusText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2, '', { font: '48px Arial', fill: '#ffffff' }).setOrigin(0.5);
    this.statusText.setVisible(false);
    
    // --- Multiplayer: Socket.IO Integration ---
    // socket = io('http://localhost:3000');  // Ensure this is your server's address.
    // Simple UUID generator (or you can use a library like uuid)
    function generateUUID() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    // Check for a persistent id in localStorage
    let persistentId = localStorage.getItem('userId');
    if (!persistentId) {
      persistentId = generateUUID();
      localStorage.setItem('userId', persistentId);
    }
    
    // Save the persistentId to the scene so you can use it later.
    this.myUserId = persistentId;

    // Connect with Socket.IO, passing the persistent user id as a query parameter.
    socket = io('http://192.168.100.127:3000', {
      query: { userId: persistentId }
    }); 
    this.playerCount = 0;

    socket.on('connect', () => {
      console.log('Connected as', socket.id);
      // Save the socket id into a scene property.
      this.mySocketId = socket.id;
      
      socket.on('currentPlayers', (players) => {
        console.log("Current players received:", players);
        // Set local player number using the stored socket id.
        if (players[this.myUserId] && players[this.myUserId].number !== undefined) {
          this.myPlayerNumber = players[this.myUserId].number;
        }
        
        // Find the lowest player number among connected players.
        let lowest = Infinity;
        for (const id in players) {
          if (players[id].number < lowest) {
            lowest = players[id].number;
          }
        }
        // You are host if your player number equals the lowest.
        this.isHost = (this.myPlayerNumber === lowest);
        this.updateLobbyUI();
        // Add all other players.
        Object.values(players).forEach((player) => {
          if (player.socketId !== this.mySocketId) {  // <-- Fixed property check
            this.addOtherPlayer(player);
          }
        });
      });
      
      
      socket.on('newPlayer', (playerInfo) => {
        this.addOtherPlayer(playerInfo);
        this.playerCount++;
        this.updateLobbyUI();
      });
      
      socket.on('playerMoved', (playerInfo) => {
        this.otherPlayers.getChildren().forEach((otherPlayer) => {
          if (playerInfo.userId === otherPlayer.userId) {
            otherPlayer.setPosition(playerInfo.x, playerInfo.y);
            otherPlayer.rotation = playerInfo.rotation;
          }
        });
      });
      
      socket.on('gameOver', () => {
        this.gameOver = true;
        this.statusText.setText('Game Over!\nPress R to Restart');
        this.statusText.setVisible(true);
        this.children.bringToTop(this.statusText);
      });      
      
      socket.on('playerDisconnected', (userId) => {
        this.otherPlayers.getChildren().forEach((otherPlayer) => {
          if (userId === otherPlayer.userId) {
            otherPlayer.destroy();
          }
        });
        this.playerCount--;
        this.updateLobbyUI();
      });
      
      socket.on('playerCount', (count) => {
        this.playerCount = count;
        this.updateLobbyUI();
        if (this.gameStarted) {
          this.spawnEnemies();
        }
      });
      
      socket.on('startGame', () => {
        this.startGame();
      });
      
      socket.on('resetGame', () => {
        socket.disconnect();
        window.location.reload();
      });

      window.addEventListener('beforeunload', () => {
        if (socket) {
          socket.disconnect();
        }
      });
      
    });

  }
  
  update() {
    // Always update local movement and broadcast it.
    this.updateLocalMovement();
    socket.emit('playerMovement', {
      x: this.player.x,
      y: this.player.y,
      rotation: 0
    });
    
    if (!this.gameStarted) {
        this.updateLocalMovement();
        socket.emit('playerMovement', {
          x: this.player.x,
          y: this.player.y,
          rotation: 0
        });
        // Only the host can start the game.
        if (this.isHost && Phaser.Input.Keyboard.JustDown(this.startKey)) {
          socket.emit('startGame');
          this.startGame();
        }
        return;
      }
    
    // If game over, allow reset.
    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        // Force a disconnect before reloading so the old connection is cleaned up.
        socket.disconnect();
        window.location.reload();
      }
      return;
    }
    
    // In game: handle spraying.
    if (Phaser.Input.Keyboard.JustDown(this.sprayKey)) {
      this.spray();
    }
    
    // Update enemy chase behavior with separation (horde behavior).
    this.enemyGroup.getChildren().forEach((enemy) => {
      if (enemy.active) {
        this.updateEnemyChase(enemy);
      }
    });
    
    // Check victory condition.
    if (this.enemyGroup.countActive() === 0) {
      this.statusText.setText('Victory!\nPress R to Restart');
      this.statusText.setVisible(true);
      this.gameOver = true;
    }
  }  

  updateLobbyUI() {
    if (!this.gameStarted) {
      // Use the assigned player number; if undefined, default to "?".
      let playerNum = (this.myPlayerNumber !== undefined) ? this.myPlayerNumber : "?";
      
      if (this.isHost) {
        this.lobbyText.setText('Lobby: You are HOST (Player ' + playerNum + ')'+ '.\nPress S to Start');
      } else {
        this.lobbyText.setText('Lobby: You are Player ' + playerNum + '.\nWaiting for host to start');
      }
      this.lobbyCountText.setText('Players in Lobby: ' + this.playerCount);
      this.lobbyText.setVisible(true);
      this.lobbyCountText.setVisible(true);
    } else {
      this.lobbyText.setVisible(false);
      this.lobbyCountText.setVisible(false);
    }
}

  
  // Helper to update local player's movement.
  updateLocalMovement() {
    // Skip movement updates if the player is dead or if the body is missing.
    if (this.isDead || !this.player || !this.player.body) {
      return;
    }
    let moveX = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
    let moveY = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
    let speed = 220;
    if (moveX !== 0 || moveY !== 0) {
      let vec = new Phaser.Math.Vector2(moveX, moveY).normalize();
      this.player.setVelocity(vec.x * speed, vec.y * speed);
      this.player.lastDirection.copy(vec);
      if (vec.x < 0) {
        this.player.anims.play('left', true);
      } else if (vec.x > 0) {
        this.player.anims.play('right', true);
      } else {
        this.player.anims.play('turn');
      }
    } else {
      this.player.setVelocity(0, 0);
      this.player.anims.play('turn');
    }
  }
  
  
  // Helper to update enemy chase behavior with obstacle avoidance and separation.
  updateEnemyChase(enemy) {
    // Find the closest target among local and remote players.
    let target = this.player;
    let closestDist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    this.otherPlayers.getChildren().forEach((otherPlayer) => {
      let d = Phaser.Math.Distance.Between(enemy.x, enemy.y, otherPlayer.x, otherPlayer.y);
      if (d < closestDist) {
        closestDist = d;
        target = otherPlayer;
      }
    });
    
    // Desired direction toward the target.
    let desired = new Phaser.Math.Vector2(target.x - enemy.x, target.y - enemy.y);
    
    // Obstacle avoidance.
    this.obstacles.getChildren().forEach((obs) => {
      let d = Phaser.Math.Distance.Between(enemy.x, enemy.y, obs.x, obs.y);
      let avoidanceThreshold = 50;
      if (d < avoidanceThreshold) {
        let away = new Phaser.Math.Vector2(enemy.x - obs.x, enemy.y - obs.y).normalize();
        let weight = (avoidanceThreshold - d) / avoidanceThreshold;
        desired.add(away.scale(weight));
      }
    });
    
    // Separation force: prevent enemies from stacking.
    let separation = new Phaser.Math.Vector2(0, 0);
    let separationThreshold = 30;
    this.enemyGroup.getChildren().forEach((other) => {
      if (other !== enemy && other.active) {
        let d = Phaser.Math.Distance.Between(enemy.x, enemy.y, other.x, other.y);
        if (d < separationThreshold && d > 0) {
          let diff = new Phaser.Math.Vector2(enemy.x - other.x, enemy.y - other.y).normalize();
          diff.scale((separationThreshold - d) / separationThreshold);
          separation.add(diff);
        }
      }
    });
    desired.add(separation);
    desired.normalize();
    
    let chaseSpeed = 180;
    enemy.body.velocity.x = desired.x * chaseSpeed;
    enemy.body.velocity.y = desired.y * chaseSpeed;
  }
  
  // Helper to add remote players.
  addOtherPlayer(playerInfo) {
    const otherPlayer = this.physics.add.sprite(playerInfo.x, playerInfo.y, 'dude');
    otherPlayer.userId = playerInfo.userId;
    otherPlayer.setTint(0x0000ff);
    otherPlayer.body.setSize(20, 30);
    otherPlayer.body.setOffset(6, 9);
    this.otherPlayers.add(otherPlayer);
  }
  
  startGame() {
    // Hide lobby texts immediately.
    this.lobbyText.setVisible(false);
    this.lobbyCountText.setVisible(false);
  
    // Create and display the countdown text.
    this.countdownText = this.add.text(BASE_WIDTH / 2, BASE_HEIGHT / 2, '', {
      font: '64px Arial',
      fill: '#ffffff'
    }).setOrigin(0.5);

    // Show "3" for 1 second.
    this.time.delayedCall(0, () => {
      this.countdownText.setText('3');
    }, [], this);
  
    // Show "3" for 1 second.
    this.time.delayedCall(1000, () => {
      this.countdownText.setText('2');
    }, [], this);
  
    // After 2 seconds, show "1".
    this.time.delayedCall(2000, () => {
      this.countdownText.setText('1');
    }, [], this);
  
    // After 3 seconds, show "Go!".
    this.time.delayedCall(3000, () => {
      this.countdownText.setText('Go!');
    }, [], this);
  
    // After 4 seconds, remove the countdown text, mark the game as started, and spawn enemies.
    this.time.delayedCall(4000, () => {
      this.countdownText.destroy();
      this.gameStarted = true;
      this.spawnEnemies();
    }, [], this);
  }  
  
  // Helper to get a valid spawn point (avoiding the central safe zone).
  getValidSpawnPoint(minDistanceFromCenter = 100, minDistanceFromPlayer = 100) {
    let candidate;
    let attempts = 0;
    do {
      candidate = {
        x: Phaser.Math.Between(50, BASE_WIDTH - 50),
        y: Phaser.Math.Between(50, BASE_HEIGHT - 50)
      };
      attempts++;
    } while (
      (Phaser.Math.Distance.Between(candidate.x, candidate.y, BASE_WIDTH / 2, BASE_HEIGHT / 2) < minDistanceFromCenter ||
       Phaser.Math.Distance.Between(candidate.x, candidate.y, this.player.x, this.player.y) < minDistanceFromPlayer)
       && attempts < 100
    );
    return candidate;
  }
  
  // Spawn enemies using safe spawn points.
  spawnEnemies() {
    this.enemyGroup.clear(true, true);
    const totalEnemies = this.playerCount * 5;
    for (let i = 0; i < totalEnemies; i++) {
      let pos = this.getValidSpawnPoint(150, 100);
      let enemy = this.physics.add.sprite(pos.x, pos.y, 'dude');
      enemy.setTint(0xff0000);
      enemy.setCollideWorldBounds(true);
      enemy.setBounce(1);
      enemy.body.setSize(20, 30);
      enemy.body.setOffset(6, 9);
      let angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      let speed = Phaser.Math.Between(150, 200);
      enemy.body.velocity.x = Math.cos(angle) * speed;
      enemy.body.velocity.y = Math.sin(angle) * speed;
      enemy.play('enemy_walk');
      enemy.isArmed = true;
      this.time.addEvent({
        delay: Phaser.Math.Between(2000, 4000),
        callback: () => {
          if (enemy.active && this.player.active && !this.gameOver) {
            this.enemyShoot(enemy);
          }
        },
        callbackScope: this,
        loop: true
      });
      this.enemyGroup.add(enemy);
    }
  }
  
  spray() {
    if (!this.textures.exists('spray')) {
      let gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x00ff00, 1);
      gfx.fillRect(0, 0, 10, 10);
      gfx.generateTexture('spray', 10, 10);
    }
    let spray = this.sprayGroup.create(this.player.x, this.player.y, 'spray');
    spray.body.setAllowGravity(false);
    spray.setSize(10, 10);
    let spraySpeed = 300;
    spray.setVelocity(this.player.lastDirection.x * spraySpeed, this.player.lastDirection.y * spraySpeed);
    this.time.addEvent({
      delay: 2000,
      callback: () => { if (spray.active) spray.destroy(); }
    });
  }
  
  // When a player's spray hits an enemy, play a death animation.
  handleSprayHit(spray, enemy) {
    enemy.body.enable = false;
    enemy.setTint(0x808080);
    this.tweens.add({
      targets: enemy,
      angle: enemy.angle + 90,
      alpha: 0,
      duration: 500,
      onComplete: () => {
        enemy.setActive(false);
        enemy.setVisible(false);
      }
    });
    spray.destroy();
  }
  
  enemyShoot(enemy) {
    // Create a red dot texture for enemy projectiles if it doesn't already exist.
    if (!this.textures.exists('enemySpray')) {
      let gfx = this.make.graphics({ x: 0, y: 0, add: false });
      // Draw a small red circle with radius 5 (i.e., 10px diameter).
      gfx.fillStyle(0xff0000, 1);
      gfx.fillCircle(5, 5, 5);
      gfx.generateTexture('enemySpray', 10, 10);
    }
    // Create the enemy projectile using the "enemySpray" texture.
    let spray = this.enemySprayGroup.create(enemy.x, enemy.y, 'enemySpray');
    spray.body.setAllowGravity(false);
    spray.setSize(10, 10);
    // Compute direction from enemy to player.
    let direction = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
    let spraySpeed = 300;
    spray.setVelocity(direction.x * spraySpeed, direction.y * spraySpeed);
    // Destroy the projectile after 2 seconds.
    this.time.addEvent({
      delay: 2000,
      callback: () => { if (spray.active) spray.destroy(); }
    });
  }
  
  handleEnemySprayHit(spray, player) {
    // Only process if this player is not already dead.
    if (!spray.active || !player.active || this.isDead) return;
    
    // Mark this player as dead and notify the server.
    this.isDead = true;
    socket.emit('playerDied');
    
    // Change appearance to show damage.
    player.setTint(0xff0000);
    player.anims.stop();
    
    // (You may want to stop further input here, but do not display Game Over text yet.)
    spray.destroy();
  }
  
  handlePlayerEnemyCollision(player, enemy) {
    if (this.isDead) return;
    
    this.isDead = true;
    socket.emit('playerDied');
    
    player.setTint(0xff0000);
    player.anims.stop();
    // Do not display Game Over text until the server signals that all players have lost.
  }  
   
  
  changeEnemyDirections() {
    // (This fallback method is kept, though enemies now actively chase.)
    this.enemyGroup.children.iterate((enemy) => {
      if (enemy && enemy.body) {
        let angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        let speed = Phaser.Math.Between(150, 200);
        enemy.body.velocity.x = Math.cos(angle) * speed;
        enemy.body.velocity.y = Math.sin(angle) * speed;
      }
    });
  }
}

// --- Phaser Game Configuration ---
const config = {
  type: Phaser.AUTO,
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  backgroundColor: '#228B22',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: MainScene
};

const game = new Phaser.Game(config);
