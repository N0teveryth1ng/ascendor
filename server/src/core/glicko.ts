/**
 * Section 15.2 — Glicko-2 rating system, per module.
 *
 * Replaces the fixed per-module multipliers (0.93 / 1.0 / 1.08) that Section 2.2
 * applied over a rolling window. Those multipliers were a step function: they
 * ignored how far the candidate was from the content's difficulty, so a
 * candidate far below a band was nudged up exactly as hard as one sitting on
 * it, and one lucky session moved the needle as much as a week of work.
 *
 * Glicko-2 carries three quantities per candidate per module:
 *   rating     R      — the estimate of ability on that module
 *   deviation  RD     — confidence in that estimate; falls with evidence, and is
 *                        floored by structural uncertainty
 *   volatility sigma  — how much the estimate is expected to drift
 *
 * Everything runs on the natural (Glicko) scale internally and converts at the
 * boundary, so intermediates stay dimensionless and the only points in the public
 * types are the rating and deviation going in and out. The engine is pure — no
 * I/O, no clock, no module state — so the same inputs always give the same
 * outputs, which is what makes it testable.
 *
 * Two additions this spec requires on top of the standard algorithm:
 *   1. A Structural Lock floors the resulting deviation, so a locked candidate
 *      is never reported as high confidence.
 *   2. Section 15.2 maps attempt outcomes onto Glicko scores, and the candidate's
 *      RD selects how far difficulty may move.
 *
 * Validated against Glickman (2013) "Example of the Glicko-2 system":
 * a player at 1500/200/0.06 who beats 1400/30 and loses to 1550/100 and
 * 1700/300 finishes at 1464.06 with RD 151.52 and volatility 0.059996.
 *
 * References:
 *   Glickman, "Example of the Glicko-2 system" (2013)
 *   Glickman, "Glicko-2 Explained" (2014)
 */

/** A single graded result against one rated item. */
export interface GlickoResult {
  /** The item's difficulty, on the same scale as the candidate rating. */
  opponentRating: number;
  /** The item's rating deviation, i.e. how settled its difficulty is. */
  opponentRd: number;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: 0 | 0.5 | 1;
}

export interface GlickoState {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GlickoUpdate extends GlickoState {
  /** The rating held before this batch, for before/after display. */
  priorRating: number;
  /** Number of results folded in. */
  n: number;
  /** The confidence the RD implies, as a plain-language band. */
  confidence: 'high' | 'medium' | 'low';
}

/** Section 15.2 — the initial conditions for an unrated candidate. */
export const GLICKO_DEFAULTS: GlickoState = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
};

/** Points per natural unit. */
const SCALE = 173.7178;

/**
 * The volatility constant tau, the prior penalty on drifting away from the
 * current volatility. Glickman calls 0.3 to 1.2 reasonable; 0.5 is his default.
 * It is what stops the volatility from chasing every noisy session.
 */
const TAU = 0.5;

/** Glickman's stated convergence tolerance for the volatility search. */
const CONVERGENCE_TOLERANCE = 0.000001;

/** The largest RD the engine will report; a candidate never becomes *less* known. */
export const MAX_RD = 350;

/** The smallest RD the engine will report; below this it is not a real estimate. */
export const MIN_RD = 30;

/**
 * Section 15.2 — the structural-uncertainty floor.
 *
 * A candidate under a Structural Lock is not merely under-tested: there is
 * affirmative evidence that their ability on that module is suppressed or
 * unstable. That is a different kind of uncertainty from "not enough results
 * yet", and ordinary convergence would let a burst of results shrink RD to its
 * floor and declare high confidence anyway. This floor holds the deviation up
 * until the lock is cleared, which keeps difficulty selection conservative and
 * stops the engine from rating its way out of a structural problem it has not
 * solved.
 */
export const STRUCTURAL_LOCK_RD_FLOOR = 120;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Section 15.2 — the expected-score attenuation g(phi).
 *
 * Content whose own difficulty is well settled (a small RD) is trusted fully;
 * content the engine is still unsure about is discounted toward an even match,
 * because a result against it is less informative about the candidate.
 */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/**
 * The expected score against one opponent, excluding the g factor. The actual
 * score probability is g(phi_j) * E_j; the variance sum applies g separately.
 */
