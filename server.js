'use strict';

const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const SeaBattle = require('./js/game.js');

const PORT = process.env.PORT || 3000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function cleanName(value, fallback) {
  const name = String(value || '').trim().slice(0, 18);
  return name || fallback;
}

function createRoomState(nameHost) {
  return {
    code: randomCode(),
    sockets: [null, null],
    names: [cleanName(nameHost, 'Игрок 1'), 'Игрок 2'],
    phase: 'lobby',
    specs: SeaBattle.fleetSpecs(),
    players: [SeaBattle.createPlayer('Игрок 1'), SeaBattle.createPlayer('Игрок 2')],
    placementReady: [false, false],
    current: 0,
    locked: false,
    winner: null,
    log: '',
    lastShot: null,
    lastResult: null,
  };
}

const rooms = new Map();

function findRoomByCode(code) {
  const upper = String(code || '').trim().toUpperCase();
  for (const room of rooms.values()) {
    if (room.code === upper) return room;
  }
  return null;
}

function playerIndex(room, socketId) {
  return room.sockets.indexOf(socketId);
}

function stripPlayerForClient(player, view) {
  if (view === 'full') {
    return {
      name: player.name,
      grid: player.grid,
      ships: player.ships.map((s) => ({
        id: s.id,
        size: s.size,
        name: s.name,
        cells: s.cells,
        sunk: s.sunk,
      })),
      shots: player.shots,
    };
  }
  return {
    name: player.name,
    shots: player.shots,
    ships: player.ships.map((s) => ({
      id: s.id,
      size: s.size,
      name: s.name,
      sunk: s.sunk,
      cells: s.sunk ? s.cells : undefined,
    })),
  };
}

function clientPayload(room, idx) {
  const enemy = 1 - idx;
  const bothReady = room.placementReady[0] && room.placementReady[1];
  let phase = room.phase;
  if (phase === 'place' && bothReady) phase = 'battle';

  const payload = {
    code: room.code,
    playerIndex: idx,
    phase,
    lobby: phase === 'lobby',
    placementReady: room.placementReady.slice(),
    current: room.current,
    locked: room.locked,
    winner: room.winner,
    log: room.log,
    lastShot: room.lastShot,
    names: room.names.slice(),
    you: stripPlayerForClient(room.players[idx], 'full'),
    enemy: stripPlayerForClient(room.players[enemy], phase === 'over' ? 'full' : 'public'),
    specs: room.specs,
  };

  if (phase === 'over') {
    payload.enemy = stripPlayerForClient(room.players[enemy], 'full');
  }

  return payload;
}

function emitRoom(room) {
  room.sockets.forEach((sid, idx) => {
    if (!sid) return;
    const io = global.__io;
    io.to(sid).emit('state', clientPayload(room, idx));
  });
}

function startBattle(room) {
  room.phase = 'battle';
  room.current = Math.random() < 0.5 ? 0 : 1;
  room.locked = false;
  room.lastShot = null;
  room.lastResult = null;
  room.log = `Бой начался. Первым ходит ${room.names[room.current]}.`;
  emitRoom(room);
}

function handleReady(room, idx) {
  const player = room.players[idx];
  if (player.ships.length !== room.specs.length) return;
  room.placementReady[idx] = true;
  room.players[idx].name = room.names[idx];
  if (room.placementReady[0] && room.placementReady[1]) {
    startBattle(room);
    return;
  }
  room.log = room.placementReady[0] && room.placementReady[1]
    ? room.log
    : 'Ждём расстановку соперника…';
  emitRoom(room);
}

function handleFire(room, idx, r, c) {
  if (room.phase !== 'battle' || room.locked) return;
  if (idx !== room.current) return;
  const defender = room.players[1 - idx];
  const result = SeaBattle.fire(defender, r, c);
  if (!result.ok) {
    room.log = 'Сюда уже стреляли.';
    emitRoom(room);
    return;
  }
  room.lastShot = { r, c, board: 'enemy' };
  room.lastResult = result;
  if (result.allSunk) {
    room.phase = 'over';
    room.winner = idx;
    room.locked = false;
    room.log = `${room.names[idx]} уничтожил флот противника.`;
    emitRoom(room);
    return;
  }
  if (result.result === 'miss') {
    room.current = 1 - idx;
    room.locked = false;
    room.lastShot = null;
    room.log = `Промах. Ход ${room.names[room.current]}.`;
    emitRoom(room);
    return;
  }
  if (result.result === 'sunk') {
    room.log = `Потоплен ${result.shipName}. ${room.names[idx]} стреляет снова.`;
  } else {
    room.log = 'Попадание. Ход продолжается.';
  }
  emitRoom(room);
}

