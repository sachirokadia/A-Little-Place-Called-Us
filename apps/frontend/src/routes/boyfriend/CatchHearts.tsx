import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getPreferences, type Me, type Space } from '../../lib/api.js';
import { Card, ErrorBox } from '../../components/ui.js';

const GAME_SECONDS = 30;
const HEART_LIFETIME_MS = 3000;
const MAX_SCORE = 60;

type Phase = 'idle' | 'playing' | 'paused' | 'ended';

type Heart = { id: number; left: number; top: number };

function newRunId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through to the fallback below */ }
  return `run-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function randomHeart(id: number): Heart {
  // Keep the heart inside the play area with room for its own size.
  return { id, left: 8 + Math.random() * 76, top: 10 + Math.random() * 68 };
}

/**
 * Catch Hearts — TAP-TO-CATCH.
 *
 * Control scheme: hearts appear one at a time as <button> elements in the
 * play area. Tap or click a heart (or Tab to it and press Enter/Space) to
 * score +1; it is replaced by a new heart. There is no catcher to move and
 * no falling physics. Each heart gently fades after 3 seconds if untapped
 * and is replaced without penalty. You have 30 seconds.
 */
export function CatchHearts({ space, me }: { space: Space; me: Me }) {
  void me;
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(GAME_SECONDS);
  const [heart, setHeart] = useState<Heart>(() => randomHeart(0));
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const heartIdRef = useRef(1);
  const heartTimerRef = useRef<number | null>(null);
  const heartExpiresAtRef = useRef(0);
  const heartRemainingRef = useRef(HEART_LIFETIME_MS);
  const runIdRef = useRef(newRunId());
  const savedRunRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  // Reduced motion: the user's saved preference first, falling back to the
  // OS media query. getPreferences() is exported from lib/api.ts, so both
  // sources are honoured; if the preference read fails, matchMedia alone
  // decides (its initial value is already in state).
  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((prefs) => {
        if (cancelled) return;
        if (prefs.motion === 'reduce') setReduced(true);
        else if (prefs.motion === 'full') setReduced(false);
        else setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      })
      .catch(() => { /* matchMedia value already in state */ });
    return () => { cancelled = true; };
  }, []);

  const clearHeartTimer = useCallback(() => {
    if (heartTimerRef.current !== null) {
      window.clearTimeout(heartTimerRef.current);
      heartTimerRef.current = null;
    }
  }, []);

  const spawnHeart = useCallback(() => {
    clearHeartTimer();
    const next = randomHeart(heartIdRef.current++);
    heartRemainingRef.current = HEART_LIFETIME_MS;
    heartExpiresAtRef.current = Date.now() + HEART_LIFETIME_MS;
    setHeart(next);
    heartTimerRef.current = window.setTimeout(() => {
      // Heart faded untapped: replace it, no penalty, if still playing.
      if (phaseRef.current === 'playing') spawnHeart();
    }, HEART_LIFETIME_MS);
  }, [clearHeartTimer]);

  const startRun = useCallback(() => {
    clearHeartTimer();
    runIdRef.current = newRunId();
    savedRunRef.current = null;
    setScore(0);
    setSecondsLeft(GAME_SECONDS);
    setSaveState('idle');
    setPhase('playing');
    spawnHeart();
  }, [clearHeartTimer, spawnHeart]);

  // Countdown: ticks only while playing; pausing freezes it.
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // End the game when the timer hits zero.
  useEffect(() => {
    if (phase === 'playing' && secondsLeft === 0) {
      clearHeartTimer();
      setPhase('ended');
    }
  }, [phase, secondsLeft, clearHeartTimer]);

  // Save once, on game end, guarded against double-sends by run id.
  useEffect(() => {
    if (phase !== 'ended') return;
    if (savedRunRef.current === runIdRef.current) return;
    savedRunRef.current = runIdRef.current;
    const finalScore = Math.min(MAX_SCORE, score);
    setSaveState('saving');
    api(`/spaces/${space.id}/game-progress/catch-hearts`, {
      method: 'PUT',
      body: { progress: { lastScore: finalScore, runId: runIdRef.current } },
    })
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, space.id]);

  // Clean up the heart timer on unmount.
  useEffect(() => () => clearHeartTimer(), [clearHeartTimer]);

  const pause = () => {
    if (phase !== 'playing') return;
    clearHeartTimer();
    heartRemainingRef.current = Math.max(0, heartExpiresAtRef.current - Date.now());
    setPhase('paused');
  };

  const resume = () => {
    if (phase !== 'paused') return;
    setPhase('playing');
    heartExpiresAtRef.current = Date.now() + heartRemainingRef.current;
    heartTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === 'playing') spawnHeart();
    }, heartRemainingRef.current);
  };

  const catchHeart = () => {
    if (phase !== 'playing') return;
    setScore((s) => Math.min(MAX_SCORE, s + 1));
    spawnHeart();
  };

  const displayedScore = Math.min(MAX_SCORE, score);

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Catch Hearts</h2>
      <p>
        <strong>How to play — tap to catch:</strong> hearts appear one at a
        time in the play area below. Tap or click a heart — or Tab to it and
        press Enter or Space — to catch it and score +1. There is no catcher
        to move and nothing falls. Tap each heart before it fades. You have
        30 seconds.
      </p>

      {phase === 'idle' && (
        <div>
          <p>Ready when you are — press Start and catch as many hearts as you can in 30 seconds.</p>
          <button className="btn" type="button" onClick={startRun}>Start</button>
        </div>
      )}

      {(phase === 'playing' || phase === 'paused') && (
        <div>
          <p role="status" aria-live="polite">
            Time left: {secondsLeft} seconds · Score: {displayedScore}
            {phase === 'paused' && ' · Paused'}
          </p>
          <div
            role="group"
            aria-label="Heart play area"
            style={{
              position: 'relative',
              height: '280px',
              borderRadius: '0.75rem',
              background: '#fdf2f5',
              border: '1px solid #e8d5d8',
              overflow: 'hidden',
            }}
          >
            <button
              key={heart.id}
              type="button"
              aria-label="Catch this heart"
              onClick={catchHeart}
              style={{
                position: 'absolute',
                left: `${heart.left}%`,
                top: `${heart.top}%`,
                fontSize: '2.5rem',
                lineHeight: 1,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                // Gentle fade/scale only; under reduced motion the heart
                // appears statically in place with no animation at all.
                transition: reduced ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
                transform: 'scale(1)',
              }}
            >
              <span aria-hidden="true">♥</span>
            </button>
            {phase === 'paused' && (
              <p style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, background: 'rgba(255, 255, 255, 0.6)' }}>
                Paused — the timer and the hearts are frozen.
              </p>
            )}
          </div>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.8rem' }}>
            {phase === 'playing' ? (
              <button className="btn quiet" type="button" onClick={pause}>Pause</button>
            ) : (
              <button className="btn" type="button" onClick={resume}>Resume</button>
            )}
            <button className="btn quiet" type="button" onClick={startRun}>Restart</button>
          </p>
        </div>
      )}

      {phase === 'ended' && (
        <div role="status">
          <h3>Time&apos;s up!</h3>
          <p>Your final score: <strong>{displayedScore}</strong> heart{displayedScore === 1 ? '' : 's'} caught in 30 seconds.</p>
          {saveState === 'saving' && <p>Saving your score…</p>}
          {saveState === 'failed' && (
            <ErrorBox message="Your score could not be saved just now — the score above is still yours, it just was not stored." />
          )}
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            <button className="btn" type="button" onClick={startRun}>Play again</button>
          </p>
        </div>
      )}
    </Card>
  );
}
