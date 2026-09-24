import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  currentImport,
  importActionVersion,
} from "../lib/hr/import-workflow.mjs";

async function fixture(run) {
  const db = new PGlite();
  const ids = {
    admin: "11111111-1111-4111-8111-111111111111",
    hr: "22222222-2222-4222-8222-222222222222",
    viewer: "33333333-3333-4333-8333-333333333333",
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    for (const name of (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec("set hr.test_fixture='on'");
    await db.exec(await readFile("supabase/seed.sql", "utf8"));
    for (const [role, id] of Object.entries(ids)) {
      await db.query("insert into auth.users values($1,$2,'{}')", [
        id,
        `${role}@example.invalid`,
      ]);
      await db.query(
        "update public.profiles set role=$1,is_active=true where id=$2",
        [role.toUpperCase(), id],
      );
    }
    const who = async (role) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        ids[role],
      ]);
      await db.exec("set role authenticated");
    };
    const read = async (kind, filters = {}) =>
      (
        await db.query("select public.attendance_read_v3($1,$2) data", [
          kind,
          filters,
        ])
      ).rows[0].data;
    const write = async (action, data) =>
      (
        await db.query("select public.attendance_write_v3($1,$2) data", [
          action,
          data,
        ])
      ).rows[0].data;
    const hr = async (action, data) =>
      (await db.query("select public.hr_write_v2($1,$2) data", [action, data]))
        .rows[0].data;
    const resolve = async (issue, employee_id) =>
      (
        await db.query("select public.attendance_identity_resolve($1) data", [
          {
            id: issue.id,
            version: issue.version,
            group_token: issue.group_token,
            employee_id,
            resolution_note: "Synthetic identity verification",
          },
        ])
      ).rows[0].data;
    const people = (
      await db.query("select * from public.employees order by id")
    ).rows;
    const payload = {
      source_name: "synthetic-review.xls",
      source_hash: "a".repeat(64),
      import_kind: "monthly",
      period_start: "2099-01-01",
      period_end: "2099-01-31",
      rows: [1, 2, 3].map((d) => ({
        source_sheet: "Punch Record",
        source_row: 2,
        calendar_date: `2099-01-0${d}`,
        person_code: "UNKNOWN-REVIEW",
        source_name: "هوية اصطناعية غير مطابقة",
        raw_values: [
          "original synthetic evidence",
          d === 3 ? "" : "01:00\n16:00",
        ],
        punch_minutes: d === 3 ? [] : [60, 960],
        invalid: false,
      })),
    };
    const groups = async (id) =>
      (await read("issues", { import_id: id, group_identities: "true" })).rows;
    await who("admin");
    await run({
      db,
      who,
      read,
      write,
      hr,
      resolve,
      people,
      payload,
      groups,
      ids,
    });
  } finally {
    await db.close();
  }
}

test("reopened reviewed imports keep lifecycle and cancellation uses the batch revision", () =>
  fixture(async ({ write, read, people, payload }) => {
    const person = people[0];
    const p = {
      ...payload,
      rows: payload.rows.map((r) => ({
        ...r,
        person_code: person.employee_number,
        source_name: person.name,
      })),
    };
    const b = await write("import.preview", p);
    const reviewed = await write("import.review", {
      id: b.id,
      version: b.lifecycle_version,
    });
    const reopened = (await read("import", { id: b.id })).batch;
    assert.equal(reopened.lifecycle_state, "reviewed");
    assert.equal(reopened.lifecycle_version, reviewed.lifecycle_version);
    await write("import.cancel", {
      id: b.id,
      version: importActionVersion(reopened, "cancel"),
    });
    assert.equal(
      (await read("import", { id: b.id })).batch.lifecycle_state,
      "cancelled",
    );
  }));

test("monthly identity journey resolves related days explicitly, keeps evidence, reviews, approves and rejects repeats", () =>
  fixture(async ({ db, write, read, resolve, people, payload, groups }) => {
    const b = await write("import.preview", payload);
    const list = await groups(b.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].related_open_count, 3);
    await assert.rejects(
      write("import.review", { id: b.id, version: b.lifecycle_version }),
      /مشاكل/,
    );
    const before = (await read("import", { id: b.id })).rows;
    const answer = await resolve(list[0], people[0].id);
    assert.equal(answer.resolved_issues, 3);
    await assert.rejects(resolve(list[0], people[0].id), /تعديل|تغيرت/);
    const reopened = await read("import", { id: b.id });
    assert.equal(reopened.batch.lifecycle_state, "preview");
    assert.equal(reopened.review_summary.open_issues, 0);
    assert.equal(reopened.review_summary.matched_identities, 1);
    assert.deepEqual(
      reopened.rows.map((r) => [
        r.raw_values,
        r.punch_minutes,
        r.calendar_date,
      ]),
      before.map((r) => [r.raw_values, r.punch_minutes, r.calendar_date]),
    );
    const r = await write("import.review", {
      id: b.id,
      version: reopened.batch.lifecycle_version,
    });
    await write("import.approve", { id: b.id, version: r.lifecycle_version });
    assert.equal(
      (await read("import", { id: b.id })).batch.lifecycle_state,
      "approved",
    );
    await assert.rejects(
      write("import.approve", { id: b.id, version: r.lifecycle_version }),
      /تغيير|المراجعة/,
    );
    const duplicate = await write("import.preview", payload);
    assert.equal(duplicate.id, b.id);
    assert.equal(duplicate.duplicate, true);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.fingerprint_identities",
        )
      ).rows[0].n,
      1,
    );
  }));

