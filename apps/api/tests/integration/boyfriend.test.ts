import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { ORIGIN, authed, cleanDb, createSpaceWithMembers, type AuthedAgent } from './helpers.js';

// Boyfriend Arcade backend: quiz questions, guess rounds, chest
// riddles/solves/reward, and the photo-match / catch-hearts
// GameProgress extensions. All test data is synthetic.
function put(agent: AuthedAgent, url: string, body: unknown) {
  return agent.agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body);
}

beforeAll(async () => {
  // New tables first (helpers.cleanDb predates them and would
  // otherwise hit FK constraints on leftover rows).
  await prisma.chestSolve.deleteMany();
  await prisma.chestReward.deleteMany();
  await prisma.quizQuestion.deleteMany();
  await prisma.guessRound.deleteMany();
  await prisma.chestRiddle.deleteMany();
  await cleanDb();
});

type Pair = [AuthedAgent, AuthedAgent];
function pair(agents: AuthedAgent[]): Pair {
  return agents as unknown as Pair;
}

describe('boyfriend arcade: quiz', () => {
  it('quiz create by A / read by B never exposes correctOption', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ A', 'BQ B']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/quiz-questions`, {
      question: 'Our first date?',
      options: ['Park', 'Cafe', 'Beach'],
      correctOption: 1,
    });
    expect(created.status).toBe(201);
    expect('correctOption' in (created.body.data as object)).toBe(false);
    expect(created.body.data.question).toBe('Our first date?');
    const listed = await authed(b).get(`/api/v1/spaces/${spaceId}/quiz-questions`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect('correctOption' in listed.body.data[0]).toBe(false);
    expect(JSON.stringify(listed.body)).not.toContain('correctOption');
    // Author-only read is not an exception: A also gets no correctOption.
    const listedA = await authed(a).get(`/api/v1/spaces/${spaceId}/quiz-questions`);
    expect('correctOption' in listedA.body.data[0]).toBe(false);
  });

  it('quiz author-only edit/delete: partner gets a generic 404', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ C', 'BQ D']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/quiz-questions`, {
      question: 'Favourite food?',
      options: ['Pasta', 'Pizza'],
      correctOption: 0,
    });
    const qid = created.body.data.id as string;
    const partnerPatch = await authed(b).patch(`/api/v1/spaces/${spaceId}/quiz-questions/${qid}`, {
      question: 'Hijacked?',
    });
    expect(partnerPatch.status).toBe(404);
    expect((await authed(b).delete(`/api/v1/spaces/${spaceId}/quiz-questions/${qid}`)).status).toBe(404);
    // Row untouched, author can still edit and delete it.
    const ownPatch = await authed(a).patch(`/api/v1/spaces/${spaceId}/quiz-questions/${qid}`, {
      question: 'Favourite food, really?',
      correctOption: 1,
    });
    expect(ownPatch.status).toBe(200);
    expect(ownPatch.body.data.question).toBe('Favourite food, really?');
    expect('correctOption' in ownPatch.body.data).toBe(false);
    // Shrinking options below the stored correctOption is a 400.
    expect(
      (await authed(a).patch(`/api/v1/spaces/${spaceId}/quiz-questions/${qid}`, { options: ['Only'] })).status,
    ).toBe(400);
    expect((await authed(a).delete(`/api/v1/spaces/${spaceId}/quiz-questions/${qid}`)).status).toBe(200);
    expect((await authed(a).get(`/api/v1/spaces/${spaceId}/quiz-questions`)).body.data).toHaveLength(0);
  });

  it('quiz submission score is computed by the server; unknown question is 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ E', 'BQ F']);
    const [a, b] = pair(agents);
    const q1 = await authed(a).post(`/api/v1/spaces/${spaceId}/quiz-questions`, {
      question: 'Q1?',
      options: ['A', 'B'],
      correctOption: 0,
    });
    const q2 = await authed(a).post(`/api/v1/spaces/${spaceId}/quiz-questions`, {
      question: 'Q2?',
      options: ['A', 'B', 'C'],
      correctOption: 2,
    });
    const full = await authed(b).post(`/api/v1/spaces/${spaceId}/quiz-submissions`, {
      answers: [
        { questionId: q1.body.data.id, optionIndex: 0 },
        { questionId: q2.body.data.id, optionIndex: 2 },
      ],
    });
    expect(full.status).toBe(200);
    expect(full.body.data).toEqual({
      score: 2,
      total: 2,
      results: [
        { questionId: q1.body.data.id, correct: true },
        { questionId: q2.body.data.id, correct: true },
      ],
    });
    expect(JSON.stringify(full.body)).not.toContain('correctOption');
    const partial = await authed(b).post(`/api/v1/spaces/${spaceId}/quiz-submissions`, {
      answers: [
        { questionId: q1.body.data.id, optionIndex: 1 },
        { questionId: q2.body.data.id, optionIndex: 2 },
      ],
    });
    expect(partial.body.data.score).toBe(1);
    expect(partial.body.data.total).toBe(2);
    // Unknown question, duplicate, and out-of-range are all 400.
    expect(
      (await authed(b).post(`/api/v1/spaces/${spaceId}/quiz-submissions`, {
        answers: [{ questionId: '00000000-0000-0000-0000-000000000000', optionIndex: 0 }],
      })).status,
    ).toBe(400);
    expect(
      (await authed(b).post(`/api/v1/spaces/${spaceId}/quiz-submissions`, {
        answers: [
          { questionId: q1.body.data.id, optionIndex: 0 },
          { questionId: q1.body.data.id, optionIndex: 0 },
        ],
      })).status,
    ).toBe(400);
    expect(
      (await authed(b).post(`/api/v1/spaces/${spaceId}/quiz-submissions`, {
        answers: [{ questionId: q1.body.data.id, optionIndex: 5 }],
      })).status,
    ).toBe(400);
  });
});

