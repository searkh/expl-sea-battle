'use strict';

const Online = (() => {
  let socket = null;
  let onState = null;
  let onLeft = null;

  function connect() {
    if (socket) return socket;
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('state', (payload) => {
      if (onState) onState(payload);
    });
    socket.on('opponentLeft', () => {
      if (onLeft) onLeft();
    });
    return socket;
  }

  function createRoom(name) {
    return new Promise((resolve) => {
      connect().emit('createRoom', { name }, (res) => resolve(res || { ok: false }));
    });
  }

  function joinRoom(code, name) {
    return new Promise((resolve) => {
      connect().emit('joinRoom', { code, name }, (res) => resolve(res || { ok: false }));
    });
  }

  function send(action) {
    if (!socket) return;
    socket.emit('action', action);
  }

  function setHandlers(handlers) {
    onState = handlers.onState || null;
    onLeft = handlers.onLeft || null;
  }

  return { connect, createRoom, joinRoom, send, setHandlers };
})();
