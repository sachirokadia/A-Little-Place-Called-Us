import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, listItems, type AnyItem, type Me, type Space } from '../../lib/api.js';
import { Card, EmptyState, ErrorBox, ErrorState, FormField, LoadingState } from '../../components/ui.js';

interface Riddle {
  id: string;
  spaceId: string;
  authorId: string;
  sortOrder: number;
  question: string;
  hint?: string;
  // NOTE: riddle answers are NEVER returned by GET — same masking rule as
  // guesses. This component never expects, displays, or stores an answer
  // fetched from the server; answers only travel outward in create/edit
  // requests written by the riddle's own author.
}

interface ChestStateData {
  solvedRiddleIds: string[];
  totalCount: number;
  unlocked: boolean;
}

interface ChestReward {
  message: string;
  memoryId: string | null;
  memoryTitle?: string | null;
}

interface AttemptResult {
  correct: boolean;
  solvedCount: number;
  totalCount: number;
  unlocked: boolean;
}

/**
 * Treasure Chest — riddles in order, one current riddle at a time. Solving
 * them all unlocks a reward (a message and/or a real memory). Re-locking
 * clears only the caller's solves; riddles and the reward stay.
 *
 * No "Use sample riddles" button: samples would still be invented content
 * in a personal space, so riddles here are only the ones a partner writes.
 */
