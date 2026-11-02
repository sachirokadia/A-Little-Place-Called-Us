// Quiz Game — game 2 of THE BOYFRIEND ARCADE.
//
// Database-backed only: questions live in the space's quiz-question
// rows and are never hardcoded as playable content. GET never returns
// a correct answer, so this component never expects or displays one
// before submission; after submission the server's per-question
// correct:boolean is the only feedback shown, in gentle wording.
//
// Play: one question at a time, Next/Previous to move (selecting an
// option does NOT auto-advance — that is stated on screen), Finish on
// the last question submits every answer in ONE POST. Manage: any
// space member may add a question; Edit/Delete appear only on the
// caller's own questions (the server is the enforcement; hiding the
// controls is just convenience).
//
// No animations, no sound, no autoplay anywhere in this component.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Me, type Space } from '../../lib/api.js';
import { Card, EmptyState, ErrorBox, ErrorState, FormField, LoadingState } from '../../components/ui.js';

type QuizQuestion = {
  id: string;
  spaceId: string;
  authorId: string;
  question: string;
  options: string[];
  createdAt: string;
};

type SubmissionResult = {
  questionId: string;
  correct: boolean;
};

type SubmissionResponse = {
  score: number;
  total: number;
  results: SubmissionResult[];
};

// "Use sample questions" posts these through the same POST endpoint,
// so they become real database rows the partners can edit and delete.
// They are labelled as samples and are generic — nothing about the
// couple is claimed or invented.
const SAMPLE_QUESTIONS: { question: string; options: string[]; correctOption: number }[] = [
  {
    question: 'Sample: which of these would you pick for a quiet evening?',
    options: ['A board game', 'A walk after dinner', 'A film at home', 'Cooking something new'],
    correctOption: 1,
  },
  {
    question: 'Sample: which snack would you reach for first?',
    options: ['Popcorn', 'Fruit', 'Chocolate', 'Crisps'],
    correctOption: 0,
  },
  {
    question: 'Sample: which season do you like best?',
    options: ['Spring', 'Summer', 'Autumn', 'Winter'],
    correctOption: 2,
  },
];

type QuestionDraft = { question: string; options: string[]; correctOption: number | null };

const EMPTY_DRAFT: QuestionDraft = { question: '', options: ['', ''], correctOption: null };

function validateDraft(draft: QuestionDraft): string | null {
  if (draft.question.trim() === '') return 'Please write a question first.';
  const filled = draft.options.map((o) => o.trim()).filter((o) => o !== '');
  if (filled.length < 2) return 'Please fill in at least two options.';
  if (draft.correctOption === null) return 'Please pick which option is the correct answer.';
  if (draft.options[draft.correctOption] === undefined || draft.options[draft.correctOption]!.trim() === '') {
    return 'The correct answer must be one of the filled-in options.';
  }
  return null;
}

function draftFromQuestion(q: QuizQuestion): QuestionDraft {
  return { question: q.question, options: [...q.options], correctOption: null };
  // correctOption is deliberately NOT prefilled: GET never returns it,
  // so an edit must choose it afresh rather than pretend to know it.
}

