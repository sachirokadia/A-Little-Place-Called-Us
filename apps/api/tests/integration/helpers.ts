import request from 'supertest';
import { prisma } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/crypto.js';

export const ORIGIN = 'http://localhost:5173';
export const app = createApp();

let counter = 0;
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.test`;
}

export async function createUserDirect(email: string, displayName = 'Test User') {
  return prisma.user.create({
    data: { email, emailLower: email, passwordHash: await hashPassword('TestPassword123'), displayName },
  });
}

export interface AuthedAgent {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  user: { id: string; email: string };
}

export async function loginAgent(email: string, password = 'TestPassword123'): Promise<AuthedAgent> {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
  const anonCsrf = (csrfRes.body as { data: { csrfToken: string } }).data.csrfToken;
  const loginRes = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', anonCsrf)
    .send({ email, password });
  if (loginRes.status !== 200) throw new Error(`login failed for ${email}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  const csrf = (loginRes.body as { data: { csrfToken: string } }).data.csrfToken;
  const user = (loginRes.body as { data: { id: string; email: string } }).data;
  return { agent, csrf, user };
}

export async function createSpaceWithMembers(displayNames: string[]): Promise<{ spaceId: string; agents: AuthedAgent[] }> {
  const agents: AuthedAgent[] = [];
  let spaceId = '';
  for (let i = 0; i < displayNames.length; i += 1) {
    const email = uniqueEmail(`space${displayNames.length}-${i}`);
    const user = await createUserDirect(email, displayNames[i]!);
    const authed = await loginAgent(email);
    agents.push(authed);
    if (i === 0) {
      const space = await prisma.space.create({ data: { name: 'Our Place', createdById: user.id } });
      await prisma.spaceMember.create({ data: { spaceId: space.id, userId: user.id, role: 'owner' } });
      spaceId = space.id;
    } else {
      await prisma.spaceMember.create({ data: { spaceId, userId: user.id, role: 'member' } });
    }
  }
  return { spaceId, agents };
}

export function authed(agent: AuthedAgent) {
  return {
    get: (url: string) => agent.agent.get(url).set('Origin', ORIGIN),
    post: (url: string, body?: unknown) => agent.agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body ?? {}),
    patch: (url: string, body?: unknown) => agent.agent.patch(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body ?? {}),
    delete: (url: string) => agent.agent.delete(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf),
  };
}

export async function cleanDb(): Promise<void> {
  await prisma.mediaDeletionJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.letter.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.appreciation.deleteMany();
  await prisma.futurePlan.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.voiceNote.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.session.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
}
