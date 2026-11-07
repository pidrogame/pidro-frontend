import { describe, expect, it } from 'bun:test';
import { avatarParts } from '../../src/features/avatar';
import {
  AVATAR_SIZE,
  bidWindowTop,
  cardSize,
  computeLayout,
  handLeft,
  handLift,
  handPointsSize,
  handScale,
  handStep,
  LANDSCAPE_SOUTH_LEFT,
  landscapeNameReach,
  landscapeNorthLeft,
  landscapeNorthShift,
  MENU_SLOT,
  NORTH_NAME_MIN,
  compactNorth,
  northBackWidth,
  northFanTop,
  northFanWidth,
  northSeatBottom,
  packLayers,
  PACK_STEP,
  packSpot,
  pileCardW,
  pileSpacing,
  pileSpot,
  PILE_TRAIL_SCALE,
  playedCardTarget,
  trailSpot,
  trickOnCross,
  TRAIL_SCALE,
  landscapeSideSeatTop,
  SIDE_SEAT_WIDTH,
  sideSeatTop,
  sideStackInner,
  SIDE_SEAT_GAP,
  seatNameGap,
  sideStacks,
  sideStackStep,
  showsTicker,
  TIGHT_AVATAR,
  TIGHT_SOUTH_GAP,
  tickerPlacement,
  TRICK_GAP,
  TRUMP_BUTTON,
  TRUMP_MARK,
  trumpPicker,
} from '../../src/game/canvas/layout.ts';

describe('played-card piles', () => {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1180, 820],
  ]) {
    it(`exposes the rank edge at every seat on ${width}×${height}`, () => {
      const layout = computeLayout(width, height, { top: 0, bottom: 0, left: 0, right: 0 });
      for (const count of [2, 4, 6]) {
        for (const seat of ['north', 'east', 'south', 'west']) {
          for (let i = 1; i < count; i++) {
            const older = playedCardTarget(layout, seat, i - 1, count);
            const newer = playedCardTarget(layout, seat, i, count);
            // Newer cards are on top: the older card's top-left rank/suit
            // index stays outside the newer card, and the two still overlap.
            const [w, h] = [layout.cardW * older.scale, layout.cardH * older.scale];
            const toScreen = (card, x, y) => ({
              x: card.x + x * Math.cos(card.rot) - y * Math.sin(card.rot),
              y: card.y + x * Math.sin(card.rot) + y * Math.cos(card.rot),
            });
            const toLocal = (card, p) => ({
              x: (p.x - card.x) * Math.cos(card.rot) + (p.y - card.y) * Math.sin(card.rot),
              y: -(p.x - card.x) * Math.sin(card.rot) + (p.y - card.y) * Math.cos(card.rot),
            });
            const index = toLocal(newer, toScreen(older, -w / 2 + 6, -h / 2 + 12));
            expect(Math.abs(index.x) < w / 2 && Math.abs(index.y) < h / 2).toBe(false);
            expect(Math.hypot(newer.x - older.x, newer.y - older.y)).toBeLessThan(w);
          }
        }
      }
      // On landscape phones East's card lands in its front row (PID-305);
      // elsewhere on the circle, upright phones out past it (PID-333).
      const east = playedCardTarget(layout, 'east', 0, 1);
      expect(east).toMatchObject({ y: layout.front?.east.y ?? layout.trick.cy, rot: -Math.PI / 2 });
      // West's top points at the middle too, as its player lays it (PID-388).
      expect(playedCardTarget(layout, 'west', 0, 1).rot).toBe(Math.PI / 2);
      if (layout.front) expect(east.x).toBe(layout.front.east.x);
      else if (layout.profile === 'phone-portrait')
        expect(east.x).toBeGreaterThanOrEqual(layout.trick.cx + layout.trick.r);
      else expect(east.x).toBe(layout.trick.cx + layout.trick.r);
    });
  }
});

// PID-381: a seat's earlier cards each show their rank and suit; a long pile
// closes on its oldest first, never below 0.16 of a card, its newest two kept.
describe('pileSpacing', () => {
  const w = 60;
  const near = (steps, want) => {
    expect(steps.length).toBe(want.length);
    steps.forEach((step, i) => expect(step).toBeCloseTo(want[i]));
  };
  it('a one-card pile has nothing behind it', () => {
    expect(pileSpacing(1, 100, w)).toEqual([]);
    expect(pileSpacing(0, 100, w)).toEqual([]);
  });
  it('keeps the full step where the room allows', () => {
    near(pileSpacing(5, 200, w), [15.6, 15.6, 15.6, 15.6]);
  });
  it('closes the oldest first, then the next', () => {
    // 6 cards: 5 steps of 15.6 = 78 wanted. 74 room: only the oldest gives.
    near(pileSpacing(6, 74, w), [11.6, 15.6, 15.6, 15.6, 15.6]);
    // 64 room: 14 over. The oldest and the next close to the floor, the third gives 2.
    near(pileSpacing(6, 64, w), [9.6, 9.6, 13.6, 15.6, 15.6]);
  });
  it('never closes below the floor, nor the newest two', () => {
    near(pileSpacing(7, 0, w), [9.6, 9.6, 9.6, 9.6, 15.6, 15.6]);
    near(pileSpacing(3, 0, w), [15.6, 15.6]);
  });
});

describe('upright piles: the newest in front, the earlier ones behind (PID-381)', () => {
  for (const [width, height, insets] of [
    [390, 844, { top: 0, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 0, bottom: 0, left: 0, right: 0 }],
    [360, 780, { top: 24, bottom: 48, left: 0, right: 0 }],
  ]) {
    it(`on ${width}×${height}`, () => {
      const L = computeLayout(width, height, insets, 60);
      for (const rel of ['north', 'east', 'south', 'west'])
        for (const count of [1, 3, 5, 6]) {
          const cards = Array.from({ length: count }, (_, i) =>
            playedCardTarget(L, rel, i, count, 1)
          );
          expect(cards.at(-1).scale).toBe(L.trick.pileScale);
          for (const c of cards.slice(0, -1))
            expect(c.scale).toBeCloseTo(L.trick.pileScale * PILE_TRAIL_SCALE);
          // The newest stays on its point of the circle.
          const point = { north: [0, -L.trick.r], south: [0, L.trick.r] }[rel];
          if (point) expect(cards.at(-1).y).toBe(L.trick.cy + point[1]);
          else expect(Math.abs(cards.at(-1).x - L.trick.cx)).toBeCloseTo(L.trick.across);
          // Every earlier card shows at least 0.16 of a card, at its index:
          // East's foot, West's top (PID-388); side cards all turn one way.
          for (let i = 0; i + 1 < count; i++) {
            const [a, b] = [cards[i], cards[i + 1]];
            const half = (c) => (L.cardW * c.scale) / 2;
            const shown =
              rel === 'east'
                ? a.y + half(a) - (b.y + half(b))
                : rel === 'west'
                  ? b.y - half(b) - (a.y - half(a))
                  : b.x - half(b) - (a.x - half(a));
            expect(shown).toBeGreaterThanOrEqual(L.cardW * 0.16 - 1e-9);
            expect(a.rot).toBe(b.rot);
          }
        }
      // West's newest lies at the foot of its column, beside your pile's
      // earlier cards, and never on them (PID-388).
      for (const count of [5, 6]) {
        const west = playedCardTarget(L, 'west', count - 1, count, 1);
        const westRight = west.x + (L.cardW * west.scale * (110 / 78)) / 2;
        for (let i = 0; i < count; i++) {
          const south = playedCardTarget(L, 'south', i, count, 1);
          expect(south.x - (L.cardW * south.scale) / 2).toBeGreaterThanOrEqual(westRight - 1e-9);
        }
      }
    });
  }
});

