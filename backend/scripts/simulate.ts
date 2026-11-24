/** Demo traffic generator: learners in one or more tenants walking through the lab, sometimes failing.
 *  npm run simulate                                   (acme + globex)
 *  npm run simulate -- --tenant acme,globex,initech --learners 6 --interval 1500 */
import { randomUUID } from 'node:crypto';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://localhost:8080');
const TENANTS = arg('tenant', 'acme,globex').split(',').map((t) => t.trim()).filter(Boolean);
const N = Number(arg('learners', '6'));
const INTERVAL = Number(arg('interval', '1500'));
const KEY = process.env.INGEST_API_KEY ?? 'dev-ingest-key';
const labs = ['lab-bicep-basics', 'lab-bicep-modules'];
const steps = ['Create main.bicep', 'Deploy the Bicep file', 'Add parameters', 'Verify deployment', 'Refactor to modules'];
const errors = [
  'Deployment failed: InvalidTemplate - storage account name must be 3 to 24 characters',
  'Deployment failed: AuthorizationFailed - no permission on resource group',
  'az: command not found - Azure CLI is not installed',
  'Bicep build error BCP018: expected the "=" character at this location',
];

const state = TENANTS.flatMap((tenantId) =>
  Array.from({ length: N }, (_, i) => ({ tenantId, id: `learner-${i + 1}`, lab: labs[i % labs.length], step: -1 })),
);

async function post(tenantId: string, body: { type: string; labId: string; learnerId: string; step: string; message: string }) {
  const r = await fetch(`${URL_}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ tenantId, occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), ...body }),
  });
  if (!r.ok) return console.error(r.status, await r.text());
  const { instance } = (await r.json()) as { instance?: string };
  console.log(`[${tenantId}] ${body.learnerId} ${body.type} "${body.step}"  -> handled by ${instance}`);
}

async function tick() {
  const l = state[Math.floor(Math.random() * state.length)];
  const base = { labId: l.lab, learnerId: l.id };
  const roll = Math.random();
  if (l.step < 0) {
    l.step = 0;
    return post(l.tenantId, { ...base, type: 'lab.started', step: steps[0], message: 'Lab started' });
  }
  if (roll < 0.22) {
    return post(l.tenantId, { ...base, type: 'lab.error', step: steps[l.step], message: errors[Math.floor(Math.random() * errors.length)] });
  }
  if (roll < 0.26) return post(l.tenantId, { ...base, type: 'lab.timeout', step: steps[l.step], message: 'Idle for 15 minutes' });
  l.step++;
  if (l.step >= steps.length) {
    l.step = -1;
    return post(l.tenantId, { ...base, type: 'lab.completed', step: steps[steps.length - 1], message: 'Lab completed' });
  }
  return post(l.tenantId, { ...base, type: 'step.completed', step: steps[l.step - 1], message: `Completed ${steps[l.step - 1]}` });
}

console.log(`simulating ${N} learners in each of: ${TENANTS.join(', ')}  (against ${URL_})`);
setInterval(() => void tick(), INTERVAL);
