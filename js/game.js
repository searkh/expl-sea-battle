'use strict';

const SeaBattle = (() => {
  const SIZE = 10;
  const COLS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
  const TYPES = [
    { size: 4, name: 'Линкор', count: 1 },
    { size: 3, name: 'Крейсер', count: 2 },
    { size: 2, name: 'Эсминец', count: 3 },
    { size: 1, name: 'Катер', count: 4 },
  ];

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function fleetSpecs() {
    const specs = [];
    TYPES.forEach((type) => {
      for (let i = 0; i < type.count; i += 1) {
        specs.push({ id: `${type.size}-${i}`, size: type.size, name: type.name });
      }
    });
    return specs;
  }

  function createPlayer(name) {
    return {
      name,
      grid: emptyGrid(),
      ships: [],
      shots: {},
    };
  }

  function shipCells(r, c, size, orientation) {
    const cells = [];
    for (let i = 0; i < size; i += 1) {
      cells.push(orientation === 'h' ? { r, c: c + i } : { r: r + i, c });
    }
    return cells;
  }

  function inBounds(cells) {
    return cells.every((cell) => cell.r >= 0 && cell.c >= 0 && cell.r < SIZE && cell.c < SIZE);
  }

  function canPlace(player, cells) {
    if (!inBounds(cells)) return false;
    return cells.every((cell) => {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = cell.r + dr;
          const cc = cell.c + dc;
          if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
          if (player.grid[rr][cc]) return false;
        }
      }
      return true;
    });
  }

  function placeShip(player, spec, r, c, orientation) {
    if (player.ships.some((ship) => ship.id === spec.id)) return false;
    const cells = shipCells(r, c, spec.size, orientation);
    if (!canPlace(player, cells)) return false;
    cells.forEach((cell) => {
      player.grid[cell.r][cell.c] = spec.id;
    });
    player.ships.push({
      id: spec.id,
      size: spec.size,
      name: spec.name,
      cells,
      sunk: false,
    });
    return true;
  }

  function removeShip(player, shipId) {
    const ship = player.ships.find((item) => item.id === shipId);
    if (!ship) return false;
    ship.cells.forEach((cell) => {
      player.grid[cell.r][cell.c] = null;
    });
    player.ships = player.ships.filter((item) => item.id !== shipId);
    return true;
  }

  function clearFleet(player) {
    player.grid = emptyGrid();
    player.ships = [];
  }

  function placeRandom(player, specs) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      clearFleet(player);
      let ok = true;
      for (let s = 0; s < specs.length; s += 1) {
        const spec = specs[s];
        const options = [];
        for (let r = 0; r < SIZE; r += 1) {
          for (let c = 0; c < SIZE; c += 1) {
            ['h', 'v'].forEach((orientation) => {
              const cells = shipCells(r, c, spec.size, orientation);
              if (canPlace(player, cells)) options.push({ r, c, orientation });
            });
          }
        }
        if (!options.length) {
          ok = false;
          break;
        }
        const pick = options[Math.floor(Math.random() * options.length)];
        if (!placeShip(player, spec, pick.r, pick.c, pick.orientation)) {
          ok = false;
          break;
        }
      }
      if (ok && player.ships.length === specs.length) return true;
    }
    clearFleet(player);
    return false;
  }

  function shotKey(r, c) {
    return `${r},${c}`;
  }

  function splashAround(player, ship) {
    ship.cells.forEach((cell) => {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const r = cell.r + dr;
          const c = cell.c + dc;
          if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) continue;
          const key = shotKey(r, c);
          if (player.shots[key]) continue;
          if (player.grid[r][c]) continue;
          player.shots[key] = 'miss';
        }
      }
    });
  }

  function allSunk(player) {
    return player.ships.length > 0 && player.ships.every((ship) => ship.sunk);
  }

  function fire(defender, r, c) {
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return { ok: false, reason: 'bounds' };
    const key = shotKey(r, c);
    if (defender.shots[key]) return { ok: false, reason: 'repeat' };
    const shipId = defender.grid[r][c];
    if (!shipId) {
      defender.shots[key] = 'miss';
      return { ok: true, result: 'miss', allSunk: false };
    }
    defender.shots[key] = 'hit';
    const ship = defender.ships.find((item) => item.id === shipId);
    const sunk = ship.cells.every((cell) => defender.shots[shotKey(cell.r, cell.c)] === 'hit');
    if (sunk) {
      ship.sunk = true;
      splashAround(defender, ship);
    }
    return {
      ok: true,
      result: sunk ? 'sunk' : 'hit',
      shipName: ship.name,
      allSunk: allSunk(defender),
    };
  }

  function fleetStatus(player) {
    return TYPES.map((type) => {
      const ships = player.ships.filter((ship) => ship.size === type.size);
      const sunk = ships.filter((ship) => ship.sunk).length;
      return {
        name: type.name,
        size: type.size,
        total: type.count,
        afloat: ships.length - sunk,
      };
    });
  }

  return {
    SIZE,
    COLS,
    fleetSpecs,
    createPlayer,
    shipCells,
    canPlace,
    placeShip,
    removeShip,
    clearFleet,
    placeRandom,
    fire,
    allSunk,
    fleetStatus,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SeaBattle;
}
