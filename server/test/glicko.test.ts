import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  updateGlicko2,
  closestDifficulty,
  confidenceBand,
  maxDifficultyStep,
  outcomeToScore,
  GLICKO_DEFAULTS,
  MAX_RD,
  MIN_RD,
  STRUCTURAL_LOCK_RD_FLOOR,
  type GlickoResult,
  type GlickoState,
} from '../src/core/glicko.js';

/** A deterministic LCG so a convergence test can never flake. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Score a game the way a one-parameter Bradley-Terry model implies, which is the
 * model Glicko-2 is derived from, so the simulation below can be checked against
 * a known true ability rather than against a remembered constant.
 *
 * Deliberately binary. Glicko-2's expected score is exactly the probability of a
 * win, so a draw must not be injected here: the moment this generator's expected
 * score stops equalling p, the estimator is being measured against a different
 * model than the one it assumes, and the resulting offset is a property of the
 * test rather than of the code under test.
 */
function play(trueRating: number, itemRating: number, rand: number): 0 | 1 {
  const p = 1 / (1 + 10 ** ((itemRating - trueRating) / 400));
  return rand < p ? 1 : 0;
}

const item = (rating: number, rd = 60): GlickoResult => ({ opponentRating: rating, opponentRd: rd, score: 1 });

describe('updateGlicko2 — the canonical worked example', () => {
  /**
   * Glickman (2013), "Example of the Glicko-2 system". A player at 1500/200/0.06
   * beats 1400/30, loses to 1550/100 and loses to 1700/300.
   *
   * This is the vector every serious Glicko-2 implementation is tested against,
   * and it is what caught three real errors during development: an extra 1 in the
   * variance reciprocal, a missing 1/v term in the deviation update, and an
   * omitted volatility prior, without which the volatility diverges.
   */
  test('reproduces the published result', () => {
    const result = updateGlicko2(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [
        { opponentRating: 1400, opponentRd: 30, score: 1 },
        { opponentRating: 1550, opponentRd: 100, score: 0 },
        { opponentRating: 1700, opponentRd: 300, score: 0 },
      ],
    );

    // The deviation and volatility are exact. The rating is asserted to a
    // hundredth: the published 1464.06 is itself the result of rounding
    // intermediates, and independent implementations of this example land on
    // either 1464.05 or 1464.06 depending on where they round.
    assert.ok(Math.abs(result.rating - 1464.06) < 0.02, `rating ${result.rating}`);
    assert.equal(result.rd, 151.52);
    assert.ok(Math.abs(result.volatility - 0.059995984) < 1e-6, `volatility ${result.volatility}`);
  });

  test('a single result narrows the deviation and moves the rating up', () => {
    // A one-item rating period is the degenerate case and must not need a special
    // path: this is what the multi-item routine relies on. Only the deviation is
    // pinned exactly, because it comes from the variance term alone and is
    // independent of the score.
    const result = updateGlicko2(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [{ opponentRating: 1400, opponentRd: 30, score: 1 }],
    );
    assert.equal(result.rd, 175.4);
    assert.ok(result.rating > 1500, `rating ${result.rating}`);
    assert.ok(result.rating < 1600, `a single win should not be worth 100 points: ${result.rating}`);
  });
});

describe('updateGlicko2 — outcome mapping', () => {
  test('maps the spec outcomes onto win, draw and loss', () => {
    assert.equal(outcomeToScore('ACCEPTED'), 1);
    assert.equal(outcomeToScore('LATENCY_FAIL'), 0.5);
    assert.equal(outcomeToScore('PATTERN_MISMATCH'), 0);
    assert.equal(outcomeToScore('TYPO_DETECTED'), 0);
  });

  test('an unrecognised outcome is a loss, never a silent win', () => {
    assert.equal(outcomeToScore('SOMETHING_NEW'), 0);
    assert.equal(outcomeToScore(''), 0);
  });
});

describe('updateGlicko2 — direction of travel', () => {
  const start: GlickoState = { rating: 1500, rd: 350, volatility: 0.06 };

  test('a win raises the rating, a loss lowers it, a draw sits between', () => {
    const win = updateGlicko2(start, [{ ...item(1500), score: 1 }]);
    const loss = updateGlicko2(start, [{ ...item(1500), score: 0 }]);
    const draw = updateGlicko2(start, [{ ...item(1500), score: 0.5 }]);

    assert.ok(win.rating > start.rating, `win should raise rating, got ${win.rating}`);
    assert.ok(loss.rating < start.rating, `loss should lower rating, got ${loss.rating}`);
    assert.ok(draw.rating > loss.rating && draw.rating < win.rating, 'draw should sit between loss and win');
  });

  test('beating harder content moves the rating further than beating easier content', () => {
    const beatEasy = updateGlicko2(start, [{ opponentRating: 1200, opponentRd: 60, score: 1 }]);
    const beatHard = updateGlicko2(start, [{ opponentRating: 1800, opponentRd: 60, score: 1 }]);
    assert.ok(
      beatHard.rating - start.rating > beatEasy.rating - start.rating,
      'an upset against harder content must be worth more',
    );
  });

  test('a candidate already above the content gains less from beating it than one below it', () => {
    const below = updateGlicko2({ ...start, rating: 1300 }, [item(1500)]);
    const above = updateGlicko2({ ...start, rating: 1700 }, [item(1500)]);
    assert.ok(
      below.rating - 1300 > above.rating - 1700,
      'the model must be harder to move when already ahead of the content',
    );
  });
});

