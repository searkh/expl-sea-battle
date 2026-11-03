'use strict';

/** img/water-tile-36px.png — фон клетки; img/ships/* — секции и *-burning */
const Atlas = (() => {
  const water = 'img/water-tile-36px.png';

  const sailors = [
    'img/sailor-1.png',
    'img/sailor-2.png',
    'img/sailor-3.png',
  ];

  const file = {
    head: { h: 'bow-horizontal', v: 'bow-vertical' },
    mid: { h: 'middle-horizontal', v: 'middle-vertical' },
    tail: { h: 'stern-horizontal', v: 'stern-vertical' },
    single: { h: 'single-horizontal', v: 'single-vertical' },
  };

  function segmentSrc(part, ori, burning) {
    const base = (file[part] || file.mid)[ori] || file.mid.h;
    const name = burning ? `${base}-burning.png` : `${base}.png`;
    return `img/ships/${name}`;
  }

  function waterSrc() {
    return water;
  }

  function sailorSrc(index) {
    return sailors[Math.abs(index) % sailors.length];
  }

  return { waterSrc, segmentSrc, sailorSrc, sailorCount: sailors.length };
})();