test("identity matching never propagates to a different import, same-code different name or invalid row", () =>
  fixture(async ({ write, read, resolve, people, payload, groups }) => {
    const b = await write("import.preview", {
      ...payload,
      rows: [
        ...payload.rows,
        {
          ...payload.rows[0],
          source_row: 3,
          source_name: "هوية اصطناعية أخرى",
        },
        { ...payload.rows[0], source_row: 4, invalid: true },
      ],
    });
    const other = await write("import.preview", {
      ...payload,
      source_hash: "b".repeat(64),
    });
    const list = await groups(b.id);
    assert.equal(list.length, 3);
    const family = list.find((r) => r.related_open_count === 3);
    await resolve(family, people[0].id);
    const a = await read("import", { id: b.id });
    assert.equal(a.review_summary.open_issues, 2);
    assert.equal(
      (await read("import", { id: other.id })).review_summary.open_issues,
      3,
    );
    await assert.rejects(
      write("import.review", { id: b.id, version: b.lifecycle_version }),
      /مشاكل/,
    );
  }));

test("stale identity group is rejected atomically without mapping the remaining days", () =>
  fixture(async ({ write, read, resolve, people, payload, groups }) => {
    const b = await write("import.preview", payload);
    const stale = (await groups(b.id))[0];
    const raw = (await read("issues", { import_id: b.id })).rows.find(
      (r) => r.id !== stale.id,
    );
    await write("issue.resolve", {
      id: raw.id,
      version: raw.version,
      state: "ignored",
      resolution_note: "Synthetic single-day exclusion",
    });
    await assert.rejects(resolve(stale, people[0].id), /تغيرت الأيام/);
    assert.equal(
      (await read("import", { id: b.id })).review_summary.matched_identities,
      0,
    );
  }));

test("identity mapping conflict is not silently overwritten and inactive employees remain selectable", () =>
  fixture(async ({ db, write, read, resolve, people, payload, groups }) => {
    const inactive = people.find((p) => p.employment_status !== "active");
    assert.ok(
      (await read("matching_employees")).some((p) => p.id === inactive.id),
    );
    const a = await write("import.preview", payload);
    await resolve((await groups(a.id))[0], inactive.id);
    // Legacy preview deliberately creates a code/name conflict for review.
    const b = await write("import.preview", {
      ...payload,
      source_hash: "c".repeat(64),
      rows: payload.rows.map((r) => ({
        ...r,
        source_name: people.find((p) => p.id !== inactive.id).name,
      })),
    });
    const group = (await groups(b.id))[0];
    assert.ok(group);
    await assert.rejects(
      resolve(group, people.find((p) => p.id !== inactive.id).id),
      /مرتبط/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select employee_id from public.fingerprint_identities where person_code=$1",
          [payload.rows[0].person_code],
        )
      ).rows[0].employee_id,
      inactive.id,
    );
  }));

test("new identity operation denies VIEWER, anonymous and direct access; HR can resolve preview", () =>
  fixture(async ({ db, who, write, resolve, people, payload, groups }) => {
    const b = await write("import.preview", payload);
    const group = (await groups(b.id))[0];
    await who("viewer");
    await assert.rejects(resolve(group, people[0].id), /صلاحية/);
    await db.exec("reset role");
    assert.deepEqual(
      (
        await db.query(
          `select has_function_privilege('anon','public.attendance_identity_resolve(jsonb)','execute') anonymous,has_function_privilege('authenticated','hr_private.identity_issues(uuid)','execute') private,has_table_privilege('authenticated','public.fingerprint_source_rows','update') direct`,
        )
      ).rows[0],
      { anonymous: false, private: false, direct: false },
    );
    await who("hr");
    assert.equal((await resolve(group, people[0].id)).resolved_issues, 3);
  }));

test("preview audit volume is batch-level while later identity decisions remain fully audited", () =>
  fixture(async ({ db, who, write, resolve, people, payload, groups }) => {
    await db.exec("reset role");
    const before = (
      await db.query("select count(*)::int n from public.audit_logs")
    ).rows[0].n;
    await who("admin");
    const b = await write("import.preview", payload);
    await db.exec("reset role");
    const after = (
      await db.query("select count(*)::int n from public.audit_logs")
    ).rows[0].n;
    assert.equal(after - before, 3);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.fingerprint_source_rows where import_id=$1",
          [b.id],
        )
      ).rows[0].n,
      3,
    );
    await who("admin");
    await resolve((await groups(b.id))[0], people[0].id);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.audit_logs where entity_type='fingerprint_issues'",
        )
      ).rows[0].n,
      3,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.audit_logs where entity_type='fingerprint_source_rows'",
        )
      ).rows[0].n,
      3,
    );
    await assert.rejects(
      db.exec("delete from public.audit_logs"),
      /immutable|حذف|تعديل/i,
    );
  }));