function e(mu: number, muOpponent: number, gValue: number): number {
  return 1 / (1 + Math.exp(-gValue * (mu - muOpponent)));
}

/**
 * Section 15.2 — one rating update.
 *
 * @param current  the candidate's present state, in points
 * @param results  graded outcomes against rated items; may be empty
 * @param locked   whether a Structural Lock is active on this module
 */
export function updateGlicko2(
  current: GlickoState,
  results: GlickoResult[],
  locked = false,
): GlickoUpdate {
  const priorRating = current.rating;
  const rating = Number.isFinite(current.rating) ? current.rating : GLICKO_DEFAULTS.rating;
  const sigma = Number.isFinite(current.volatility) ? current.volatility : GLICKO_DEFAULTS.volatility;
  const rd = Number.isFinite(current.rd) ? current.rd : GLICKO_DEFAULTS.rd;

  const finish = (newRating: number, naturalDeviation: number, newSigma: number, n: number): GlickoUpdate => {
    let finalRd = naturalDeviation * SCALE;
    if (locked) finalRd = Math.max(finalRd, STRUCTURAL_LOCK_RD_FLOOR);
    finalRd = clamp(finalRd, MIN_RD, MAX_RD);
    return {
      rating: round2(newRating),
      rd: round2(finalRd),
      volatility: round6(newSigma),
      priorRating: round2(priorRating),
      n,
      confidence: confidenceBand(finalRd),
    };
  };

  if (results.length === 0) {
    // No results. Glicko's own treatment widens the deviation to account for the
    // skill the candidate may have lost while idle. Crucially it never
    // *narrows* it, so an absent candidate can never look more confident.
    const phi = Math.max(rd, MIN_RD) / SCALE;
    const decayed = Math.hypot(phi, sigma);
    return finish(rating, decayed, sigma, 0);
  }

  const mu = (rating - GLICKO_DEFAULTS.rating) / SCALE;
  const phi = Math.max(rd, MIN_RD) / SCALE;

  const opponents = results.map((r) => {
    const opponentPhi = clamp(Number.isFinite(r.opponentRd) ? r.opponentRd : 150, 30, MAX_RD) / SCALE;
    const opponentMu = (Number.isFinite(r.opponentRating) ? r.opponentRating : GLICKO_DEFAULTS.rating) - GLICKO_DEFAULTS.rating;
    return { phi: opponentPhi, mu: opponentMu / SCALE, g: g(opponentPhi), score: r.score };
  });

  // v: the variance the batch contributes. This is 1/sum(...), not 1/(1+sum(...)).
  const varianceSum = opponents.reduce((acc, o) => {
    const expected = e(mu, o.mu, o.g);
    return acc + o.g * o.g * expected * (1 - expected);
  }, 0);
  const v = varianceSum > 0 ? 1 / varianceSum : 1;

  // The batch residual, and the observed rating change it implies.
  const residual = opponents.reduce((acc, o) => acc + o.g * (o.score - e(mu, o.mu, o.g)), 0);
  const delta = v * residual;

  const sigmaPrime = solveVolatility(sigma, delta * delta, phi, v);

  // The new deviation: the period's drift and the batch variance combine.
  const phiPrime = 1 / Math.sqrt(1 / (phi * phi + sigmaPrime * sigmaPrime) + 1 / v);

  // The new rating, weighted by the updated deviation.
  const muPrime = mu + phiPrime * phiPrime * residual;

  return finish(muPrime * SCALE + GLICKO_DEFAULTS.rating, phiPrime, sigmaPrime, results.length);
}

/**
 * Section 15.2, step 8 — the new volatility, as the root of
 *
 *   f(x) = e^x (delta^2 - phi^2 - v - e^x) / (2 (phi^2 + v + e^x)^2)
 *          - (x - ln(sigma^2)) / tau^2
 *
 * The second term is the prior that pulls the volatility back toward its current
 * value. It is not optional: without it the equation has no stable root near the
 * prior and the volatility runs away, which in turn inflates the deviation and
 * throws the rating around for reasons that have nothing to do with the
 * candidate's work.
 *
 * Solved by Glickman's bracketing plus regula-falsi iteration, which cannot
 * diverge the way a bare Newton step does when f is nearly flat.
 */