function rematch(room) {
  room.phase = 'place';
  room.specs = SeaBattle.fleetSpecs();
  room.players = [
    SeaBattle.createPlayer(room.names[0]),
    SeaBattle.createPlayer(room.names[1]),
  ];
  room.placementReady = [false, false];
  room.current = 0;
  room.locked = false;
  room.winner = null;
  room.lastShot = null;
  room.lastResult = null;
  room.log = 'Новая партия — расставьте флот.';
  emitRoom(room);
}

function leaveRoom(room, socketId) {
  const idx = playerIndex(room, socketId);
  if (idx === -1) return;
  room.sockets[idx] = null;
  const other = 1 - idx;
  const otherSid = room.sockets[other];
  if (otherSid) {
    room.phase = 'lobby';
    room.placementReady = [false, false];
    global.__io.to(otherSid).emit('opponentLeft');
  }
  rooms.delete(room.code);
}

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer);
global.__io = io;

const root = __dirname;
app.use(
  express.static(root, {
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

io.on('connection', (socket) => {
  let joinedCode = null;

  socket.on('createRoom', (data, ack) => {
    let room;
    do {
      room = createRoomState(data?.name);
    } while (rooms.has(room.code));
    room.sockets[0] = socket.id;
    room.names[0] = cleanName(data?.name, 'Игрок 1');
    room.players[0].name = room.names[0];
    rooms.set(room.code, room);
    joinedCode = room.code;
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    emitRoom(room);
  });

  socket.on('joinRoom', (data, ack) => {
    const room = findRoomByCode(data?.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Комната не найдена.' });
      return;
    }
    if (room.sockets[1]) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Комната уже полная.' });
      return;
    }
    room.sockets[1] = socket.id;
    room.names[1] = cleanName(data?.name, 'Игрок 2');
    room.players[1].name = room.names[1];
    room.phase = 'place';
    room.log = 'Расставьте корабли. Соперник не видит ваше поле.';
    joinedCode = room.code;
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    emitRoom(room);
  });

  socket.on('action', (msg) => {
    const room = rooms.get(joinedCode);
    if (!room) return;
    const idx = playerIndex(room, socket.id);
    if (idx === -1) return;
    const player = room.players[idx];
    const { type } = msg || {};

    if (type === 'place') {
      if (room.phase !== 'place' || room.placementReady[idx]) return;
      const { r, c, shipId, orientation, sub } = msg;
      if (sub === 'remove') {
        SeaBattle.removeShip(player, shipId);
      } else if (sub === 'random') {
        SeaBattle.placeRandom(player, room.specs);
      } else if (sub === 'clear') {
        SeaBattle.clearFleet(player);
      } else if (sub === 'cell') {
        const spec = room.specs.find((s) => s.id === shipId);
        if (!spec) return;
        const occupied = player.grid[r]?.[c];
        if (occupied) {
          SeaBattle.removeShip(player, occupied);
        } else {
          SeaBattle.placeShip(player, spec, r, c, orientation || 'h');
        }
      }
      emitRoom(room);
      return;
    }

    if (type === 'ready') {
      if (room.phase !== 'place') return;
      handleReady(room, idx);
      return;
    }

    if (type === 'fire') {
      handleFire(room, idx, msg.r, msg.c);
      return;
    }

    if (type === 'rematch') {
      rematch(room);
    }
  });

  socket.on('disconnect', () => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    leaveRoom(room, socket.id);
    joinedCode = null;
  });
});

const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`Морской бой слушает ${HOST}:${PORT}`);
  console.log('Локально: http://localhost:' + PORT);
  console.log('Из других мест: опубликуйте этот сервер (хостинг или туннель) и дайте игрокам одну ссылку.');
});