test("import history filters daily/monthly before limiting and returns newest 50 deterministically", () =>
  fixture(async ({ db, who, read }) => {
    await db.exec("reset role");
    await db.exec(`insert into public.attendance_imports(source_name,source_hash,import_kind,period_start,period_end,created_at)
  select 'synthetic-'||g,repeat('d',64),'daily','2099-01-01'::date+g,'2099-01-01'::date+g,'2099-01-01'::timestamptz+g*interval '1 minute' from generate_series(1,55) g;
  insert into public.attendance_imports(source_name,source_hash,import_kind,period_start,period_end) values('monthly',repeat('e',64),'monthly','2099-01-01','2099-01-31')`);
    await who("admin");
    const daily = await read("imports", { import_kind: "daily" });
    assert.equal(daily.length, 50);
    assert.equal(daily[0].source_name, "synthetic-55");
    assert.equal(daily.at(-1).source_name, "synthetic-6");
    assert.equal((await read("imports", { import_kind: "monthly" })).length, 1);
  }));

test("replacement approval rejects reopened issues and preserves the previous approved import", () =>
  fixture(async ({ db, who, write, read, people, payload }) => {
    const person = people[0];
    const p = {
      ...payload,
      rows: payload.rows.map((r) => ({
        ...r,
        person_code: person.employee_number,
        source_name: person.name,
      })),
    };
    const a = await write("import.preview", p);
    const ar = await write("import.review", {
      id: a.id,
      version: a.lifecycle_version,
    });
    await write("import.approve", { id: a.id, version: ar.lifecycle_version });
    const b = await write("import.preview", {
      ...p,
      source_hash: "f".repeat(64),
    });
    const br = await write("import.review", {
      id: b.id,
      version: b.lifecycle_version,
    });
    await db.exec("reset role");
    await db.query(
      "insert into public.fingerprint_issues(source_row_id,issue_type,details) select id,'punch_conflict','Synthetic reopened issue' from public.fingerprint_source_rows where import_id=$1 limit 1",
      [b.id],
    );
    await who("admin");
    const current = (await read("import", { id: a.id })).batch;
    await assert.rejects(
      write("import.supersede", {
        id: a.id,
        version: current.lifecycle_version,
        replacement_id: b.id,
        replacement_version: br.lifecycle_version,
      }),
      /مشاكل/,
    );
    assert.equal(
      (await read("import", { id: a.id })).batch.lifecycle_state,
      "approved",
    );
    assert.equal(
      (await read("import", { id: b.id })).batch.lifecycle_state,
      "reviewed",
    );
  }));

test("employee transfer, rename and inactive status keep UUID history and manual HR decision", () =>
  fixture(async ({ db, who, hr, people }) => {
    const deps = (
      await db.query("select public.hr_read_v3('reference','{}') data")
    ).rows[0].data.departments;
    const employee = await hr("employee.save", {
      name: "اختبار رحلة موظف",
      employee_number: "JOURNEY-001",
      department_id: deps[0].id,
      employment_status: "active",
    });
    const status = await hr("status.save", {
      employee_id: employee.id,
      department_id: deps[0].id,
      record_date: "2099-01-02",
      status_type: "absence2",
      late_minutes: null,
      notes: "Synthetic manual decision",
    });
    const edited = await hr("employee.save", {
      ...employee,
      name: "اختبار بعد النقل",
      department_id: deps[1].id,
      employment_status: "resigned",
    });
    assert.equal(edited.id, employee.id);
    const report = (
      await db.query("select public.hr_read_v3('report',$1) data", [
        { month: "2099-01", employee_id: employee.id },
      ])
    ).rows[0].data;
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].weighted, 2);
    assert.equal(report.rows[0].cells["2"], "absence2");
    await assert.rejects(
      hr("employee.save", { ...employee, name: "stale edit" }),
      /تعديل|تغيير/,
    );
    await who("viewer");
    await assert.rejects(
      hr("status.delete", {
        id: status.id,
        version: status.version,
        confirmed: true,
      }),
      /صلاحية/,
    );
    assert.ok(people.length > 0);
  }));

test("import UI uses freshest lifecycle and the correct revision domain", () => {
  const stale = { id: "a", version: 2, lifecycle_version: 1 };
  const reviewed = { ...stale, lifecycle_version: 2 };
  assert.equal(currentImport(null, reviewed), reviewed);
  assert.equal(currentImport(reviewed, stale), reviewed);
  assert.equal(currentImport(stale, reviewed), reviewed);
  assert.equal(currentImport(stale, { ...reviewed, id: "b" }), stale);
  assert.equal(importActionVersion({ ...reviewed, version: 5 }, "cancel"), 5);
  assert.equal(importActionVersion({ ...reviewed, version: 5 }, "approve"), 2);
});