export function ChestGame({ space, me }: { space: Space; me: Me }) {
  const [riddles, setRiddles] = useState<Riddle[]>([]);
  const [chest, setChest] = useState<ChestStateData>({ solvedRiddleIds: [], totalCount: 0, unlocked: false });
  const [reward, setReward] = useState<ChestReward | null>(null);
  const [memories, setMemories] = useState<AnyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [guess, setGuess] = useState('');
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [attemptNote, setAttemptNote] = useState<string | null>(null);
  const [attempting, setAttempting] = useState(false);
  const [relocking, setRelocking] = useState(false);

  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newHint, setNewHint] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editHint, setEditHint] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [rewardMessage, setRewardMessage] = useState('');
  const [rewardMemoryId, setRewardMemoryId] = useState('');
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [rewardSaved, setRewardSaved] = useState(false);
  const [savingReward, setSavingReward] = useState(false);

  const memberName = useCallback((userId: string): string => {
    if (userId === me.id) return 'You';
    const member = space.members.find((m) => m.id === userId);
    return member ? member.displayName : 'Your partner';
  }, [me.id, space.members]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [riddleData, stateData, rewardData] = await Promise.all([
        api<Riddle[]>(`/spaces/${space.id}/chest-riddles`),
        api<ChestStateData>(`/spaces/${space.id}/chest-state`),
        api<ChestReward>(`/spaces/${space.id}/chest-reward`),
      ]);
      const sorted = (Array.isArray(riddleData) ? riddleData : [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setRiddles(sorted);
      setChest(stateData);
      setReward(rewardData);
      setRewardMessage(rewardData?.message ?? '');
      setRewardMemoryId(rewardData?.memoryId ?? '');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the chest.');
    } finally {
      setLoading(false);
    }
    // The memory picker is a convenience, not load-bearing: a failure here
    // must not block the chest itself.
    try {
      const items = await listItems(space.id, 'memories');
      setMemories(Array.isArray(items) ? items : []);
    } catch {
      setMemories([]);
    }
  }, [space.id]);

  useEffect(() => { void load(); }, [load]);

  const solvedSet = new Set(chest.solvedRiddleIds);
  const currentRiddle = riddles.find((r) => !solvedSet.has(r.id)) ?? null;
  const allSolved = riddles.length > 0 && riddles.every((r) => solvedSet.has(r.id));
  const unlocked = chest.unlocked || allSolved;
  const rewardConfigured = Boolean(reward && (reward.message || reward.memoryId));

  const attempt = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentRiddle || !guess.trim()) return;
    setAttempting(true);
    setAttemptError(null);
    setAttemptNote(null);
    try {
      const result = await api<AttemptResult>(`/spaces/${space.id}/chest-riddles/${currentRiddle.id}/attempt`, {
        method: 'POST',
        body: { guess: guess.trim() },
      });
      if (result.correct) {
        setChest((prev) => ({
          solvedRiddleIds: [...prev.solvedRiddleIds, currentRiddle.id],
          totalCount: result.totalCount,
          unlocked: result.unlocked,
        }));
        setAttemptNote(result.unlocked ? 'That is right — and the chest is open!' : 'That is right — on to the next riddle.');
        setGuess('');
      } else {
        setAttemptNote('Not quite — try again, no penalty.');
      }
    } catch (err) {
      // Out-of-order attempts are rejected 400 by the server; surface its
      // message honestly (expected: "Solve the earlier riddles first.").
      setAttemptError(err instanceof Error ? err.message : 'Could not check that guess.');
    } finally {
      setAttempting(false);
    }
  };

  const relock = async () => {
    setRelocking(true);
    setAttemptNote(null);
    setAttemptError(null);
    try {
      await api(`/spaces/${space.id}/chest-relock`, { method: 'POST' });
      // Clears only the caller's solves; riddles and the reward stay put.
      setChest((prev) => ({ ...prev, solvedRiddleIds: [], unlocked: false }));
      setGuess('');
    } catch (err) {
      setAttemptError(err instanceof Error ? err.message : 'Could not lock the chest again.');
    } finally {
      setRelocking(false);
    }
  };

  const addRiddle = async (e: FormEvent) => {
    e.preventDefault();
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const maxOrder = riddles.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
      await api(`/spaces/${space.id}/chest-riddles`, {
        method: 'POST',
        body: {
          question: newQuestion.trim(),
          answer: newAnswer.trim(),
          hint: newHint.trim() || undefined,
          sortOrder: riddles.length === 0 ? 0 : maxOrder + 1,
        },
      });
      setNewQuestion('');
      setNewAnswer('');
      setNewHint('');
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add this riddle.');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (riddle: Riddle) => {
    setEditingId(riddle.id);
    setEditQuestion(riddle.question);
    setEditAnswer('');
    setEditHint(riddle.hint ?? '');
    setEditError(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId || !editQuestion.trim()) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = { question: editQuestion.trim(), hint: editHint.trim() || undefined };
      // Only send a new answer if the author typed one; a blank answer
      // field means "keep the existing answer", never "erase it".
      if (editAnswer.trim()) body.answer = editAnswer.trim();
      await api(`/spaces/${space.id}/chest-riddles/${editingId}`, { method: 'PATCH', body });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save this riddle.');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteRiddle = async (id: string) => {
    try {
      await api(`/spaces/${space.id}/chest-riddles/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not delete this riddle.');
    }
  };

  const saveReward = async (e: FormEvent) => {
    e.preventDefault();
    setSavingReward(true);
    setRewardError(null);
    setRewardSaved(false);
    try {
      const saved = await api<ChestReward>(`/spaces/${space.id}/chest-reward`, {
        method: 'PUT',
        body: { message: rewardMessage, memoryId: rewardMemoryId || undefined },
      });
      setReward(saved);
      setRewardSaved(true);
    } catch (err) {
      setRewardError(err instanceof Error ? err.message : 'Could not save this reward.');
    } finally {
      setSavingReward(false);
    }
  };

  if (loading) return <LoadingState label="Loading the treasure chest…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  return (
    <div>
      {riddles.length === 0 ? (
        <EmptyState title="No riddles yet" message="No riddles yet — add the first one below." />
      ) : (
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          {riddles.map((riddle) => {
            const solved = solvedSet.has(riddle.id);
            const isCurrent = currentRiddle?.id === riddle.id;
            const isOwn = riddle.authorId === me.id;
            const lockLabel = solved ? '🔓 Solved' : isCurrent ? '🔑 Current riddle' : '🔒 Locked';
            return (
              <Card key={riddle.id}>
                <p style={{ margin: '0 0 0.25rem' }} role="status">{lockLabel}</p>
                <h3 style={{ marginTop: 0 }}>{riddle.question}</h3>
                {riddle.hint && <p><small>Hint: {riddle.hint}</small></p>}
                <p><small>Written by {memberName(riddle.authorId)}</small></p>

                {isCurrent && !unlocked && (
                  <form onSubmit={(e) => void attempt(e)}>
                    <FormField label="Your guess for this riddle">
                      <input
                        type="text"
                        value={guess}
                        onChange={(e) => setGuess(e.target.value)}
                        placeholder="What is the answer?"
                      />
                    </FormField>
                    <ErrorBox message={attemptError} />
                    {attemptNote && <p role="status">{attemptNote}</p>}
                    <button className="btn" type="submit" disabled={attempting || !guess.trim()}>
                      {attempting ? 'Checking…' : 'Try this answer'}
                    </button>
                  </form>
                )}
                {!isCurrent && !solved && (
                  <p><small>Solve the earlier riddles first.</small></p>
                )}

                {isOwn && editingId !== riddle.id && (
                  <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                    <button className="btn quiet" type="button" onClick={() => startEdit(riddle)}>Edit</button>
                    {confirmDeleteId === riddle.id ? (
                      <>
                        <button className="btn" type="button" onClick={() => void deleteRiddle(riddle.id)}>Delete this riddle — confirm</button>
                        <button className="btn quiet" type="button" onClick={() => setConfirmDeleteId(null)}>Keep it</button>
                      </>
                    ) : (
                      <button className="btn quiet" type="button" onClick={() => setConfirmDeleteId(riddle.id)}>Delete</button>
                    )}
                  </p>
                )}
                {isOwn && editingId === riddle.id && (
                  <form onSubmit={(e) => void saveEdit(e)}>
                    <FormField label="Question">
                      <input type="text" value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)} />
                    </FormField>
                    <FormField label="Answer (leave blank to keep the current answer)">
                      <input type="text" value={editAnswer} onChange={(e) => setEditAnswer(e.target.value)} placeholder="New answer, or blank to keep it" />
                    </FormField>
                    <FormField label="Hint (optional)">
                      <input type="text" value={editHint} onChange={(e) => setEditHint(e.target.value)} />
                    </FormField>
                    <ErrorBox message={editError} />
                    <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                      <button className="btn" type="submit" disabled={savingEdit || !editQuestion.trim()}>
                        {savingEdit ? 'Saving…' : 'Save riddle'}
                      </button>
                      <button className="btn quiet" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </p>
                  </form>
                )}
              </Card>
            );
          })}
          <p role="status">
            Solved: {chest.solvedRiddleIds.length} of {riddles.length}
          </p>
          <p>
            <button className="btn quiet" type="button" onClick={() => void relock()} disabled={relocking}>
              {relocking ? 'Locking…' : 'Lock the chest again'}
            </button>{' '}
            <small>Re-locking clears only your solves so you can play again — it does not delete riddles or the reward.</small>
          </p>
          {attemptError && !currentRiddle && <ErrorBox message={attemptError} />}
        </div>
      )}

      {unlocked && (
        <Card>
          <h3 style={{ marginTop: 0 }}>The chest is open!</h3>
          {rewardConfigured ? (
            <div role="status">
              {reward!.message && <p>{reward!.message}</p>}
              {reward!.memoryId && (
                <p>
                  <Link to="/memories">
                    {reward!.memoryTitle ? `“${reward!.memoryTitle}” — ` : ''}See it on the Memory Wall →
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <p>No reward configured yet — add one below.</p>
          )}
        </Card>
      )}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        <Card>
          <h3 style={{ marginTop: 0 }}>Add a riddle</h3>
          <form onSubmit={(e) => void addRiddle(e)}>
            <FormField label="Question">
              <input type="text" value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Write a riddle…" />
            </FormField>
            <FormField label="Answer (kept private — never shown until solved)">
              <input type="text" value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)} placeholder="The answer" />
            </FormField>
            <FormField label="Hint (optional)">
              <input type="text" value={newHint} onChange={(e) => setNewHint(e.target.value)} placeholder="A gentle hint" />
            </FormField>
            <ErrorBox message={addError} />
            <button className="btn" type="submit" disabled={adding || !newQuestion.trim() || !newAnswer.trim()}>
              {adding ? 'Adding…' : 'Add riddle'}
            </button>
          </form>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>Chest reward</h3>
          <p><small>Shown when every riddle is solved. Pick a real memory from this space, or leave the memory blank and write a message only — no memory is invented.</small></p>
          <form onSubmit={(e) => void saveReward(e)}>
            <FormField label="Reward message">
              <textarea value={rewardMessage} onChange={(e) => setRewardMessage(e.target.value)} placeholder="A message for when the chest opens…" />
            </FormField>
            <FormField label="Linked memory (optional)">
              <select value={rewardMemoryId} onChange={(e) => setRewardMemoryId(e.target.value)}>
                <option value="">No memory — message only</option>
                {memories.map((m) => (
                  <option key={m.id} value={m.id}>
                    {typeof m.title === 'string' ? m.title : m.id}
                  </option>
                ))}
              </select>
            </FormField>
            <ErrorBox message={rewardError} />
            {rewardSaved && <p role="status">Reward saved.</p>}
            <button className="btn" type="submit" disabled={savingReward}>
              {savingReward ? 'Saving…' : 'Save reward'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