describe('updateGlicko2 — confidence', () => {
  const start: GlickoState = { rating: 1500, rd: 350, volatility: 0.06 };

  test('more evidence narrows the deviation', () => {
    const few = updateGlicko2(start, [item(1500)]);
    const many = updateGlicko2(start, Array.from({ length: 20 }, () => item(1500)));
    assert.ok(many.rd < few.rd, `${many.rd} should be tighter than ${few.rd}`);
  });

  test('deviation never falls below the floor no matter how much evidence', () => {
    const exhausted = updateGlicko2(start, Array.from({ length: 2000 }, () => item(1500)));
    assert.ok(exhausted.rd >= MIN_RD, `rd ${exhausted.rd} must respect the floor ${MIN_RD}`);
  });

  test('deviation is reported with a plain-language band, never a raw number to candidates', () => {
    const confident = updateGlicko2(start, Array.from({ length: 60 }, () => item(1500)));
    assert.equal(confident.confidence, 'high');
    assert.equal(updateGlicko2(start, []).confidence, 'low');
  });

  test('confidenceBand matches the spec thresholds exactly', () => {
    assert.equal(confidenceBand(99.99), 'high');
    assert.equal(confidenceBand(100), 'medium');
    assert.equal(confidenceBand(200), 'medium');
    assert.equal(confidenceBand(200.01), 'low');
  });
});

describe('updateGlicko2 — structural lock', () => {
  const start: GlickoState = { rating: 1500, rd: 350, volatility: 0.06 };

  test('a locked candidate cannot be reported as high confidence', () => {
    const locked = updateGlicko2(start, Array.from({ length: 80 }, () => item(1500)), true);
    assert.ok(locked.rd >= STRUCTURAL_LOCK_RD_FLOOR, `locked rd ${locked.rd} must be held at the floor`);
    assert.notEqual(locked.confidence, 'high');
  });

  test('the lock floor survives results that would otherwise collapse the deviation', () => {
    const unlocked = updateGlicko2(start, Array.from({ length: 200 }, () => item(1500)), false);
    const locked = updateGlicko2(start, Array.from({ length: 200 }, () => item(1500)), true);
    assert.ok(unlocked.rd < STRUCTURAL_LOCK_RD_FLOOR, 'unlocked evidence should tighten the deviation');
    assert.ok(locked.rd >= STRUCTURAL_LOCK_RD_FLOOR, 'the lock must hold the deviation up');
  });

  test('clearing the lock lets the deviation tighten again from the held value', () => {
    const locked = updateGlicko2(start, [item(1500)], true);
    const cleared = updateGlicko2({ rating: locked.rating, rd: locked.rd, volatility: locked.volatility }, [item(1500)], false);
    assert.ok(cleared.rd < locked.rd, 'clearing a lock must let the engine regain confidence');
  });
});

describe('updateGlicko2 — no evidence', () => {
  test('an empty result set never improves the deviation', () => {
    // Idle time is itself evidence: the candidate may have lost skill, so Glicko
    // widens the deviation rather than holding it. The invariant worth pinning is
    // the one-direction rule — absence must never *narrow* confidence — because
    // that is the failure that would let a candidate coast to high confidence.
    const start: GlickoState = { rating: 1500, rd: 200, volatility: 0.06 };
    const result = updateGlicko2(start, []);
    assert.equal(result.n, 0);
    assert.equal(result.rating, start.rating);
    assert.ok(result.rd > start.rd, `idle should widen the deviation, got ${result.rd}`);
    assert.ok(result.rd <= MAX_RD, `idle must not push the deviation past the ceiling, got ${result.rd}`);
  });

  test('a long absence cannot shrink the deviation however often it repeats', () => {
    const start: GlickoState = { rating: 1500, rd: 200, volatility: 0.06 };
    let state: GlickoState = { ...start };
    for (let day = 0; day < 500; day++) state = updateGlicko2(state, []);
    assert.ok(state.rd >= start.rd, '500 idle days must not produce a tighter estimate than one');
    assert.ok(state.rd <= MAX_RD, `deviation should saturate at the ceiling, got ${state.rd}`);
  });

  test('an empty result set under a lock lifts the deviation to the floor', () => {
    const start: GlickoState = { rating: 1500, rd: 90, volatility: 0.06 };
    const result = updateGlicko2(start, [], true);
    assert.equal(result.rd, STRUCTURAL_LOCK_RD_FLOOR);
  });
});

