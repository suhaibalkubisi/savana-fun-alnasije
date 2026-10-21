import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the real transport with synthetic configuration and a mocked fetch.
// No request reaches Supabase, auth or a production database.
const file = new URL('./.followup-conflict-transport-check.mjs', import.meta.url);
let source = await readFile(new URL('../lib/server/supabase.ts', import.meta.url), 'utf8');
source = source
  .replace('import "server-only";', '')
  .replace('import { cookies } from "next/headers";', 'const cookies=async()=>{throw Error("Unexpected session access");};')
  .replace('import { env } from "cloudflare:workers";', 'const env={NEXT_PUBLIC_SUPABASE_URL:"https://synthetic.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_synthetic",SUPABASE_SECRET_KEY:""};')
  .replace('./supabase-connection.mjs', '../lib/server/supabase-connection.mjs');
await writeFile(file, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const { rpc, errorResponse, AppError } = await import(file.href);
after(() => rm(file, { force: true }));

async function withFetch(responder, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

async function failedRpc(payload) {
  try {
    await rpc('followup_write', payload, 'synthetic.user.jwt');
    assert.fail('The rejected mutation must not return success');
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
}

test('PostgREST PT409 becomes an HTTP 409 with the conflict message and one RPC attempt', async () => {
  const message = 'تغير التصريح. أعد تحميل البيانات';
  const payload = { kind: 'submit', data: { id: 'synthetic-report', version: 2 }, request_id: 'synthetic-request' };
  await withFetch(() => Response.json({ code: 'PT409', message, details: null, hint: null }, { status: 409 }), async calls => {
    const error = await failedRpc(payload);
    assert.equal(error.status, 409);
    const response = errorResponse(error);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(calls.length, 1, 'A stale version is deterministic and must not be retried');
    assert.equal(calls[0].url, 'https://synthetic.supabase.co/rest/v1/rpc/followup_write');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);
    assert.equal(new Headers(calls[0].options.headers).get('authorization'), 'Bearer synthetic.user.jwt');
  });
});

test('a genuine or legacy SQLSTATE 40001 remains an HTTP 409 without an application RPC retry', async () => {
  await withFetch(() => Response.json({ code: '40001', message: 'could not serialize access due to concurrent update' }, { status: 500 }), async calls => {
    const error = await failedRpc({ kind: 'save', data: { version: 2 } });
    assert.equal(error.status, 409);
    const response = errorResponse(error);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'تعذر الاتصال بقاعدة البيانات' });
    assert.equal(calls.length, 1, 'Transport forwards the conflict instead of replaying the mutation');
  });
});

test('an upstream server failure does not automatically replay a mutation', async () => {
  await withFetch(() => Response.json({ message: 'Synthetic upstream failure' }, { status: 503 }), async calls => {
    const error = await failedRpc({ kind: 'submit', data: { version: 2 } });
    const response = errorResponse(error);
    assert.equal(response.ok, false);
    assert.deepEqual(await response.json(), { error: 'تعذر الاتصال بقاعدة البيانات' });
    assert.equal(calls.length, 1, 'Even a transient response must not cause an application-level mutation retry');
  });
});

test('a lost RPC response returns an uncertain-result error after exactly one request', async () => {
  await withFetch(() => { throw new TypeError('Synthetic disconnected transport'); }, async calls => {
    const error = await failedRpc({ kind: 'submit', data: { version: 2 } });
    const response = errorResponse(error);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'لم تصل نتيجة العملية. تحقق من السجل قبل إعادة المحاولة' });
    assert.equal(calls.length, 1, 'The write may have committed before disconnecting; do not replay it automatically');
  });
});
