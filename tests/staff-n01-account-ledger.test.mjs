import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { z } from "zod";
import { setup, api, ids } from "./evening-db-fixture.mjs";
import {
  routeModule,
  dbDependencies,
  httpRequest,
} from "./staff-round2-fixture.mjs";

async function ready() {
  const db = await setup();
  await db.exec(
    await fs.readFile(
      "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
      "utf8",
    ),
  );
  await db.exec(
    await fs.readFile(
      process.env.FANU_N01_PROPOSAL || "supabase/proposals/staff-repairs.sql",
      "utf8",
    ),
  );
  await db.exec(
    "create or replace function followup_private.today() returns date language sql stable as $$select '2026-10-21'::date$$",
  );
  const a = api(db);
  await a.who(ids.admin);
  return { db, a };
}

const metadata = (email) => ({
  name: "Synthetic N01 account",
  email,
  role: "VIEWER",
  departments: [],
  reason: "Explicit isolated N01 account decision",
});

test("N01 completion proof persists configured and removes the completed request from the pending-email guard", async () => {
  const { db, a } = await ready();
  try {
    const id = crypto.randomUUID(),
      p = metadata("n01-ledger@candidate.invalid");
    await a.write("account_creation_begin", p, id);
    await a.write(
      "account_creation_result",
      { state: "created", user_id: ids.viewer },
      id,
    );
    await a.write(
      "account",
      {
        user_id: ids.viewer,
        role: p.role,
        active: true,
        departments: p.departments,
        reason: p.reason,
        version: 1,
      },
      id,
    );
    const proof = await a.read("account_creation", { request_id: id });
    assert.equal(proof.state, "configured");
    await db.exec("reset role");
    const stored = (
      await db.query(
        "select state,updated_at from fu_account_creations where user_id=$1 and request_id=$2",
        [ids.admin, id],
      )
    ).rows[0];
    assert.equal(
      stored.state,
      "configured",
      "read=configured must agree with the durable ledger state",
    );
    await a.who(ids.admin);
    const again = await a.write("account_creation_begin", p, id);
    assert.equal(again.start, false);
    assert.equal(again.state, "configured");
    assert.equal(again.user_id, ids.viewer);
    const next = await a.write("account_creation_begin", p);
    assert.equal(
      next.start,
      true,
      "A proven completed request must not masquerade as an unresolved request for the email",
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select state,updated_at from fu_account_creations where user_id=$1 and request_id=$2",
          [ids.admin, id],
        )
      ).rows[0].updated_at.getTime(),
      stored.updated_at.getTime(),
      "Exact completed replay does not rewrite the completion timestamp",
    );
  } finally {
    await db.close();
  }
});