describe('boyfriend arcade: guess rounds', () => {
  it('answer is masked pre-reveal, creator cannot guess own round, case-insensitive guess reveals to both, second guess rejected', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ G', 'BQ H']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/guess-rounds`, {
      question: 'My favourite colour?',
      answer: 'Teal Blue',
    });
    expect(created.status).toBe(201);
    expect('answer' in created.body.data).toBe(false);
    expect(created.body.data.status).toBe('open');
    expect(created.body.data.revealed).toBe(false);
    // Guesser list pre-reveal: no answer key at all (not null, not stars).
    const guesserList = await authed(b).get(`/api/v1/spaces/${spaceId}/guess-rounds`);
    expect(guesserList.body.data).toHaveLength(1);
    expect('answer' in guesserList.body.data[0]).toBe(false);
    expect('guessText' in guesserList.body.data[0]).toBe(false);
    expect('correct' in guesserList.body.data[0]).toBe(false);
    // Creator list pre-reveal DOES include the answer.
    const creatorList = await authed(a).get(`/api/v1/spaces/${spaceId}/guess-rounds`);
    expect(creatorList.body.data[0].answer).toBe('Teal Blue');
    // Creator guessing own round is rejected.
    const rid = created.body.data.id as string;
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/guess-rounds/${rid}/guess`, { guess: 'Teal Blue' })).status).toBe(400);
    // Case-insensitive correct guess reveals.
    const revealed = await authed(b).post(`/api/v1/spaces/${spaceId}/guess-rounds/${rid}/guess`, { guess: '  teal blue ' });
    expect(revealed.status).toBe(200);
    expect(revealed.body.data.answer).toBe('Teal Blue');
    expect(revealed.body.data.correct).toBe(true);
    expect(revealed.body.data.revealed).toBe(true);
    expect(revealed.body.data.guessText).toBe('  teal blue ');
    // Second guess (one guess total) is rejected.
    expect((await authed(b).post(`/api/v1/spaces/${spaceId}/guess-rounds/${rid}/guess`, { guess: 'Red' })).status).toBe(400);
    // After reveal, both members see the answer in the list.
    for (const agent of [a, b]) {
      const list = await authed(agent).get(`/api/v1/spaces/${spaceId}/guess-rounds`);
      expect(list.body.data[0].answer).toBe('Teal Blue');
      expect(list.body.data[0].correct).toBe(true);
      expect(list.body.data[0].guessText).toBe('  teal blue ');
    }
  });

  it('a wrong guess still reveals (with correct:false) and counts as the one guess', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ I', 'BQ J']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/guess-rounds`, {
      question: 'My pet name?',
      answer: 'Bunny',
    });
    const rid = created.body.data.id as string;
    const res = await authed(b).post(`/api/v1/spaces/${spaceId}/guess-rounds/${rid}/guess`, { guess: 'Kitty' });
    expect(res.status).toBe(200);
    expect(res.body.data.correct).toBe(false);
    expect(res.body.data.answer).toBe('Bunny');
    expect((await authed(b).post(`/api/v1/spaces/${spaceId}/guess-rounds/${rid}/guess`, { guess: 'Bunny' })).status).toBe(400);
  });
});

