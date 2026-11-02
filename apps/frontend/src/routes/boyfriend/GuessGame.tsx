import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Me, type Space } from '../../lib/api.js';
import { Card, EmptyState, ErrorBox, ErrorState, FormField, LoadingState } from '../../components/ui.js';

interface GuessRound {
  id: string;
  spaceId: string;
  creatorId: string;
  question: string;
  status: string;
  revealed: boolean;
  guesserId?: string;
  guessText?: string;
  correct?: boolean;
  // IMPORTANT: for a round the caller did not create and that is not yet
  // revealed, the server omits `answer` entirely. This component never
  // reads, displays, guesses at, or stores an answer for such a round —
  // it is only rendered once `revealed` is true.
  answer?: string;
}

/**
 * Guess Game — one partner writes a question with a private answer, the
 * other gets exactly one guess, then the answer is revealed.
 */
export function GuessGame({ space, me }: { space: Space; me: Me }) {
  const [rounds, setRounds] = useState<GuessRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [guessErrors, setGuessErrors] = useState<Record<string, string>>({});
  const [guessingId, setGuessingId] = useState<string | null>(null);

  const memberName = useCallback((userId: string): string => {
    if (userId === me.id) return 'You';
    const member = space.members.find((m) => m.id === userId);
    return member ? member.displayName : 'Your partner';
  }, [me.id, space.members]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api<GuessRound[]>(`/spaces/${space.id}/guess-rounds`);
      setRounds(Array.isArray(data) ? data : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load guess rounds.');
    } finally {
      setLoading(false);
    }
  }, [space.id]);

  useEffect(() => { void load(); }, [load]);

  const createRound = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api(`/spaces/${space.id}/guess-rounds`, {
        method: 'POST',
        body: { question: question.trim(), answer: answer.trim() },
      });
      setQuestion('');
      setAnswer('');
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create this round.');
    } finally {
      setCreating(false);
    }
  };

  const submitGuess = async (round: GuessRound) => {
    const guess = (guesses[round.id] ?? '').trim();
    if (!guess) return;
    setGuessingId(round.id);
    setGuessErrors((prev) => ({ ...prev, [round.id]: '' }));
    try {
      // The server returns the revealed round (with answer + correct).
      // Until this returns, no answer for this round exists client-side.
      const revealed = await api<GuessRound>(`/spaces/${space.id}/guess-rounds/${round.id}/guess`, {
        method: 'POST',
        body: { guess },
      });
      setRounds((prev) => prev.map((r) => (r.id === round.id ? { ...r, ...revealed, revealed: true } : r)));
      setGuesses((prev) => ({ ...prev, [round.id]: '' }));
    } catch (err) {
      // Server 400s (creator guessing their own round, or a second guess)
      // are surfaced with the server's own message, honestly.
      setGuessErrors((prev) => ({ ...prev, [round.id]: err instanceof Error ? err.message : 'Could not submit this guess.' }));
    } finally {
      setGuessingId(null);
    }
  };

  if (loading) return <LoadingState label="Loading guess rounds…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  return (
    <div>
      {rounds.length === 0 ? (
        <EmptyState title="No guess rounds yet" message="No guess rounds yet — create the first one below." />
      ) : (
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          {rounds.map((round) => {
            const isCreator = round.creatorId === me.id;
            const alreadyGuessed = round.revealed || round.guesserId === me.id;
            return (
              <Card key={round.id}>
                <h3 style={{ marginTop: 0 }}>{round.question}</h3>
                <p style={{ margin: '0.25rem 0' }}>
                  Asked by {memberName(round.creatorId)} · Status: {round.revealed ? 'Revealed' : 'Open'}
                </p>

                {round.revealed ? (
                  <div role="status">
                    {round.guessText !== undefined && <p>Guess: <strong>{round.guessText}</strong></p>}
                    {round.answer !== undefined && <p>Answer: <strong>{round.answer}</strong></p>}
                    {round.correct !== undefined && (
                      <p>
                        {round.correct
                          ? 'That was right — nicely guessed!'
                          : 'Not quite this time — a good guess all the same.'}
                      </p>
                    )}
                  </div>
                ) : isCreator ? (
                  <p>Waiting for your partner&apos;s guess.</p>
                ) : (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void submitGuess(round); }}
                  >
                    <FormField label="Your one guess">
                      <input
                        type="text"
                        value={guesses[round.id] ?? ''}
                        onChange={(e) => setGuesses((prev) => ({ ...prev, [round.id]: e.target.value }))}
                        disabled={alreadyGuessed || guessingId === round.id}
                        placeholder="Take your one guess…"
                      />
                    </FormField>
                    <ErrorBox message={guessErrors[round.id] ?? null} />
                    <button
                      className="btn"
                      type="submit"
                      disabled={alreadyGuessed || guessingId === round.id || !(guesses[round.id] ?? '').trim()}
                    >
                      {guessingId === round.id ? 'Checking…' : 'Submit guess'}
                    </button>
                    <p><small>You get exactly one guess for each round.</small></p>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <h3 style={{ marginTop: 0 }}>Create a guess round</h3>
        <form onSubmit={(e) => void createRound(e)}>
          <FormField label="Question">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask something your partner can guess…"
            />
          </FormField>
          <FormField label="Private answer">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer — kept private"
            />
          </FormField>
          <p><small>Your answer stays private until the guess is revealed.</small></p>
          <ErrorBox message={createError} />
          <button className="btn" type="submit" disabled={creating || !question.trim() || !answer.trim()}>
            {creating ? 'Creating…' : 'Create round'}
          </button>
        </form>
      </Card>
    </div>
  );
}