test("N01 fresh same-email API request means duplicate account, while exact replay, unknown requests, lost completion read and partial setup remain safe", async () => {
  const { db, a } = await ready(),
    actor = { current: ids.admin },
    provider = new Map();
  let providerCalls = 0,
    mode = "success",
    failAccount = false,
    failCompletionRead = false;
  try {
    const deps = dbDependencies(db, a, actor),
      originalRpc = deps.rpc;
    deps.z = z;
    deps.rpc = async (fn, args) => {
      if (args.p_kind === "account" && failAccount) {
        failAccount = false;
        throw Object.assign(Error("Synthetic partial account configuration"), {
          __dbStatus: 503,
        });
      }
      if (args.p_kind === "account_creation" && failCompletionRead) {
        failCompletionRead = false;
        throw Object.assign(Error("Synthetic lost final proof read"), {
          __dbStatus: 503,
        });
      }
      const result = await originalRpc(fn, args);
      if (args.p_kind === "account" && mode === "lost-proof")
        failCompletionRead = true;
      return result;
    };
    deps.upstream = async (url, options = {}) => {
      if (options.method === "POST") {
        providerCalls++;
        const input = JSON.parse(options.body);
        if ([...provider.values()].some((u) => u.email === input.email))
          return {
            response: new Response(null, { status: 409 }),
            data: { code: "email_exists" },
          };
        if (mode === "lost-before")
          throw Error("Synthetic network lost before provider creation");
        const user = { id: crypto.randomUUID(), email: input.email };
        provider.set(user.id, user);
        await db.exec("reset role");
        await db.query(
          "insert into profiles(id,name,email,role,is_active) values($1,$2,$3,'VIEWER',true)",
          [user.id, input.user_metadata.name, user.email],
        );
        await a.who(actor.current);
        if (mode === "lost-after")
          throw Error("Synthetic provider created user but response was lost");
        return { response: new Response(null, { status: 200 }), data: user };
      }
      if (url.includes("?"))
        return {
          response: new Response(null, { status: 200 }),
          data: { users: [...provider.values()] },
        };
      const user = provider.get(url.split("/").at(-1));
      return {
        response: new Response(null, { status: user ? 200 : 404 }),
        data: user || {},
      };
    };
    const route = await routeModule("app/api/users/route.ts", deps);
    const post = async (data) => {
      const response = await route.POST(
        httpRequest(data, "http://isolated.invalid/api/users"),
      );
      return { status: response.status, data: await response.json() };
    };
    const get = async (id) => {
      const response = await route.GET(
        new Request("http://isolated.invalid/api/users?request_id=" + id),
      );
      return { status: response.status, data: await response.json() };
    };
    const stored = async (id) => {
      await db.exec("reset role");
      const row = (
        await db.query(
          "select state,created_user_id from fu_account_creations where user_id=$1 and request_id=$2",
          [ids.admin, id],
        )
      ).rows[0];
      await a.who(ids.admin);
      return row;
    };
    const input = (email) => ({
      ...metadata(email),
      password: "Synthetic-N01-Password!",
      request_id: crypto.randomUUID(),
    });
    const assertDuplicate = async (original) => {
      const fresh = { ...original, request_id: crypto.randomUUID() },
        priorCalls = providerCalls;
      const result = await post(fresh);
      assert.equal(result.status, 409);
      assert.match(
        result.data.error,
        /الحساب موجود بالفعل/,
        "409 must explain a duplicate account, not a supposedly pending completed request",
      );
      assert.doesNotMatch(result.data.error, /طلب سابق.*يحتاج استكمال/);
      assert.equal((await stored(fresh.request_id)).state, "duplicate");
      assert.equal((await stored(original.request_id)).state, "configured");
      assert.equal(
        providerCalls,
        priorCalls + 1,
        "Only the fresh claim reaches the provider's duplicate check",
      );
    };

    const success = input("n01-success@candidate.invalid");
    assert.equal((await post(success)).status, 200);
    const completedCalls = providerCalls;
    assert.equal((await post(success)).status, 200);
    assert.equal(
      providerCalls,
      completedCalls,
      "Exact completed replay must not call provider create again",
    );
    await assertDuplicate(success);

    mode = "lost-before";
    const unknown = input("n01-unknown@candidate.invalid");
    assert.ok(
      (await post(unknown)).status >= 500,
      "A lost provider transport must not claim a successful or definitive rejected creation",
    );
    assert.equal((await stored(unknown.request_id)).state, "unknown");
    const unknownCalls = providerCalls;
    assert.equal((await post(unknown)).status, 503);
    const blocked = await post({ ...unknown, request_id: crypto.randomUUID() });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /طلب سابق لهذا البريد يحتاج استكمال/);
    assert.equal(
      providerCalls,
      unknownCalls,
      "Neither same-request nor fresh-email claim may repeat an unresolved provider attempt",
    );
    assert.equal((await stored(unknown.request_id)).state, "unknown");

    mode = "success";
    failAccount = true;
    const partial = input("n01-partial@candidate.invalid");
    assert.equal((await post(partial)).status, 409);
    assert.equal((await stored(partial.request_id)).state, "created");
    const partialCalls = providerCalls;
    assert.equal((await post(partial)).status, 503);
    assert.equal(providerCalls, partialCalls);
    const partialProof = await get(partial.request_id);
    assert.equal(
      (
        await post({
          recovery_request_id: partial.request_id,
          user_id: partialProof.data.found_user_id,
        })
      ).status,
      200,
    );
    assert.equal((await stored(partial.request_id)).state, "configured");
    assert.equal(providerCalls, partialCalls);

    mode = "lost-proof";
    const lostProof = input("n01-lost-proof@candidate.invalid");
    assert.equal((await post(lostProof)).status, 409);
    assert.equal(
      (await stored(lostProof.request_id)).state,
      "created",
      "The proof-read loss leaves a durable claim even though account configuration committed",
    );
    mode = "success";
    await assertDuplicate(lostProof);

    mode = "lost-after";
    const lostReply = input("n01-lost-provider-reply@candidate.invalid");
    assert.ok(
      (await post(lostReply)).status >= 500,
      "A lost provider reply remains uncertain",
    );
    assert.equal((await stored(lostReply.request_id)).state, "unknown");
    const lostReplyCalls = providerCalls;
    assert.equal((await post(lostReply)).status, 503);
    const found = await get(lostReply.request_id);
    assert.ok(found.data.found_user_id);
    mode = "success";
    assert.equal(
      (
        await post({
          recovery_request_id: lostReply.request_id,
          user_id: found.data.found_user_id,
        })
      ).status,
      200,
    );
    assert.equal((await stored(lostReply.request_id)).state, "configured");
    assert.equal(providerCalls, lostReplyCalls);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from fu_account_creations where payload ? 'password'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