describe('boyfriend arcade: chest', () => {
  async function seedRiddles(spaceId: string, agent: AuthedAgent) {
    const r1 = await authed(agent).post(`/api/v1/spaces/${spaceId}/chest-riddles`, {
      question: 'First?',
      answer: 'One',
    });
    const r2 = await authed(agent).post(`/api/v1/spaces/${spaceId}/chest-riddles`, {
      question: 'Second?',
      answer: 'Two',
    });
    const r3 = await authed(agent).post(`/api/v1/spaces/${spaceId}/chest-riddles`, {
      question: 'Third?',
      answer: 'Three',
      sortOrder: 10,
    });
    return [r1.body.data, r2.body.data, r3.body.data] as { id: string; sortOrder: number }[];
  }

  it('riddles are masked in GET, sortOrder defaults to max+1, author-only edit/delete', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ K', 'BQ L']);
    const [a, b] = pair(agents);
    const [r1, r2, r3] = await seedRiddles(spaceId, a);
    expect(r1.sortOrder).toBe(0);
    expect(r2.sortOrder).toBe(1);
    expect(r3.sortOrder).toBe(10);
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/chest-riddles`);
    expect(list.body.data.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([0, 1, 10]);
    for (const row of list.body.data) expect('answer' in row).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('One');
    expect((await authed(b).patch(`/api/v1/spaces/${spaceId}/chest-riddles/${r1.id}`, { hint: 'nope' })).status).toBe(404);
    expect((await authed(b).delete(`/api/v1/spaces/${spaceId}/chest-riddles/${r1.id}`)).status).toBe(404);
    const patched = await authed(a).patch(`/api/v1/spaces/${spaceId}/chest-riddles/${r1.id}`, { hint: 'Starts with O' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.hint).toBe('Starts with O');
    expect('answer' in patched.body.data).toBe(false);
  });

  it('out-of-order attempt rejected, wrong guess no penalty, solve in order unlocks, relock clears only the caller', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ M', 'BQ N']);
    const [a, b] = pair(agents);
    const [r1, r2, r3] = await seedRiddles(spaceId, a);
    const base = `/api/v1/spaces/${spaceId}`;
    // Out of order: second riddle before the first is solved.
    expect((await authed(b).post(`${base}/chest-riddles/${r2.id}/attempt`, { guess: 'Two' })).status).toBe(400);
    // Wrong guess on the first riddle: no penalty, count unchanged.
    const wrong = await authed(b).post(`${base}/chest-riddles/${r1.id}/attempt`, { guess: 'Nope' });
    expect(wrong.body.data).toEqual({ correct: false, solvedCount: 0, totalCount: 3, unlocked: false });
    // Solve in order (case-insensitive), re-attempt is idempotent.
    const s1 = await authed(b).post(`${base}/chest-riddles/${r1.id}/attempt`, { guess: ' one ' });
    expect(s1.body.data).toEqual({ correct: true, solvedCount: 1, totalCount: 3, unlocked: false });
    const s1again = await authed(b).post(`${base}/chest-riddles/${r1.id}/attempt`, { guess: 'ONE' });
    expect(s1again.body.data.solvedCount).toBe(1);
    expect(s1again.body.data.correct).toBe(true);
    await authed(b).post(`${base}/chest-riddles/${r2.id}/attempt`, { guess: 'two' });
    const s3 = await authed(b).post(`${base}/chest-riddles/${r3.id}/attempt`, { guess: 'THREE' });
    expect(s3.body.data).toEqual({ correct: true, solvedCount: 3, totalCount: 3, unlocked: true });
    const state = await authed(b).get(`${base}/chest-state`);
    expect(state.body.data.unlocked).toBe(true);
    expect(state.body.data.totalCount).toBe(3);
    expect(state.body.data.solvedRiddleIds).toHaveLength(3);
    // Partner's state is independent: A has solved nothing.
    expect((await authed(a).get(`${base}/chest-state`)).body.data.solvedRiddleIds).toHaveLength(0);
    // Relock clears only the caller's solves, not riddles or reward.
    const relock = await authed(b).post(`${base}/chest-relock`, {});
    expect(relock.body.data).toEqual({ relocked: true });
    expect((await authed(b).get(`${base}/chest-state`)).body.data.solvedRiddleIds).toHaveLength(0);
    expect((await authed(b).get(`${base}/chest-riddles`)).body.data).toHaveLength(3);
  });

  it('reward with a real memory returns its title; bogus or other-space memory is 400; empty reward by default', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ O', 'BQ P']);
    const [a, b] = pair(agents);
    const base = `/api/v1/spaces/${spaceId}`;
    expect((await authed(a).get(`${base}/chest-reward`)).body.data).toEqual({
      message: '',
      memoryId: null,
      memoryTitle: null,
    });
    const memory = await prisma.memory.create({
      data: { spaceId, authorId: a.user.id, title: 'Our Polaroid' },
    });
    // Either member may set the shared reward.
    const set = await put(b, `${base}/chest-reward`, { message: 'You found it!', memoryId: memory.id });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ message: 'You found it!', memoryId: memory.id, memoryTitle: 'Our Polaroid' });
    expect((await authed(a).get(`${base}/chest-reward`)).body.data.memoryTitle).toBe('Our Polaroid');
    // Bogus memory id is 400.
    expect((await put(a, `${base}/chest-reward`, { message: 'x', memoryId: '00000000-0000-0000-0000-000000000000' })).status).toBe(400);
    // Other-space memory is 400 (and never leaked).
    const { spaceId: otherSpace, agents: otherAgents } = await createSpaceWithMembers(['BQ Q']);
    const [other] = otherAgents as [AuthedAgent];
    const otherMemory = await prisma.memory.create({
      data: { spaceId: otherSpace, authorId: other.user.id, title: 'Not Yours' },
    });
    const cross = await put(a, `${base}/chest-reward`, { message: 'x', memoryId: otherMemory.id });
    expect(cross.status).toBe(400);
    expect(JSON.stringify(cross.body)).not.toContain('Not Yours');
    // Reward still intact after the failed puts.
    expect((await authed(a).get(`${base}/chest-reward`)).body.data.memoryTitle).toBe('Our Polaroid');
    // Message-only reward and over-long message.
    expect((await put(a, `${base}/chest-reward`, { message: 'Just words', memoryId: null })).body.data).toEqual({
      message: 'Just words',
      memoryId: null,
      memoryTitle: null,
    });
    expect((await put(a, `${base}/chest-reward`, { message: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('non-member gets a generic 404 on boyfriend routes', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ R', 'BQ S']);
    const [a] = pair(agents);
    const { agents: outsiders } = await createSpaceWithMembers(['BQ Out']);
    const [outsider] = outsiders as [AuthedAgent];
    await authed(a).post(`/api/v1/spaces/${spaceId}/quiz-questions`, {
      question: 'Q?',
      options: ['A', 'B'],
      correctOption: 0,
    });
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/quiz-questions`)).status).toBe(404);
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/chest-state`)).status).toBe(404);
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/chest-reward`)).status).toBe(404);
  });
});