export function QuizGame({ space, me }: { space: Space; me: Me }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Play state.
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [runId, setRunId] = useState(0);
  const submitKeyRef = useRef(`quiz-run-${Date.now()}`);

  // Manage state.
  const [draft, setDraft] = useState<QuestionDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<QuestionDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [addingSamples, setAddingSamples] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await api<QuizQuestion[]>(`/spaces/${space.id}/quiz-questions`);
      setQuestions(Array.isArray(rows) ? rows : []);
      setQIndex(0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the quiz questions');
      setQuestions(null);
    }
  }, [space.id]);

  useEffect(() => {
    void load();
  }, [load, loadAttempt]);

  const playAgain = () => {
    setAnswers({});
    setQIndex(0);
    setResult(null);
    setSubmitError(null);
    setSubmitting(false);
    submitKeyRef.current = `quiz-run-${Date.now()}-${runId + 1}`;
    setRunId((r) => r + 1);
  };

  const finish = async () => {
    if (!questions || submitting) return;
    const payload = questions.map((q) => ({ questionId: q.id, optionIndex: answers[q.id]! }));
    setSubmitting(true);
    setSubmitError(null);
    try {
      // One submission for the whole run. The button is disabled while
      // submitting, and a stable idempotency key covers a retry of the
      // same run, so a double-click cannot double-submit.
      const data = await api<SubmissionResponse>(`/spaces/${space.id}/quiz-submissions`, {
        method: 'POST',
        body: { answers: payload },
        idempotencyKey: submitKeyRef.current,
      });
      setResult(data);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not submit your answers');
    } finally {
      setSubmitting(false);
    }
  };

  const addQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await api(`/spaces/${space.id}/quiz-questions`, {
        method: 'POST',
        body: {
          question: draft.question.trim(),
          options: draft.options.map((o) => o.trim()).filter((o) => o !== ''),
          correctOption: draft.correctOption,
        },
      });
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add that question');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const error = validateDraft(editDraft);
    if (error) {
      setEditError(error);
      return;
    }
    setEditError(null);
    setSaving(true);
    try {
      await api(`/spaces/${space.id}/quiz-questions/${id}`, {
        method: 'PATCH',
        body: {
          question: editDraft.question.trim(),
          options: editDraft.options.map((o) => o.trim()).filter((o) => o !== ''),
          correctOption: editDraft.correctOption,
        },
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save those changes');
    } finally {
      setSaving(false);
    }
  };

  const deleteQuestion = async (id: string) => {
    setManageError(null);
    try {
      await api(`/spaces/${space.id}/quiz-questions/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      await load();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Could not delete that question');
    }
  };

  const addSamples = async () => {
    setManageError(null);
    setAddingSamples(true);
    try {
      for (const sample of SAMPLE_QUESTIONS) {
        await api(`/spaces/${space.id}/quiz-questions`, { method: 'POST', body: sample });
      }
      await load();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Could not add the sample questions');
    } finally {
      setAddingSamples(false);
    }
  };

  const optionEditor = (
    draftValue: QuestionDraft,
    setDraftValue: (d: QuestionDraft) => void,
    idPrefix: string,
  ) => (
    <div>
      {draftValue.options.map((opt, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <input
            id={`${idPrefix}-option-${i}`}
            className="field"
            value={opt}
            maxLength={200}
            onChange={(e) => {
              const next = [...draftValue.options];
              next[i] = e.target.value;
              setDraftValue({ ...draftValue, options: next });
            }}
            placeholder={`Option ${i + 1}`}
            aria-label={`Option ${i + 1}`}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: 0, whiteSpace: 'nowrap' }}>
            <input
              type="radio"
              name={`${idPrefix}-correct`}
              checked={draftValue.correctOption === i}
              onChange={() => setDraftValue({ ...draftValue, correctOption: i })}
            />
            Correct
          </label>
          {draftValue.options.length > 2 && (
            <button
              className="btn quiet"
              type="button"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => {
                const next = draftValue.options.filter((_, j) => j !== i);
                setDraftValue({
                  ...draftValue,
                  options: next,
                  correctOption:
                    draftValue.correctOption === null
                      ? null
                      : draftValue.correctOption === i
                        ? null
                        : draftValue.correctOption > i
                          ? draftValue.correctOption - 1
                          : draftValue.correctOption,
                });
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {draftValue.options.length < 6 && (
        <button
          className="btn quiet"
          type="button"
          onClick={() => setDraftValue({ ...draftValue, options: [...draftValue.options, ''] })}
        >
          Add option
        </button>
      )}
    </div>
  );

  if (loadError) {
    return (
      <Card>
        <ErrorState message={loadError} onRetry={() => setLoadAttempt((n) => n + 1)} />
      </Card>
    );
  }

  if (questions === null) {
    return (
      <Card>
        <LoadingState label="Loading the quiz…" />
      </Card>
    );
  }

  const current = questions[qIndex];
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);
  const resultById = new Map((result?.results ?? []).map((r) => [r.questionId, r.correct]));

  return (
    <div>
      <Card>
        {questions.length === 0 ? (
          <EmptyState
            title="No questions yet"
            message="No questions yet — add the first one below."
          />
        ) : result ? (
          <div role="status">
            <h3 style={{ marginTop: 0 }}>You matched {result.score} of {result.total}</h3>
            <p>That is how many answers lined up with the question&apos;s answer. No judgement either way — it is a game, not a test.</p>
            {questions.map((q) => {
              const picked = answers[q.id];
              const wasCorrect = resultById.get(q.id);
              return (
                <div key={q.id} style={{ marginBottom: '1rem' }}>
                  <p style={{ marginBottom: '0.25rem' }}><strong>{q.question}</strong></p>
                  <p style={{ margin: '0 0 0.25rem' }}>
                    You picked: {picked !== undefined ? q.options[picked] : 'No answer'}
                  </p>
                  <p style={{ margin: 0 }}>
                    {wasCorrect === true
                      ? 'You got this one!'
                      : 'Not this one — no worries, that is what the game is for.'}
                  </p>
                </div>
              );
            })}
            <button className="btn" type="button" onClick={playAgain}>Play again</button>
          </div>
        ) : current ? (
          <div>
            <p role="status">
              Question {qIndex + 1} of {questions.length}
            </p>
            <h3 style={{ marginTop: 0 }}>{current.question}</h3>
            <p><small>Pick an option, then use Next and Previous to move — picking an option does not jump ahead on its own.</small></p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {current.options.map((opt, i) => (
                <button
                  key={i}
                  className="btn quiet"
                  type="button"
                  aria-pressed={answers[current.id] === i}
                  style={{
                    textAlign: 'left',
                    background: answers[current.id] === i ? '#e8f0e0' : undefined,
                    border: answers[current.id] === i ? '2px solid #4a3226' : undefined,
                  }}
                  onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: i }))}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <button
                className="btn quiet"
                type="button"
                disabled={qIndex === 0}
                onClick={() => setQIndex((i) => Math.max(0, i - 1))}
              >
                Previous
              </button>
              {qIndex + 1 < questions.length ? (
                <button className="btn" type="button" onClick={() => setQIndex((i) => i + 1)}>
                  Next
                </button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  disabled={!allAnswered || submitting}
                  onClick={() => void finish()}
                >
                  {submitting ? 'Submitting…' : 'Finish'}
                </button>
              )}
              <button className="btn quiet" type="button" onClick={playAgain}>Restart quiz</button>
            </div>
            {!allAnswered && (
              <p><small>Answer every question, then Finish will send all your answers in one go.</small></p>
            )}
            <ErrorBox message={submitError} />
          </div>
        ) : null}
      </Card>

      <div style={{ marginTop: '1rem' }}>
        <Card>
          <h3 style={{ marginTop: 0 }}>Manage questions</h3>
          <p><small>Anyone in this space can add a question. You can edit or delete only your own questions.</small></p>
          <ErrorBox message={manageError} />
          {questions.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              {questions.map((q) => {
                const mine = q.authorId === me.id;
                return (
                  <div key={q.id} style={{ marginBottom: '1rem' }}>
                    <p style={{ marginBottom: '0.25rem' }}><strong>{q.question}</strong></p>
                    <p style={{ margin: '0 0 0.5rem' }}><small>{q.options.join(' · ')}</small></p>
                    {mine && editingId !== q.id && deletingId !== q.id && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <button
                          className="btn quiet"
                          type="button"
                          onClick={() => { setEditingId(q.id); setEditDraft(draftFromQuestion(q)); setEditError(null); }}
                        >
                          Edit
                        </button>
                        <button className="btn quiet" type="button" onClick={() => setDeletingId(q.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                    {mine && deletingId === q.id && (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                        <span>Delete this question?</span>
                        <button className="btn" type="button" onClick={() => void deleteQuestion(q.id)}>Yes, delete it</button>
                        <button className="btn quiet" type="button" onClick={() => setDeletingId(null)}>Keep it</button>
                      </span>
                    )}
                    {mine && editingId === q.id && (
                      <form onSubmit={(e) => void saveEdit(e, q.id)}>
                        <p><small>The correct answer is not shown here — the quiz never reveals it before submission — so please pick it again when you edit.</small></p>
                        <FormField label="Question">
                          <input
                            className="field"
                            value={editDraft.question}
                            maxLength={300}
                            onChange={(e) => setEditDraft({ ...editDraft, question: e.target.value })}
                          />
                        </FormField>
                        <FormField label="Options (mark one as correct)">
                          {optionEditor(editDraft, setEditDraft, `edit-${q.id}`)}
                        </FormField>
                        <ErrorBox message={editError} />
                        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>{' '}
                        <button className="btn quiet" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={(e) => void addQuestion(e)}>
            <h4 style={{ marginBottom: '0.5rem' }}>Add a question</h4>
            <FormField label="Question">
              <input
                className="field"
                value={draft.question}
                maxLength={300}
                placeholder="Write your question here"
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
              />
            </FormField>
            <FormField label="Options (2–6, mark one as correct)">
              {optionEditor(draft, setDraft, 'add')}
            </FormField>
            <ErrorBox message={formError} />
            <button className="btn" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add question'}</button>
          </form>

          <p style={{ marginTop: '1rem' }}>
            <button className="btn quiet" type="button" disabled={addingSamples} onClick={() => void addSamples()}>
              {addingSamples ? 'Adding samples…' : 'Use sample questions'}
            </button>
          </p>
          <p><small>Sample questions are generic examples, added as real questions you can edit or delete — not a fixed quiz.</small></p>
        </Card>
      </div>
    </div>
  );
}