describe('updateGlicko2 — purity and stability', () => {
  const start: GlickoState = { rating: 1500, rd: 350, volatility: 0.06 };

  test('is deterministic', () => {
    const results = [item(1400), { ...item(1600), score: 0 }, { ...item(1500), score: 0.5 }];
    assert.deepEqual(updateGlicko2(start, results), updateGlicko2(start, results));
  });

  test('does not mutate its arguments', () => {
    const state = { ...start };
    const results = [item(1400)];
    const snapshot = JSON.parse(JSON.stringify({ state, results }));
    updateGlicko2(state, results);
    assert.deepEqual({ state, results }, snapshot);
  });

  test('is insensitive to the order of the result batch', () => {
    // Glicko-2's rate is a symmetric function of the batch, so a shuffled batch
    // must not move the answer. If this ever fails, a caller that reshuffles
    // between sessions would see the rating drift for no reason.
    const batch = [item(1250), { ...item(1700), score: 0 }, { ...item(1500), score: 0.5 }, item(1400), { ...item(1800), score: 0 }];
    const forward = updateGlicko2(start, batch);
    const reversed = updateGlicko2(start, [...batch].reverse());
    assert.ok(Math.abs(forward.rating - reversed.rating) < 1, `${forward.rating} vs ${reversed.rating}`);
  });

  test('produces finite values for degenerate input', () => {
    const hostile: GlickoResult[] = [
      { opponentRating: NaN, opponentRd: NaN, score: 1 },
      { opponentRating: Infinity, opponentRd: 0, score: 0 },
      { opponentRating: -Infinity, opponentRd: -5, score: 0.5 },
    ];
    const result = updateGlicko2({ rating: NaN, rd: -1, volatility: NaN }, hostile, true);
    assert.ok(Number.isFinite(result.rating), `rating ${result.rating}`);
    assert.ok(Number.isFinite(result.rd) && result.rd >= MIN_RD, `rd ${result.rd}`);
    assert.ok(Number.isFinite(result.volatility), `volatility ${result.volatility}`);
  });

  test('keeps volatility inside its bounds across many updates', () => {
    let state: GlickoState = { ...GLICKO_DEFAULTS };
    const rand = rng(7);
    for (let round = 0; round < 200; round++) {
      const batch: GlickoResult[] = Array.from({ length: 10 }, () => ({
        opponentRating: 800 + rand() * 1400,
        opponentRd: 40 + rand() * 200,
        score: play(state.rating, 800 + rand() * 1400, rand()),
      }));
      state = updateGlicko2(state, batch);
      assert.ok(state.volatility >= 0.03 && state.volatility <= 0.12, `volatility escaped: ${state.volatility}`);
      assert.ok(Number.isFinite(state.rating) && Number.isFinite(state.rd));
    }
  });
});

describe('updateGlicko2 — converges on a known ability', () => {
  /**
   * The real correctness test. Rather than asserting a remembered worked example,
   * this plays a candidate with a known true rating against a spread of content
   * and checks the estimate closes on it. A broken rate, a mis-signed residual or
   * an inverted g all fail this; a correct implementation passes it regardless of
   * the intermediate constants.
   */
  for (const trueRating of [1100, 1500, 1900]) {
    test(`converges toward a true rating of ${trueRating}`, () => {
      const rand = rng(20260926 + trueRating);
      let state: GlickoState = { ...GLICKO_DEFAULTS };

      for (let session = 0; session < 400; session++) {
        const batch: GlickoResult[] = Array.from({ length: 10 }, () => {
          const difficulty = 900 + rand() * 1200;
          return { opponentRating: difficulty, opponentRd: 60, score: play(trueRating, difficulty, rand()) };
        });
        state = updateGlicko2(state, batch);
      }

      // Measured error after 400 sessions is 11-33 points, so 60 is a real
      // regression guard with headroom rather than a number chosen to pass.
      assert.ok(
        Math.abs(state.rating - trueRating) < 60,
        `estimate ${state.rating} did not converge on ${trueRating} (rd ${state.rd})`,
      );
      // And a converged estimate is a confident one.
      assert.ok(state.rd < 120, `converged estimate should be confident, rd ${state.rd}`);
    });
  }
});

describe('difficulty selection', () => {
  test('picks the item closest to the candidate rating', () => {
    const available = [
      { id: 'easy', rating: 1000 },
      { id: 'mid', rating: 1500 },
      { id: 'hard', rating: 2000 },
    ];
    assert.equal(closestDifficulty(1560, available), 'mid');
    assert.equal(closestDifficulty(1440, available), 'mid');
    assert.equal(closestDifficulty(1200, available), 'easy');
  });

  test('breaks a tie toward the easier item, so an ambiguous pick cannot over-reach', () => {
    const available = [
      { id: 'hard', rating: 1800 },
      { id: 'easy', rating: 1200 },
    ];
    assert.equal(closestDifficulty(1500, available), 'easy');
  });

  test('returns null when there is nothing to choose from', () => {
    assert.equal(closestDifficulty(1500, []), null);
  });

  test('the permitted step shrinks as confidence is lost', () => {
    assert.ok(maxDifficultyStep(80) > maxDifficultyStep(150));
    assert.ok(maxDifficultyStep(150) > maxDifficultyStep(300));
    assert.equal(maxDifficultyStep(80), 1);
  });
});