describe('boyfriend arcade: game progress extensions', () => {
  it('photo-match win with moves < pairs is 400; valid win saves', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ T', 'BQ U']);
    const [a] = pair(agents);
    const url = `/api/v1/spaces/${spaceId}/game-progress/photo-match`;
    expect((await put(a, url, { progress: { lastMoves: 3, lastPairs: 4 } })).status).toBe(400);
    expect((await put(a, url, { progress: { lastMoves: 5 } })).status).toBe(400);
    expect((await put(a, url, { progress: { lastMoves: 10, lastPairs: 5 } })).status).toBe(400);
    expect((await put(a, url, { progress: { lastMoves: 10, lastPairs: 4, bestMoves: 3 } })).status).toBe(400);
    expect((await put(a, url, { progress: {} })).status).toBe(400);
    const ok = await put(a, url, { progress: { completedGames: 2, lastMoves: 12, lastPairs: 4, lastSeconds: 90, bestMoves: 10 } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.progress).toEqual({ completedGames: 2, lastMoves: 12, lastPairs: 4, lastSeconds: 90, bestMoves: 10 });
  });

  it('catch-hearts: 61 and negative rejected; duplicate runId is 409; a new runId is accepted', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['BQ V', 'BQ W']);
    const [a] = pair(agents);
    const url = `/api/v1/spaces/${spaceId}/game-progress/catch-hearts`;
    expect((await put(a, url, { progress: { lastScore: 61 } })).status).toBe(400);
    expect((await put(a, url, { progress: { lastScore: -1 } })).status).toBe(400);
    expect((await put(a, url, { progress: { bestScore: 61 } })).status).toBe(400);
    const first = await put(a, url, { progress: { gamesPlayed: 1, lastScore: 42, bestScore: 42, runId: 'run-1' } });
    expect(first.status).toBe(200);
    const dup = await put(a, url, { progress: { gamesPlayed: 2, lastScore: 50, bestScore: 50, runId: 'run-1' } });
    expect(dup.status).toBe(409);
    // Stored row unchanged by the rejected replay.
    expect((await authed(a).get(url)).body.data.progress.lastScore).toBe(42);
    const next = await put(a, url, { progress: { gamesPlayed: 2, lastScore: 50, bestScore: 50, runId: 'run-2' } });
    expect(next.status).toBe(200);
    expect(next.body.data.progress.runId).toBe('run-2');
    // The guard is catch-hearts only: replaying a memory-match save is fine.
    const memUrl = `/api/v1/spaces/${spaceId}/game-progress/memory-match`;
    expect((await put(a, memUrl, { progress: { completedGames: 1 } })).status).toBe(200);
    expect((await put(a, memUrl, { progress: { completedGames: 1 } })).status).toBe(200);
  });
});