describe('side stacks and the hand', () => {
  const none = { top: 0, bottom: 0, left: 0, right: 0 };

  it('drops landscape tablet side stacks below the trick line, and their cards leave from there', () => {
    const landscape = computeLayout(1180, 820, { top: 0, bottom: 21, left: 0, right: 0 });
    expect(landscape.sides.cy).toBeGreaterThan(landscape.trick.cy);
    expect(landscape.seats.east.y).toBe(landscape.sides.cy);
    expect(landscape.seats.west.y).toBe(landscape.sides.cy);
    // Landscape phones hang them centred down their edge, level with the
    // trick, as Classic does (PID-308).
    const phone = computeLayout(844, 390, { top: 0, bottom: 0, left: 0, right: 0 });
    expect(phone.sidesUnder).toBe(true);
    // A TCL 5053Y: 780×360 with its nav bar's 50pt on the right still seats them so.
    const tcl = computeLayout(780, 360, { top: 0, bottom: 0, left: 0, right: 50 });
    expect(tcl.sidesUnder).toBe(true);
    expect(tcl.sideSeatWidth).toBeGreaterThanOrEqual(76);
    // Turned the other way, its nav bar on the left, it seats them the same.
    const turned = computeLayout(780, 360, { top: 27, bottom: 0, left: 48, right: 0 });
    expect(turned.sidesUnder).toBe(true);
    expect(turned.sideSeatWidth).toBeGreaterThanOrEqual(76);
    expect(phone.sides.cy).toBe(phone.trick.cy);
    expect(phone.seats.west.y).toBe(phone.trick.cy);

    const portrait = computeLayout(402, 874, { top: 62, bottom: 34, left: 0, right: 0 }, 60, 72);
    expect(portrait.sides.cy).toBeGreaterThan(portrait.trick.cy);
    expect(portrait.sides.cy - portrait.trick.cy).toBeLessThanOrEqual(portrait.cardH * 0.45 + 0.01);
  });

  it('lowers portrait side stacks only as far as a full stack still clears your hand', () => {
    for (const [width, height, insets] of [
      [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
      [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
      [430, 932, { top: 59, bottom: 34, left: 0, right: 0 }],
      [834, 1194, { top: 24, bottom: 20, left: 0, right: 0 }],
    ]) {
      const L = computeLayout(width, height, insets, 60);
      const stacks = sideStacks(L);
      expect(stacks.top).toBeGreaterThanOrEqual(L.trick.cy - stacks.maxHeight / 2);
      expect(stacks.top + stacks.maxHeight).toBeLessThanOrEqual(
        L.hand.cy - L.cardH / 2 - 12 + 0.01
      );
    }
  });

  it('keeps the second-deal pack off your hand where the table has room below it', () => {
    const L = computeLayout(430, 932, { top: 59, bottom: 34, left: 0, right: 0 }, 60, 72);
    const pack = packSpot(L, 'south');
    const packH = (Math.min(Math.max(L.cardW * 0.8, 36), 68) * 110) / 78;
    const handBottom = L.hand.cy + (L.cardH * handScale(L.profile)) / 2;
    expect(pack.y - packH / 2).toBeGreaterThanOrEqual(handBottom);
    expect(pack.y + packH / 2).toBeLessThanOrEqual(L.bottom);
  });

  // PID-394: North deals from beside its fan, a full hand's, its top back
  // level with the fan; a full pack of 52 still under the header row and on
  // screen. Landscape phones seat North right of the fan: the pack lies left
  // of it, above North's front row.
  for (const [width, height, insets] of [
    [360, 780, { top: 24, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [768, 1024, { top: 24, bottom: 20, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 59 }],
  ]) {
    it(`lays North's pack beside its fan on ${width}×${height}`, () => {
      const L = computeLayout(width, height, insets, height > width ? 60 : 0, 0);
      const compact = compactNorth(L);
      const w = northBackWidth(L.cardW, compact);
      const h = w * (110 / 78);
      const rise = (count) => (packLayers(count) - 1) * w * PACK_STEP;
      const pack = packSpot(L, 'north');
      const fan = northFanWidth(L.cardW, 9, compact);
      const fanTop = northFanTop(L, insets.top + (height > width ? 60 : 0));
      const shift = L.front ? landscapeNorthShift(L, insets, 9) : 0;
      expect(pack.y - h / 2 - rise(16)).toBeCloseTo(fanTop);
      expect(pack.y - h / 2 - rise(52)).toBeGreaterThanOrEqual(L.top);
      if (L.front) {
        expect(pack.x + w / 2 + rise(52) * 0.55).toBeLessThanOrEqual(
          width / 2 - shift - fan / 2 - 12 + 0.01
        );
        expect(pack.y + h / 2).toBeLessThanOrEqual(L.front.north.y - L.cardH / 2 - 12);
      } else {
        expect(pack.x - w / 2).toBeGreaterThanOrEqual(width / 2 + fan / 2 + 12 - 0.01);
        expect(pack.x + w / 2 + rise(52) * 0.55).toBeLessThanOrEqual(width - insets.right - 4);
      }
    });
  }

  // East and West deal from a pack lying sideways at the screen's edge,
  // above their seat upright, its bid badge included; landscape keeps it
  // under the seat and its backs.
  for (const [width, height, insets] of [
    [360, 780, { top: 24, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [768, 1024, { top: 24, bottom: 20, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
    [1024, 768, { top: 24, bottom: 20, left: 0, right: 0 }],
  ]) {
    it(`lays East's and West's packs sideways by their seats on ${width}×${height}`, () => {
      const upright = height > width;
      const L = computeLayout(width, height, insets, upright ? 60 : 0, 0);
      const w = northBackWidth(L.cardW, compactNorth(L));
      const h = w * (110 / 78);
      const rise = (packLayers(52) - 1) * w * PACK_STEP;
      const stacks = sideStacks(L);
      for (const rel of ['east', 'west']) {
        const pack = packSpot(L, rel);
        expect(pack.sideways).toBe(true);
        const left = pack.x - h / 2;
        const right = pack.x + h / 2 + rise * 0.55;
        expect(left).toBeGreaterThanOrEqual(insets.left);
        expect(right).toBeLessThanOrEqual(width - insets.right);
        expect(pack.y - w / 2 - rise).toBeGreaterThanOrEqual(L.top);
        expect(pack.y + w / 2).toBeLessThanOrEqual(height - insets.bottom);
        if (upright) {
          const seatTop = sideSeatTop(L, {
            tableTop: L.top,
            seatHeight: L.tight ? TIGHT_AVATAR : L.profile.startsWith('tablet') ? 115 : 98,
            headerBottom: 0,
          });
          expect(pack.y + w / 2).toBeLessThanOrEqual(seatTop - 3 - 12 + 0.01);
        } else {
          // Under the stack's top, on the free side of the seat, never over the backs.
          expect(pack.y - w / 2 - rise).toBeGreaterThan(stacks.top);
          const inner = rel === 'west' ? stacks.backW * (110 / 78) : width - stacks.backW * (110 / 78);
          if (L.front) expect(rel === 'west' ? left > inner : right < inner).toBe(true);
          else expect(pack.y - w / 2 - rise).toBeGreaterThan(stacks.top + stacks.maxHeight);
        }
      }
    });
  }

  it('puts the left edge of a fuller hand further left', () => {
    const layout = computeLayout(844, 390, none);
    expect(handLeft(layout, 9)).toBeLessThan(handLeft(layout, 6));
    expect(handLeft(layout, 1)).toBeCloseTo(
      layout.hand.cx - (layout.cardW * handScale(layout.profile) * 1.03) / 2
    );
  });
});

describe('portrait trick fits between North and your hand', () => {
  for (const [width, height, insets] of [
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
    [360, 640, { top: 24, bottom: 48, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [402, 874, { top: 62, bottom: 34, left: 0, right: 0 }],
    [440, 956, { top: 62, bottom: 34, left: 0, right: 0 }],
    [375, 667, { top: 0, bottom: 0, left: 0, right: 0 }],
    [360, 780, { top: 24, bottom: 48, left: 0, right: 0 }],
  ]) {
    it(`clears North's seat and the hand on ${width}×${height}`, () => {
      const L = computeLayout(width, height, insets, 60);
      const half = (L.cardH * L.trick.pileScale) / 2;
      const northCardTop = L.trick.cy - L.trick.r - half;
      const southCardBottom = L.trick.cy + L.trick.r + half;
      // North's fan and seat, as SeatLayer stacks them under the header.
      const northSeatBottom =
        insets.top +
        60 +
        8 +
        Math.min(58, Math.max(31, L.cardW * 0.66)) * (110 / 78) +
        12 +
        (L.tight ? TIGHT_AVATAR : 98);
      expect(northCardTop).toBeGreaterThanOrEqual(northSeatBottom);
      // Clear of a lifted card too (PID-393: 375×667 is no longer tight).
      expect(southCardBottom).toBeLessThanOrEqual(L.hand.cy - L.cardH / 2 - handLift(L) + 0.01);
    });
  }
});

describe('upright phones draw cards as big as Classic’s (PID-333)', () => {
  const sizes = (width, height, insets) => {
    const L = computeLayout(width, height, insets, 61);
    return { L, hand: L.cardH * handScale(L.profile), played: L.cardH * L.trick.pileScale };
  };
  // Before PID-333 every upright phone drew a 54pt-wide card.
  const before = 54 * (110 / 78);

  it('a played card about 78pt and your hand about 88pt on 390×844', () => {
    const { hand, played } = sizes(390, 844, { top: 0, bottom: 0, left: 0, right: 0 });
    expect(Math.abs(hand - 88)).toBeLessThanOrEqual(1);
    expect(Math.abs(played - 78)).toBeLessThanOrEqual(1);
  });

  it('a 375×667 phone a little smaller, and bigger than before', () => {
    const { hand } = sizes(375, 667, { top: 20, bottom: 0, left: 0, right: 0 });
    expect(hand).toBeLessThan(88);
    expect(hand).toBeGreaterThan(before + 5);
  });

  // The circle closes in first; the played cards shrink only to keep
  // TRICK_GAP from the trump mark, never below their size before.
  for (const [width, height, insets] of [
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [393, 852, { top: 59, bottom: 34, left: 0, right: 0 }],
    [402, 874, { top: 62, bottom: 34, left: 0, right: 0 }],
    [375, 812, { top: 50, bottom: 34, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [360, 800, { top: 24, bottom: 48, left: 0, right: 0 }],
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
  ]) {
    it(`keeps the trump mark clear on ${width}×${height}`, () => {
      const { L, hand, played } = sizes(width, height, insets);
      expect(hand).toBeGreaterThanOrEqual(before);
      expect(played).toBeGreaterThan(before * 0.72);
      expect(L.trick.r - played / 2 - (L.cardW * TRUMP_MARK) / 2).toBeGreaterThanOrEqual(
        TRICK_GAP - 0.01
      );
    });
  }

  // The hand's points (PID-332) sit between East's and West's cards: the
  // widest, "−14 | 14", is about 3.5 figures.
  for (const [width, height, insets] of [
    [390, 844, { top: 0, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [402, 874, { top: 62, bottom: 34, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
  ]) {
    it(`leaves the hand's points room on ${width}×${height} ${insets.top}pt`, () => {
      const { L, played } = sizes(width, height, insets);
      const east = playedCardTarget(L, 'east', 0, 1);
      const west = playedCardTarget(L, 'west', 0, 1);
      // On 360pt-wide phones whose played cards keep their full size (PID-393
      // gave 360×640 the room) the stacks' edge leaves the points just that.
      const half = handPointsSize(L) * 1.75 - 0.05;
      expect(east.x - played / 2 - L.trick.cx).toBeGreaterThan(half);
      expect(L.trick.cx - (west.x + played / 2)).toBeGreaterThan(half);
      // A four-card pile at North or yours stays clear of them too.
      const south = [0, 1, 2, 3].map((i) => playedCardTarget(L, 'south', i, 4).x);
      const southHalf = (Math.max(...south) - Math.min(...south) + L.cardW * L.trick.pileScale) / 2;
      expect(east.x - played / 2 - L.trick.cx).toBeGreaterThan(southHalf);
      // And of their stacks along the edges, a folded hand beside them included.
      const stack = sideStackInner(L.cardW, 0) + TRICK_GAP;
      expect(west.x - played / 2).toBeGreaterThan(stack);
      expect(east.x + played / 2).toBeLessThan(width - stack);
    });
  }

  // The second deal's throws grew with the cards; a big one closes up.
  for (const [width, height, insets] of [
    [390, 844, { top: 0, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
  ]) {
    it(`keeps nine-card throws apart on ${width}×${height} ${insets.top}pt`, () => {
      const { L } = sizes(width, height, insets);
      const w = pileCardW(L);
      const h = w * (110 / 78);
      const pile = (rel) => {
        const side = rel === 'east' || rel === 'west';
        const spots = Array.from({ length: 9 }, (_, i) => pileSpot(L, rel, i, 9));
        const [hw, hh] = side ? [h / 2, w / 2] : [w / 2, h / 2];
        return {
          left: Math.min(...spots.map((s) => s.x)) - hw,
          right: Math.max(...spots.map((s) => s.x)) + hw,
          top: Math.min(...spots.map((s) => s.y)) - hh,
          bottom: Math.max(...spots.map((s) => s.y)) + hh,
        };
      };
      const apart = (a, b) =>
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      for (const [a, b] of [
        ['north', 'east'],
        ['east', 'south'],
        ['south', 'west'],
        ['west', 'north'],
      ])
        expect(apart(pile(a), pile(b)), `${a} and ${b}`).toBe(true);
    });
  }

  it('the shortest phones keep the cards they had', () => {
    for (const [width, height] of [
      [320, 568],
      [360, 592],
    ]) {
      expect(sizes(width, height, { top: 24, bottom: 0, left: 0, right: 0 }).L.cardW).toBe(54);
    }
  });
});

describe('tight phones', () => {
  for (const [width, height, insets, tight] of [
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }, true],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }, true],
    // Marcel's TCL 5053Y went tight when its cards grew (PID-333), and out of
    // it again when the dock under the hand went (PID-393).
    [360, 780, { top: 24, bottom: 48, left: 0, right: 0 }, false],
    [360, 700, { top: 24, bottom: 48, left: 0, right: 0 }, true],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }, false],
    [402, 874, { top: 62, bottom: 34, left: 0, right: 0 }, false],
  ]) {
    it(`${tight ? 'go' : 'stay out of'} tight on ${width}×${height}`, () => {
      expect(computeLayout(width, height, insets, 60).tight).toBe(tight);
    });
  }

  // PID-304: the hand on the table's axis, your avatar and its short line
  // under it, above the home indicator, and the trick still clear of the hand.
  for (const [width, height, insets] of [
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [360, 700, { top: 24, bottom: 48, left: 0, right: 0 }],
  ]) {
    it(`put your avatar under a centred hand on ${width}×${height}`, () => {
      const L = computeLayout(width, height, insets, 60);
      expect(L.tight).toBe(true);
      expect(L.hand.cx).toBe(width / 2);
      expect(L.hand.maxWidth).toBe(width - 32);
      const avatarTop = L.hand.cy + L.cardH / 2 + TIGHT_SOUTH_GAP;
      // The avatar, a 4pt gap, one 14pt status line and 8pt of air above the
      // home indicator, the table's bottom edge (PID-393).
      expect(L.bottom).toBe(height - insets.bottom);
      expect(avatarTop + TIGHT_AVATAR + 4 + 14 + 8).toBeCloseTo(L.bottom);
      const south = playedCardTarget(L, 'south', 0, 1);
      expect(south.y + (L.cardH * south.scale) / 2).toBeLessThanOrEqual(
        L.hand.cy - L.cardH / 2 - handLift(L)
      );
    });
  }
});

// PID-393: with nothing docked under the hand, East and West come down from
// beside North toward the trick's line, as far as their seat stays TRICK_GAP
// above their played cards; their six backs hang below, clear of a lifted
// card of yours, closing up before the seat would rise.
describe('upright phones seat East and West low beside the trick', () => {
  for (const [width, height, insets] of [
    [390, 844, { top: 0, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [360, 780, { top: 24, bottom: 48, left: 0, right: 0 }],
    [402, 874, { top: 62, bottom: 34, left: 0, right: 0 }],
    [440, 956, { top: 62, bottom: 34, left: 0, right: 0 }],
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
  ]) {
    it(`on ${width}×${height}`, () => {
      const tableTop = insets.top + 60;
      const L = computeLayout(width, height, insets, 60);
      expect(L.bottom).toBe(height - insets.bottom);
      const size = L.tight ? TIGHT_AVATAR : AVATAR_SIZE[L.profile];
      // A tight seat is its avatar, its name beside it; else avatar, chip, name and line.
      const seatTop = L.sides.seat - size / 2;
      const seatBottom = seatTop + (L.tight ? TIGHT_AVATAR : 98);
      expect(sideSeatTop(L, { tableTop, seatHeight: 0, headerBottom: 0 })).toBeCloseTo(seatTop);
      // Their avatars below North's seat: North alone at the top.
      expect(L.sides.seat).toBeGreaterThan(northSeatBottom(L, tableTop));
      // As low as the side piles allow: TRICK_GAP above their top edge.
      for (const rel of ['east', 'west']) {
        const card = playedCardTarget(L, rel, 0, 1);
        expect(card.y - (L.cardW * card.scale) / 2 - seatBottom).toBeCloseTo(TRICK_GAP);
        // A throw or a laid hand fanned there stays under the seat too.
        for (let n = 2; n <= 9; n++) {
          const high = Math.min(...Array.from({ length: n }, (_, i) => pileSpot(L, rel, i, n).y));
          expect(high - pileCardW(L) / 2 - seatBottom).toBeGreaterThanOrEqual(TRICK_GAP / 2 - 0.01);
        }
      }
      const { top, maxHeight, backW } = sideStacks(L);
      expect(top).toBeCloseTo(seatBottom + TRICK_GAP);
      const lifted = L.hand.cy - L.cardH / 2 - handLift(L) - (L.cardH * 0.015 + 2.5);
      expect(top + maxHeight).toBeLessThanOrEqual(lifted - TRICK_GAP + 0.01);
      // Six backs still count.
      expect(sideStackStep(L.cardW, 6, maxHeight)).toBeGreaterThanOrEqual(backW * 0.3 - 0.01);
    });
  }

  it('leaves the iPad upright as it was', () => {
    const L = computeLayout(834, 1194, { top: 24, bottom: 20, left: 0, right: 0 }, 60);
    expect(L.sides.seat).toBeUndefined();
    expect(L.bottom).toBe(1194 - 20);
  });
});

describe('the plaque ticker keeps off North’s fan', () => {
  const noInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  const plaque = { plaqueLeft: 12, plaqueTop: 8 };

  for (const [width, height] of [
    [390, 844],
    [430, 932],
  ]) {
    it(`ends its lines within half a back of the fan on ${width}×${height}`, () => {
      const L = computeLayout(width, height, noInsets, 64, 0);
      const { lineMaxWidth, drop } = tickerPlacement(L, { tableTop: 64, ...plaque });
      const fanLeft = L.seats.north.x - northFanWidth(L.cardW, 9) / 2;
      // The line, then the chevron and its gap.
      expect(plaque.plaqueLeft + lineMaxWidth + 16).toBeLessThanOrEqual(
        fanLeft + northBackWidth(L.cardW) / 2 + 0.5
      );
      expect(drop).toBe(0);
    });
  }

  it('drops below the fan beside the plaque on landscape tablets', () => {
    const L = computeLayout(1180, 820, noInsets, 64, 0);
    const { lineMaxWidth, drop } = tickerPlacement(L, { tableTop: 64, ...plaque });
    const fanBottom = northFanTop(L, 64) + (northBackWidth(L.cardW, compactNorth(L)) * 110) / 78;
    expect(plaque.plaqueTop + drop).toBeGreaterThanOrEqual(fanBottom);
    expect(lineMaxWidth).toBe(168);
  });
});

describe('small and landscape phones leave the ticker out', () => {
  for (const [width, height, insets, shown] of [
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }, false],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }, false],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 0 }, false],
    [667, 375, { top: 0, bottom: 0, left: 0, right: 0 }, false],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }, true],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }, false],
    [1180, 820, { top: 0, bottom: 20, left: 0, right: 0 }, true],
  ]) {
    it(`${shown ? 'shows' : 'hides'} it on ${width}×${height}`, () => {
      const portrait = height > width;
      const L = computeLayout(
        width,
        height,
        insets,
        portrait ? 60 : 0,
        portrait ? 0 : 0
      );
      expect(showsTicker(L)).toBe(shown);
      expect(tickerPlacement(L, { tableTop: 60, plaqueLeft: 12, plaqueTop: 8 }) !== null).toBe(
        shown
      );
    });
  }
});

describe('tight phones leave the bid line out, count help or not (PID-304)', () => {
  it('on 360×640', () => {
    const L = computeLayout(360, 640, { top: 24, bottom: 0, left: 0, right: 0 }, 60, 0);
    expect(tickerPlacement(L, { tableTop: 84, plaqueLeft: 12, plaqueTop: 32 }, true)).toBe(null);
  });
});

describe('count help shows the bidder’s whole name on phones (PID-220)', () => {
  // The bid line's pill: 8pt either side of the text and a 1pt border; a row
  // is 16pt. A name with no room beside the bid takes a row of its own, so a
  // whole line is two rows, inside the ticker's 44pt touch target.
  const PILL = 2 * 8 + 2;
  const LINE_HEIGHT = 44;
  // Nunito 800 at 12pt runs under 7pt a letter ("Margaretha" is 68pt).
  const nameWidth = (name) => name.length * 7.5;
  const overlap = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  for (const [width, height, insets] of [
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [360, 800, { top: 24, bottom: 48, left: 0, right: 0 }],
  ]) {
    it(`on ${width}×${height}, ${insets.top}pt top inset`, () => {
      const HEADER = 61;
      const tableTop = insets.top + HEADER;
      const L = computeLayout(width, height, insets, HEADER);
      const plaqueTop = insets.top > 0 ? insets.top : 8;
      const plaqueBottom = plaqueTop + 53 + 4;
      const placed = tickerPlacement(L, { tableTop, plaqueLeft: 12, plaqueTop }, true);
      for (const name of ['Jocke', 'Margaretha']) {
        expect(nameWidth(name)).toBeLessThanOrEqual(placed.lineMaxWidth - PILL);
      }

      // The line and its chevron, against North's fan (up to the half back the
      // ticker may reach over, above) and every seat beside it.
      const top = plaqueBottom + placed.drop;
      const line = {
        left: 12,
        right: 12 + placed.lineMaxWidth + 16,
        top,
        bottom: top + LINE_HEIGHT,
      };
      const backW = northBackWidth(L.cardW);
      const fanTop = northFanTop(L, tableTop);
      const parts = avatarParts(AVATAR_SIZE[L.profile]);
      const seatHeight = L.tight
        ? TIGHT_AVATAR
        : AVATAR_SIZE[L.profile] +
          parts.level.height +
          parts.level.bottom +
          3 +
          parts.name.lineHeight +
          parts.status.lineHeight;
      const northBottom = northSeatBottom(L, tableTop);
      const sideTop = sideSeatTop(L, {
        tableTop,
        seatHeight,
        headerBottom: insets.top + HEADER + 8,
      });
      const center = L.tight ? TIGHT_AVATAR / 2 : 78;
      const others = {
        north: {
          left: width / 2 - center,
          right: width / 2 + center,
          top: northBottom - seatHeight,
          bottom: northBottom,
        },
        west: { left: 0, right: width / 2, top: sideTop, bottom: sideTop + seatHeight },
        east: { left: width / 2, right: width, top: sideTop, bottom: sideTop + seatHeight },
      };
      for (const n of [1, 4, 6]) {
        const fanLeft = L.seats.north.x - northFanWidth(L.cardW, n) / 2;
        others[`${n} backs`] = {
          left: fanLeft + backW / 2,
          right: fanLeft + northFanWidth(L.cardW, n),
          top: fanTop,
          bottom: fanTop + (backW * 110) / 78,
        };
      }
      for (const [other, box] of Object.entries(others)) {
        expect(overlap(line, box), `the bid line and ${other}`).toBe(false);
      }
    });
  }
});

describe('landscape: your played card lands above your hand', () => {
  for (const [width, height, side, bottom] of [
    [640, 360, 0, 0],
    [667, 375, 0, 0],
    [844, 390, 47, 21],
    [874, 402, 62, 21],
    [932, 430, 59, 21],
    [956, 440, 62, 21],
  ]) {
    it(`on ${width}×${height}`, () => {
      const L = computeLayout(width, height, { top: 0, bottom, left: side, right: side });
      const south = playedCardTarget(L, 'south', 0, 1);
      const pileBottom = south.y + (L.cardH * south.scale) / 2;
      const handTop = L.hand.cy - (L.cardH * handScale(L.profile)) / 2;
      expect(pileBottom).toBeLessThanOrEqual(handTop - 8 + 0.5);
    });
  }
});

describe('landscape phones draw your hand the size of the table’s cards, beside your seat', () => {
  // Android (0, or a 48pt button bar on either side) and iPhones with the
  // Dynamic Island on either side.
  for (const [width, height, insets] of [
    [640, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 48, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 48 }],
    [667, 375, { top: 0, bottom: 0, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 0 }],
    [932, 430, { top: 0, bottom: 21, left: 59, right: 59 }],
    [932, 430, { top: 0, bottom: 21, left: 0, right: 59 }],
  ]) {
    it(`on ${width}×${height} ${JSON.stringify(insets)}`, () => {
      const L = computeLayout(width, height, insets);
      const handW = L.cardW * handScale(L.profile);
      expect(handW).toBeCloseTo(cardSize(width, height));
      expect(handW).toBeGreaterThanOrEqual(54);

      // Your seat: 70pt in, a 52pt avatar, a 10pt gap and at least 56pt of name.
      const seatRight = insets.left + 70 + 52 + 10 + 56;
      for (const n of [1, 6, 9]) {
        const left = handLeft(L, n);
        const right = left + (n - 1) * handStep(L, n) + handW * 1.03;
        expect(left).toBeGreaterThanOrEqual(seatRight + 6);
        expect(right).toBeLessThanOrEqual(width - insets.right - 8);
      }
      // A full hand fits at its usual overlap: every rank in reach of a thumb.
      expect(handStep(L, 9)).toBeCloseTo(L.cardW * 0.72);
      // Pushed down to the bottom edge (PID-307), past it where the table is
      // short, always showing the cards' rank and suit (the top 58%) and a
      // 44pt tap target, TRICK_GAP clear of your played card.
      const shown = height - (L.hand.cy - L.cardH / 2);
      expect(shown).toBeGreaterThanOrEqual(Math.max(44, L.cardH * 0.58));
      expect(L.hand.cy + L.cardH / 2).toBeGreaterThanOrEqual(height - insets.bottom - 4 - 0.01);
      expect(L.hand.cy - L.cardH / 2).toBeGreaterThanOrEqual(
        L.front.south.y + L.cardH / 2 + TRICK_GAP
      );
    });
  }

  it('keeps a hand that fits on the table’s axis', () => {
    const L = computeLayout(932, 430, { top: 0, bottom: 21, left: 59, right: 59 });
    expect(L.hand.cx).toBe(466);
  });

  it('squeezes the hand before it reaches your seat on a narrow window', () => {
    const L = computeLayout(560, 340, { top: 0, bottom: 0, left: 48, right: 48 });
    expect(handStep(L, 9)).toBeLessThan(L.cardW * 0.72);
    expect(handLeft(L, 9)).toBeGreaterThanOrEqual(48 + 188 + 6);
  });
});

describe('the trump picker sits in the felt, clear of everything (PID-209)', () => {
  // The header row: an 8pt inset and the 53pt score plaque (TABLE_HEADER).
  const HEADER = 61;
  for (const [width, height, insets] of [
    [360, 640, { top: 0, bottom: 0, left: 0, right: 0 }],
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
    [1024, 1366, { top: 24, bottom: 20, left: 0, right: 0 }],
  ]) {
    it(`on ${width}×${height}`, () => {
      const portrait = height > width;
      const tableTop = insets.top + (portrait ? HEADER : 0);
      const headerBottom = insets.top + HEADER + 8;
      const L = computeLayout(
        width,
        height,
        insets,
        portrait ? HEADER : 0,
        portrait ? 0 : 0
      );
      const P = trumpPicker(L, tableTop, headerBottom);
      const bottom = P.top + P.height;

      // A 2×2 grid in portrait, one row in landscape, of buttons 64pt or more.
      expect(P.columns).toBe(portrait ? 2 : 4);
      expect(Math.min(TRUMP_BUTTON.width, P.buttonHeight)).toBeGreaterThanOrEqual(64);
      if (!L.tight) expect(P.caption && P.buttonHeight === TRUMP_BUTTON.height).toBe(true);
      expect(P.width).toBe(P.columns * TRUMP_BUTTON.width + (P.columns - 1) * P.gap);

      // In the trick circle.
      expect(P.left + P.width / 2).toBeCloseTo(L.trick.cx);
      expect(Math.abs(P.top + P.height / 2 - L.trick.cy)).toBeLessThanOrEqual(L.trick.r);

      // The header, North and your hand stay clear.
      expect(P.top).toBeGreaterThanOrEqual(portrait ? tableTop : headerBottom);
      if (portrait) expect(P.top).toBeGreaterThanOrEqual(northSeatBottom(L, tableTop));
      // Your hand, its previewed trumps lifted, keeps a gap; on tight phones,
      // under your seat's new room, a wider one (PID-304), "Pick trump" yielding.
      const handTop = L.hand.cy - (L.cardH * handScale(L.profile)) / 2;
      expect(bottom).toBeLessThanOrEqual(handTop - handLift(L) - 8);
      if (L.tight) expect(bottom).toBeLessThanOrEqual(handTop - 28);

      // East and West: their stacks along the edges, their seats above them.
      // Roomy portraits give the seats a column beside the picker; small
      // phones and landscape bring them in, so the picker sits below them.
      const stackReach = (sideStacks(L).backW * 110) / 78;
      expect(P.left).toBeGreaterThanOrEqual(insets.left + stackReach);
      expect(P.left + P.width).toBeLessThanOrEqual(width - insets.right - stackReach);
      if (portrait && !L.tight) {
        const tablet = L.profile.startsWith('tablet');
        const column = Math.min(tablet ? 150 : 112, (width - (tablet ? 200 : 156)) / 2 - 8);
        expect(P.left).toBeGreaterThanOrEqual(insets.left + column);
      } else {
        const seat = L.tight ? TIGHT_AVATAR : portrait ? 56 : 52;
        expect(P.top).toBeGreaterThanOrEqual(
          sideSeatTop(L, { tableTop, seatHeight: seat, headerBottom }) + seat
        );
      }
    });
  }
});

describe('the shortest phones lift the trump picker clear of your hand (PID-304)', () => {
  // 360×616: a 16:9 Android phone under a 24pt status bar and a solid nav bar.
  for (const height of [592, 616]) {
    it(`on 360×${height}`, () => {
      const L = computeLayout(360, height, { top: 24, bottom: 0, left: 0, right: 0 }, 61, 52);
      const P = trumpPicker(L, 85, 93);
      expect(P.top).toBeGreaterThanOrEqual(northSeatBottom(L, 85));
      expect(P.top + P.height).toBeLessThanOrEqual(L.hand.cy - L.cardH / 2 - 28);
    });
  }
});

// PID-307: Classic's cross. Every played card, two from a seat that kept
// seven trumps included, keeps TRICK_GAP from the trump mark, the other
// seats' cards, North's backs and your hand, a lifted card included.
describe('landscape phones lay the trick out as Classic’s cross', () => {
  const box = (x, y, w, h) => ({
    left: x - w / 2,
    right: x + w / 2,
    top: y - h / 2,
    bottom: y + h / 2,
  });
  const gap = (a, b) =>
    Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
  for (const [width, height, insets] of [
    [780, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 0, left: 0, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
    // Marcel's TCL as it runs: the nav bar beside the window, the status bar over it.
    [732, 360, { top: 28, bottom: 0, left: 0, right: 0 }],
  ]) {
    for (const count of [1, 2]) {
      it(`on ${width}×${height} ${JSON.stringify(insets)}, ${count} card(s) a seat`, () => {
        const L = computeLayout(width, height, insets);
        const mark = L.cardW * TRUMP_MARK;
        const things = [['the trump mark', box(L.trick.cx, L.trick.cy, mark, mark)]];
        for (const rel of ['north', 'east', 'south', 'west']) {
          const cards = Array.from({ length: count }, (_, i) => {
            const c = playedCardTarget(L, rel, i, count);
            const side = rel === 'east' || rel === 'west';
            return box(c.x, c.y, side ? L.cardH : L.cardW, side ? L.cardW : L.cardH);
          });
          things.push([
            `${rel}'s cards`,
            {
              left: Math.min(...cards.map((c) => c.left)),
              right: Math.max(...cards.map((c) => c.right)),
              top: Math.min(...cards.map((c) => c.top)),
              bottom: Math.max(...cards.map((c) => c.bottom)),
            },
          ]);
        }
        const fanTop = northFanTop(L, insets.top);
        const fanW = northFanWidth(L.cardW, 9, compactNorth(L));
        const backH = (northBackWidth(L.cardW, compactNorth(L)) * 110) / 78;
        things.push([
          "North's backs",
          {
            left: L.trick.cx - fanW / 2,
            right: L.trick.cx + fanW / 2,
            top: fanTop,
            bottom: fanTop + backH,
          },
        ]);
        const hand = {
          left: handLeft(L, 9),
          right: handLeft(L, 9) + 8 * handStep(L, 9) + L.cardW * 1.03,
        };
        // At rest: a card of yours lifts only into your empty spot.
        things.push(['your hand', { ...hand, top: L.hand.cy - L.cardH / 2, bottom: height }]);
        for (const [i, [a, ab]] of things.entries())
          for (const [b, bb] of things.slice(i + 1))
            expect(gap(ab, bb), `${a} and ${b}`).toBeGreaterThanOrEqual(TRICK_GAP - 0.01);
        // Side cards keep to their column, between their seat and yours.
        for (const rel of ['east', 'west'])
          for (let i = 0; i < count; i++) {
            const { y } = playedCardTarget(L, rel, i, count);
            expect(y - L.cardW / 2).toBeGreaterThanOrEqual(L.band.top - 0.01);
            expect(y + L.cardW / 2).toBeLessThanOrEqual(L.band.bottom + 0.01);
          }
      });
    }
  }
});

describe('a played card waits on the cross for its seat’s next card (PID-308)', () => {
  it('stays through the next trick until that seat plays', () => {
    expect(trickOnCross([0, 1], 2, false, false)).toBe(1);
    expect(trickOnCross([0, 1, 2], 2, false, false)).toBe(2);
  });

  it('your card waits too, and clears when you can play', () => {
    expect(trickOnCross([0, 1], 2, true, false)).toBe(1);
    expect(trickOnCross([0, 1], 2, true, true)).toBe(2);
  });

  it('a seat that is out keeps its last card until the next trick starts', () => {
    expect(trickOnCross([0, 1], 1, false, false, true)).toBe(1);
    expect(trickOnCross([0, 1], 2, false, false, true)).toBe(2);
  });

  it('on a TCL either way round West’s card lies toward the table, its trail stepping up', () => {
    for (const insets of [
      { top: 27, bottom: 0, left: 48, right: 0 },
      { top: 24, bottom: 0, left: 0, right: 50 },
    ]) {
      const L = computeLayout(780, 360, insets);
      const card = playedCardTarget(L, 'west', 0, 1);
      expect(card.rot).toBe(Math.PI / 2);
      expect(trailSpot(L, 'west', 1).y).toBeLessThan(card.y);
    }
  });

  it('West’s card lies as its trail does: it never turns on the way', () => {
    for (const [width, height] of [
      [640, 360],
      [667, 375],
      [780, 360],
      [844, 390],
    ]) {
      const L = computeLayout(width, height, { top: 0, bottom: 0, left: 0, right: 0 });
      expect(trailSpot(L, 'west', 1).rot).toBe(playedCardTarget(L, 'west', 0, 1).rot);
      // Its top toward the middle on every phone, its trail up toward the index (PID-388).
      expect(playedCardTarget(L, 'west', 0, 1).rot).toBe(Math.PI / 2);
      expect(trailSpot(L, 'west', 1).y).toBeLessThan(playedCardTarget(L, 'west', 0, 1).y);
      // Five deep, each side's trail stays in its band, clear of its seat.
      for (const rel of ['west', 'east'])
        for (let back = 1; back <= 5; back++) {
          const card = trailSpot(L, rel, back, 5);
          const half = (L.cardW * card.scale) / 2;
          expect(card.y - half).toBeGreaterThanOrEqual(L.band.top - 1e-9);
          expect(card.y + half).toBeLessThanOrEqual(L.band.bottom + 1e-9);
        }
    }
  });
});

describe('the bid grid sits on the trick, 18pt clear of your hand', () => {
  // A 3×3 grid of 44pt buttons over Pass; `tall` adds a failed bid's message.
  const grid = 3 * 44 + 2 * 4;
  const window = (tall) => ({ center: 4 + grid / 2, height: grid + 68 + (tall ? 40 : 0) });
  const handTop = (L) => L.hand.cy - (L.cardH * handScale(L.profile)) / 2;

  it('centres it where the table has room (390×844)', () => {
    const L = computeLayout(390, 844, { top: 0, bottom: 0, left: 0, right: 0 }, 61, 52);
    const w = window(false);
    const top = bidWindowTop(L, { tableTop: 61, ...w });
    expect(top + w.center).toBe(L.trick.cy);
    expect(top + w.height).toBeLessThan(handTop(L) - 18);
  });

  // PID-304: tight phones lift the grid above the trick's centre, never below it.
  for (const [width, height, insets] of [
    [360, 640, { top: 24, bottom: 0, left: 0, right: 0 }],
    [375, 667, { top: 20, bottom: 0, left: 0, right: 0 }],
    [360, 616, { top: 24, bottom: 0, left: 0, right: 0 }],
  ]) {
    for (const tall of [false, true]) {
      it(`lifts it on tight ${width}×${height}${tall ? ' with a failed bid' : ''}`, () => {
        const L = computeLayout(width, height, insets, 61, 52);
        expect(L.tight).toBe(true);
        const w = window(tall);
        const top = bidWindowTop(L, { tableTop: insets.top + 61, ...w });
        expect(top + w.center).toBeLessThanOrEqual(L.trick.cy);
        expect(top + w.height).toBeLessThanOrEqual(handTop(L) - 18);
      });
    }
  }
});

describe('a 32-character name in every seat stays in its own place (PID-232)', () => {
  // The header row (TABLE_HEADER) and the gap SeatLayer leaves under it.
  const HEADER = 61;
  const overlap = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const handBox = (L, n) => {
    const left = handLeft(L, n);
    const cardW = L.cardW * handScale(L.profile);
    const cardH = L.cardH * handScale(L.profile);
    return {
      left,
      right: left + (n - 1) * handStep(L, n) + cardW * 1.03,
      top: L.hand.cy - cardH / 2 - handLift(L),
      bottom: L.hand.cy + cardH / 2,
    };
  };
  // Every pile, up to three cards each, as played around the trick circle.
  const playedCards = (L) =>
    ['north', 'east', 'south', 'west'].flatMap((rel) =>
      [0, 1, 2].map((i) => {
        const card = playedCardTarget(L, rel, i, 3);
        const [w, h] = [L.cardW * card.scale, L.cardH * card.scale];
        const [x, y] = rel === 'east' || rel === 'west' ? [h / 2, w / 2] : [w / 2, h / 2];
        return { left: card.x - x, right: card.x + x, top: card.y - y, bottom: card.y + y };
      })
    );
  // Landscape phones: every seat's five earlier cards trailing its own (PID-308).
  const trailCards = (L) =>
    L.front
      ? ['north', 'east', 'south', 'west'].flatMap((rel) =>
          [1, 2, 3, 4, 5].map((back) => {
            const card = trailSpot(L, rel, back);
            const [w, h] = [L.cardW * card.scale, L.cardH * card.scale];
            const [x, y] = rel === 'east' || rel === 'west' ? [h / 2, w / 2] : [w / 2, h / 2];
            return { left: card.x - x, right: card.x + x, top: card.y - y, bottom: card.y + y };
          })
        )
      : [];
  // Every seat's pile of `n` thrown cards in its front row (PID-305).
  const frontPiles = (L, n) =>
    ['north', 'east', 'south', 'west'].flatMap((rel) =>
      Array.from({ length: n }, (_, i) => {
        const card = pileSpot(L, rel, i, n);
        const [w, h] = [pileCardW(L), (pileCardW(L) * 110) / 78];
        const [x, y] = rel === 'east' || rel === 'west' ? [h / 2, w / 2] : [w / 2, h / 2];
        return { left: card.x - x, right: card.x + x, top: card.y - y, bottom: card.y + y };
      })
    );
  // East's and West's full stacks along the edges.
  const sideStackBoxes = (L, insets) => {
    const { top, maxHeight } = sideStacks(L);
    const rows = { top, bottom: top + maxHeight };
    return [
      { ...rows, left: -Infinity, right: sideStackInner(L.cardW, insets.left) },
      { ...rows, left: L.width - sideStackInner(L.cardW, insets.right), right: Infinity },
    ];
  };
  const expectApart = (seats, others, label) => {
    const names = Object.keys(seats);
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        expect(overlap(seats[a], seats[b]), `${label}: ${a} and ${b}`).toBe(false);
      }
      for (const [other, box] of others) {
        expect(overlap(seats[a], box), `${label}: ${a} and ${other}`).toBe(false);
      }
    }
  };

  // A name that long fills its whole reach: each seat is drawn at its widest.
  // The dealer chip sits on the avatar's corner (PID-304), never after a name.
  for (const [width, height, insets] of [
    [640, 360, { top: 0, bottom: 0, left: 0, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 48, right: 0 }],
    [640, 360, { top: 0, bottom: 0, left: 0, right: 48 }],
    [640, 360, { top: 0, bottom: 21, left: 0, right: 59 }],
    [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }],
    [844, 390, { top: 0, bottom: 0, left: 0, right: 0 }],
    [932, 430, { top: 0, bottom: 21, left: 59, right: 59 }],
  ]) {
    it(`landscape ${width}×${height} ${JSON.stringify(insets)}`, () => {
      const L = computeLayout(width, height, insets);
      const size = AVATAR_SIZE[L.profile];
      const gap = seatNameGap(L.profile);
      const headerBottom = insets.top + HEADER + 8;
      const sideTop = sideSeatTop(L, { tableTop: insets.top, seatHeight: size, headerBottom });
      const menu = {
        left: width - insets.right - MENU_SLOT,
        right: width - insets.right - 12,
        top: 8,
        bottom: 8 + 44,
      };
      for (const n of [1, 6, 9]) {
        const seatW = (rel) =>
          size + gap + landscapeNameReach(L, rel, { insets, southCards: n, northBacks: n });
        const southLeft = insets.left + LANDSCAPE_SOUTH_LEFT;
        const northLeft = landscapeNorthLeft(L, insets, n);
        // At the inner top corner of their stacks (PID-305).
        const westLeft = sideStackInner(L.cardW, insets.left) + SIDE_SEAT_GAP;
        const eastRight = width - sideStackInner(L.cardW, insets.right) - SIDE_SEAT_GAP;
        const seats = {
          south: {
            left: southLeft,
            right: southLeft + seatW('south'),
            top: L.hand.cy - size / 2,
            bottom: L.hand.cy + size / 2,
          },
          north: {
            left: northLeft,
            right: northLeft + seatW('north'),
            top: insets.top + 8,
            bottom: insets.top + 8 + size,
          },
          east: { left: eastRight - seatW('east'), right: eastRight, top: sideTop },
          west: { left: westLeft, right: westLeft + seatW('west'), top: sideTop },
        };
        seats.east.bottom = seats.west.bottom = sideTop + size;
        // Landscape phones: name and line under the avatar, West's seat at
        // the top of its backs and East's at their foot (PID-308).
        if (L.sidesUnder) {
          const h = size + avatarParts(size).level.height + 2 * 18;
          const westTop = landscapeSideSeatTop(L, 'west', h);
          const eastTop = landscapeSideSeatTop(L, 'east', h);
          seats.west = {
            left: westLeft,
            right: westLeft + L.sideSeatWidth,
            top: westTop,
            bottom: westTop + h,
          };
          seats.east = {
            left: eastRight - L.sideSeatWidth,
            right: eastRight,
            top: eastTop,
            bottom: eastTop + h,
          };
        }
        for (const seat of Object.values(seats)) {
          expect(seat.left).toBeGreaterThanOrEqual(insets.left);
          expect(seat.right).toBeLessThanOrEqual(width - insets.right);
        }
        expect(seats.east.top).toBeGreaterThanOrEqual(headerBottom);
        expectApart(
          seats,
          [
            ['hand', handBox(L, n)],
            ['menu', menu],
            ...playedCards(L).map((card) => ['a played card', card]),
            ...frontPiles(L, n).map((card) => ['a thrown card', card]),
            ...trailCards(L).map((card) => ['an earlier card', card]),
            ...sideStackBoxes(L, insets).map((stack) => ['a side stack', stack]),
          ],
          `${n} cards`
        );
      }
    });
  }

  // A 640×360 Android phone with its nav bar on the right: North's fan moves
  // left, so a long name still shows its first several letters, and the
  // dealer chip on the avatar's corner keeps off the fan.
  for (const right of [48, 59]) {
    it(`landscape 640×360, ${right}pt right inset, North dealing`, () => {
      const insets = { top: 0, bottom: 0, left: 0, right };
      const L = computeLayout(640, 360, insets);
      const size = AVATAR_SIZE[L.profile];
      const dealer = avatarParts(size).dealer;
      for (const n of [1, 6, 9]) {
        const reach = landscapeNameReach(L, 'north', { insets, northBacks: n });
        expect(reach).toBeGreaterThanOrEqual(NORTH_NAME_MIN);
        const northLeft = landscapeNorthLeft(L, insets, n);
        const labelRight = northLeft + size + seatNameGap(L.profile) + reach;
        expect(labelRight).toBeLessThanOrEqual(640 - right - MENU_SLOT - 8);
        const chip = {
          left: northLeft + dealer.left,
          right: northLeft + dealer.left + dealer.size,
          top: 8 + size - dealer.bottom - dealer.size,
          bottom: 8 + size - dealer.bottom,
        };
        const fanW = northFanWidth(L.cardW, n, compactNorth(L));
        const fanLeft = 320 - landscapeNorthShift(L, insets, n) - fanW / 2;
        const fanTop = northFanTop(L, 0);
        const fan = {
          left: fanLeft,
          right: fanLeft + fanW,
          top: fanTop,
          bottom: fanTop + (northBackWidth(L.cardW, compactNorth(L)) * 110) / 78,
        };
        expect(overlap(chip, fan)).toBe(false);
      }
    });
  }

  it('portrait 390×844', () => {
    const [width, height, insets] = [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }];
    const tableTop = insets.top + HEADER;
    const L = computeLayout(width, height, insets, HEADER);
    // Avatar, level chip, name and status, as SeatLayer stacks them.
    const parts = avatarParts(AVATAR_SIZE[L.profile]);
    const stack =
      AVATAR_SIZE[L.profile] +
      parts.level.height +
      parts.level.bottom +
      3 +
      parts.name.lineHeight +
      parts.status.lineHeight;
    const center = { left: width / 2 - 78, right: width / 2 + 78 };
    const side = Math.min(112, (width - 156) / 2 - 8);
    const sideTop = sideSeatTop(L, {
      tableTop,
      seatHeight: stack,
      headerBottom: insets.top + HEADER + 8,
    });
    const northTop = northSeatBottom(L, tableTop) - stack;
    const southBottom = height - insets.bottom - 8;
    const seats = {
      north: { ...center, top: northTop, bottom: northTop + stack },
      south: { ...center, top: southBottom - stack, bottom: southBottom },
      east: { left: width - side, right: width, top: sideTop, bottom: sideTop + stack },
      west: { left: 0, right: side, top: sideTop, bottom: sideTop + stack },
    };
    expect(seats.north.top).toBeGreaterThanOrEqual(tableTop);
    for (const n of [1, 6, 9]) {
      expectApart(
        seats,
        [['hand', handBox(L, n)], ...playedCards(L).map((card) => ['a played card', card])],
        `${n} cards`
      );
    }
  });
});