function solveVolatility(sigma: number, deltaSquared: number, phi: number, v: number): number {
  const sigmaSq = Math.max(sigma * sigma, 1e-12);
  const logSigmaSq = Math.log(sigmaSq);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
    const data = (ex * (deltaSquared - phi * phi - v - ex)) / denom;
    const prior = (x - logSigmaSq) / (TAU * TAU);
    const value = data - prior;
    return Number.isFinite(value) ? value : Number.MAX_VALUE;
  };

  let a = logSigmaSq;
  let fa = f(a);

  let b: number;
  if (deltaSquared > phi * phi + v) {
    // The results explain more than the prior, so the root is above the prior.
    b = Math.log(deltaSquared - phi * phi - v);
  } else {
    // Walk down until the sign flips. Each step is one tau, so this terminates
    // in a handful of iterations for any realistic delta.
    let k = 1;
    b = a - k * TAU;
    while (f(b) < 0 && k < 64) {
      k += 1;
      b = a - k * TAU;
    }
  }
  let fb = f(b);

  // Regula falsi with a bisection safeguard, exactly as Glickman specifies.
  let guard = 0;
  while (Math.abs(b - a) > CONVERGENCE_TOLERANCE && guard < 200) {
    guard += 1;
    if (fb === fa) break;
    const c = a + ((a - b) * fa) / (fb - fa);
    const fc = f(c);
    if (fc * fb <= 0) {
      a = b;
      fa = fb;
    } else {
      fa /= 2;
    }
    b = c;
    fb = fc;
  }

  const solved = Math.exp(a / 2);
  return Number.isFinite(solved) && solved > 0 ? solved : sigma;
}

/**
 * Section 15.5 — RD to the plain-language confidence the admin sees.
 *
 * Candidates never see a number or a band; this exists for the teacher view and
 * for choosing how aggressively difficulty may move.
 */
export function confidenceBand(rd: number): 'high' | 'medium' | 'low' {
  if (rd < 100) return 'high';
  if (rd <= 200) return 'medium';
  return 'low';
}

/**
 * Section 15.4 — pick the item difficulty closest to the candidate's rating.
 *
 * Ties break toward the easier item: an over-ambiguous item produces a loss the
 * engine cannot distinguish from a genuine ability gap, whereas an easy item
 * only risks under-informing.
 */
export function closestDifficulty(
  rating: number,
  available: { rating: number; id: string }[],
): string | null {
  if (available.length === 0) return null;
  let best = available[0]!;
  for (const option of available) {
    const distance = Math.abs(option.rating - rating);
    const bestDistance = Math.abs(best.rating - rating);
    if (distance < bestDistance || (distance === bestDistance && option.rating < best.rating)) {
      best = option;
    }
  }
  return best.id;
}

/**
 * Section 15.4 — the largest fraction of a difficulty step the RD permits.
 *
 * A wide deviation means the estimate is unsettled, so the engine must not move
 * the candidate far on the strength of one session. Difficulty is chosen by
 * proximity to rating, so this is the brake that stops a burst of results from
 * skipping content the candidate has never been shown.
 */
export function maxDifficultyStep(rd: number): number {
  if (rd < 100) return 1.0;
  if (rd <= 200) return 0.6;
  return 0.3;
}

/**
 * Section 15.2 — map a graded attempt outcome onto a Glicko score.
 *
 * The spec's mapping: a target met inside the threshold is a win; correct but
 * late is a draw, because the content was understood and only the speed failed;
 * anything else is a loss.
 */
export function outcomeToScore(
  outcome: 'ACCEPTED' | 'LATENCY_FAIL' | 'PATTERN_MISMATCH' | 'TYPO_DETECTED' | string,
): 0 | 0.5 | 1 {
  if (outcome === 'ACCEPTED') return 1;
  if (outcome === 'LATENCY_FAIL') return 0.5;
  return 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Volatility lives near 0.06, so it is rounded to six places rather than four.
 * Four places would round the canonical 0.059996 straight back to 0.06 and make
 * a moved volatility indistinguishable from an unmoved one.
 */
function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}
