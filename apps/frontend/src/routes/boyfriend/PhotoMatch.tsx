// Photo Match — game 1 of THE BOYFRIEND ARCADE.
//
// Self-contained: the coordinator wires this component into the arcade.
// It builds its deck from the space's REAL shared memories with media
// (never a fake photo, never an invented memory). Any pair slots left
// over when there are fewer photo memories than the chosen pair count
// are filled with clearly-labelled typographic pattern cards, and the
// player is told plainly to add photos to the Memory Wall.
//
// Visual language follows the arcade: paper/wood/serif, soft pastel
// cards, gentle changes only. There are no CSS transitions or
// animations on the cards at all — a flip is an instant content swap
// — so the reduced-motion preference is honoured by construction.
// The preference is still read (server preference via getPreferences()
// first, OS matchMedia as fallback) and, when reduced motion is on,
// a mismatched pair stays visible a little longer before flipping back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getPreferences, listItems, type AnyItem, type Me, type Space } from '../../lib/api.js';
import { Card, ErrorState, LoadingState } from '../../components/ui.js';

// Pair counts, chosen in exactly one place in this file.
const PAIR_OPTIONS = [4, 6, 8] as const;

// Pattern fillers: typographic symbols only, always labelled "Pattern".
// These are NOT the arcade's symbol Match deck reused as photos — they
// are only the fallback for slots with no real photo behind them.
const PATTERNS: { symbol: string; name: string }[] = [
  { symbol: '★', name: 'Star' },
  { symbol: '♦', name: 'Diamond' },
  { symbol: '♠', name: 'Spade' },
  { symbol: '♣', name: 'Clover' },
  { symbol: '♥', name: 'Heart' },
  { symbol: '♪', name: 'Note' },
  { symbol: '☀', name: 'Sun' },
  { symbol: '☾', name: 'Moon' },
];

const FEWER_PHOTOS_NOTICE =
  'Fewer shared photos than pairs — add photos to the Memory Wall to play with your photos.';

type PhotoMemory = { memoryId: string; assetId: string; title: string };

type PairSource =
  | { pairId: string; kind: 'photo'; assetId: string; title: string }
  | { pairId: string; kind: 'pattern'; symbol: string; name: string };

type DeckCard = { cardId: string; pair: PairSource };

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function isImageAsset(a: AnyItem): boolean {
  const mime = typeof a.mimeType === 'string' ? a.mimeType : '';
  // The server already returns only active assets for /media/for/...;
  // keep the status check as well so a non-active row is never used.
  const status = typeof a.status === 'string' ? a.status : 'active';
  return mime.startsWith('image/') && status === 'active';
}

export function PhotoMatch({ space, me: _me }: { space: Space; me: Me }) {
  void _me; // Both partners play the same shared deck; no per-player split.
  const [pairCount, setPairCount] = useState<number>(PAIR_OPTIONS[0]);
  const [photoMemories, setPhotoMemories] = useState<PhotoMemory[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Game state. gameId changes on every restart/replay so the deck
  // reshuffles and the once-only save guard resets.
  const [gameId, setGameId] = useState(0);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [finalSeconds, setFinalSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const flipBackTimerRef = useRef<number | null>(null);
  const savedGameIdRef = useRef(-1);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reduced motion: server preference first, OS setting as fallback.
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setReducedMotion(prefs.motion === 'reduce' || (prefs.motion === 'system' && osReduced));
      })
      .catch(() => {
        // Preference unreadable: the OS setting already seeded the state.
      });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const memories = await listItems(space.id, 'memories');
      // One media lookup per memory; a single failing lookup must not
      // sink the whole game, so failures resolve to "no photo".
      const settled = await Promise.all(
        memories.map(async (memory) => {
          try {
            const assets = await api<AnyItem[]>(`/media/for/memory/${memory.id}`);
            const image = assets.find(isImageAsset);
            if (!image) return null;
            const title = typeof memory.title === 'string' && memory.title.trim() !== '' ? memory.title : 'Shared memory';
            return { memoryId: memory.id, assetId: image.id, title } as PhotoMemory;
          } catch {
            return null;
          }
        }),
      );
      setPhotoMemories(settled.filter((p): p is PhotoMemory => p !== null));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your photos');
      setPhotoMemories(null);
    }
  }, [space.id]);

  useEffect(() => {
    void load();
  }, [load, loadAttempt]);

  useEffect(() => () => {
    if (flipBackTimerRef.current !== null) window.clearTimeout(flipBackTimerRef.current);
  }, []);

  const deck = useMemo<DeckCard[]>(() => {
    if (photoMemories === null) return [];
    const photos = shuffle(photoMemories).slice(0, pairCount);
    const pairs: PairSource[] = photos.map((p) => ({
      pairId: `photo-${p.memoryId}-${p.assetId}`,
      kind: 'photo',
      assetId: p.assetId,
      title: p.title,
    }));
    const remaining = pairCount - pairs.length;
    for (let i = 0; i < remaining; i++) {
      const pattern = PATTERNS[i % PATTERNS.length]!;
      pairs.push({ pairId: `pattern-${i}`, kind: 'pattern', symbol: pattern.symbol, name: pattern.name });
    }
    return shuffle(
      pairs.flatMap((pair) => [
        { cardId: `${pair.pairId}-a`, pair },
        { cardId: `${pair.pairId}-b`, pair },
      ]),
    );
  }, [photoMemories, pairCount, gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  // gameId is intentionally a dependency: it is the reshuffle trigger.

  // Ticking clock: starts on the first flip, stops on completion.
  useEffect(() => {
    if (startedAtRef.current === null || completed) return undefined;
    const timer = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [completed, gameId]);

  const restart = useCallback(() => {
    if (flipBackTimerRef.current !== null) window.clearTimeout(flipBackTimerRef.current);
    startedAtRef.current = null;
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setBusy(false);
    setCompleted(false);
    setFinalSeconds(0);
    setElapsed(0);
    setSaveFailed(false);
    setGameId((g) => g + 1);
  }, []);

  const changePairCount = (next: number) => {
    setPairCount(next);
    restart();
  };

  // Completion: stop the clock and save exactly once per game.
  useEffect(() => {
    if (completed || deck.length === 0 || matched.size !== pairCount) return;
    const seconds = startedAtRef.current !== null ? Math.floor((Date.now() - startedAtRef.current) / 1000) : elapsed;
    setFinalSeconds(seconds);
    setCompleted(true);
    if (savedGameIdRef.current !== gameId) {
      savedGameIdRef.current = gameId;
      // moves >= pairs by construction: a move is one attempted pair,
      // and every pair must be attempted at least once to finish.
      api(`/spaces/${space.id}/game-progress/photo-match`, {
        method: 'PUT',
        body: { progress: { lastMoves: moves, lastPairs: pairCount, lastSeconds: seconds } },
      }).catch(() => setSaveFailed(true));
    }
  }, [matched, pairCount, deck.length, completed, elapsed, gameId, moves, space.id]);

  const flip = (index: number) => {
    if (busy || completed) return;
    if (flipped.includes(index)) return;
    const card = deck[index];
    if (!card || matched.has(card.pair.pairId)) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    if (flipped.length === 0) {
      setFlipped([index]);
      return;
    }
    const first = deck[flipped[0]!]!;
    const newMoves = moves + 1;
    setMoves(newMoves);
    setFlipped([flipped[0]!, index]);
    if (first.pair.pairId === card.pair.pairId) {
      const next = new Set(matched);
      next.add(card.pair.pairId);
      setMatched(next);
      setFlipped([]);
    } else {
      setBusy(true);
      // No animation: the pair simply swaps back after a short delay.
      // Reduced motion keeps the mismatched pair visible a little longer.
      const delay = reducedMotion ? 1200 : 900;
      flipBackTimerRef.current = window.setTimeout(() => {
        setFlipped([]);
        setBusy(false);
      }, delay);
    }
  };

  const onCardKeyDown = (e: React.KeyboardEvent, index: number) => {
    const cols = 4;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rows = Math.ceil(deck.length / cols);
    let next = index;
    if (e.key === 'ArrowLeft') next = row * cols + Math.max(0, col - 1);
    else if (e.key === 'ArrowRight') next = row * cols + Math.min(cols - 1, col + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, row - 1) * cols + col;
    else if (e.key === 'ArrowDown') next = Math.min(rows - 1, row + 1) * cols + col;
    else return;
    if (next >= deck.length) return;
    e.preventDefault();
    btnRefs.current[next]?.focus();
  };

  if (loadError) {
    return (
      <Card>
        <ErrorState
          message={loadError}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      </Card>
    );
  }

  if (photoMemories === null) {
    return (
      <Card>
        <LoadingState label="Loading your shared photos…" />
      </Card>
    );
  }

  const photoCount = photoMemories.length;
  const showNotice = photoCount < pairCount;
  const pairsFound = matched.size;
  const shownSeconds = completed ? finalSeconds : elapsed;

  return (
    <Card>
      <p>
        Flip two cards. Find all {pairCount} pairs. Playable by tap, click, or keyboard: Tab to a card,
        use the arrow keys to move across the grid, and press Enter or Space to flip.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', marginBottom: '0.8rem' }}>
        <label htmlFor="photo-match-pairs" style={{ marginBottom: 0 }}>Pairs:</label>
        <select
          id="photo-match-pairs"
          className="field"
          style={{ width: 'auto' }}
          value={pairCount}
          onChange={(e) => changePairCount(Number(e.target.value))}
        >
          {PAIR_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} pairs</option>
          ))}
        </select>
        <button className="btn quiet" type="button" onClick={restart}>
          {completed ? 'Play again' : 'Restart'}
        </button>
      </div>

      {showNotice && (
        <p className="notice" role="status">{FEWER_PHOTOS_NOTICE}</p>
      )}

      <p role="status">
        Moves: {moves} · Pairs found: {pairsFound} of {pairCount} · Time: {formatTime(shownSeconds)}
        {photoCount > 0 && <> · {Math.min(photoCount, pairCount)} of these pairs {photoCount === 1 ? 'is' : 'are'} from your photos</>}
      </p>

      <div
        role="group"
        aria-label="Photo match card grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(64px, 1fr))', gap: '0.6rem', maxWidth: '560px', margin: '1rem 0' }}
      >
        {deck.map((card, i) => {
          const isUp = flipped.includes(i) || matched.has(card.pair.pairId);
          const isMatched = matched.has(card.pair.pairId);
          const faceLabel =
            card.pair.kind === 'photo'
              ? `${card.pair.title} photo card`
              : `${card.pair.name} pattern card`;
          return (
            <button
              key={card.cardId}
              ref={(el) => { btnRefs.current[i] = el; }}
              type="button"
              aria-label={isUp ? faceLabel : 'Face-down card'}
              onClick={() => flip(i)}
              onKeyDown={(e) => onCardKeyDown(e, i)}
              style={{
                minHeight: '64px',
                minWidth: '64px',
                padding: '0.5rem',
                cursor: 'pointer',
                font: 'inherit',
                background: isMatched ? '#e8f0e0' : isUp ? '#fffdf6' : '#f7ecd9',
                border: '2px solid #4a3226',
                borderRadius: '0.5rem',
                color: '#2b1d3a',
              }}
            >
              {isUp ? (
                card.pair.kind === 'photo' ? (
                  <span>
                    <img
                      src={`/api/v1/media/${card.pair.assetId}?size=display`}
                      alt={card.pair.title}
                      loading="lazy"
                      decoding="async"
                      style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto 0.35rem' }}
                    />
                    <span style={{ display: 'block', fontSize: '0.85rem', lineHeight: 1.3 }}>{card.pair.title}</span>
                  </span>
                ) : (
                  <span>
                    <span aria-hidden="true" style={{ display: 'block', fontSize: '1.6rem', lineHeight: 1 }}>{card.pair.symbol}</span>
                    <span style={{ display: 'block', fontSize: '0.85rem', marginTop: '0.25rem' }}>Pattern</span>
                  </span>
                )
              ) : (
                <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>?</span>
              )}
            </button>
          );
        })}
      </div>

      {completed && (
        <div role="status" style={{ marginTop: '1rem' }}>
          <p>
            <strong>All pairs found!</strong> {moves} moves · {formatTime(finalSeconds)} · {pairCount} pairs.
          </p>
          {saveFailed && (
            <p className="error">Progress could not be saved — your game still counted here.</p>
          )}
          <button className="btn" type="button" onClick={restart}>Play again</button>
        </div>
      )}
    </Card>
  );
}
