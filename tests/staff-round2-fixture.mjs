import fs from "node:fs/promises";
import ts from "typescript";
import { setup, api, ids, employee } from "./evening-db-fixture.mjs";
export { ids, employee };
export async function ready() {
  const db = await setup();
  await db.exec(
    await fs.readFile(
      "supabase/migrations/20261014181643_evening_controlled_roster_setup.sql",
      "utf8",
    ),
  );
  await db.exec(
    await fs.readFile("supabase/proposals/staff-repairs.sql", "utf8"),
  );
  await db.exec(
    "create or replace function followup_private.today() returns date language sql stable as $$select '2026-10-19'::date$$",
  );
  const a = api(db);
  await a.who(ids.admin);
  return { db, a };
}
export async function grant(a, cap, user = ids.admin) {
  await a.write("capability", {
    user_id: user,
    capability: cap,
    granted: true,
    version: 0,
    reason: "Explicit synthetic round two permission",
  });
}
export async function routeModule(file, deps) {
  const source = await fs.readFile("lib/server/supabase.ts", "utf8"),
    tree = ts.createSourceFile(
      "server.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
  const wanted = new Set([
    "AppError",
    "body",
    "errorResponse",
    "json",
    "protectMutation",
  ]);
  const basics = tree.statements
    .filter(
      (n) =>
        (ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n)) &&
        wanted.has(n.name?.text),
    )
    .map((n) => n.getText(tree))
    .join("\n");
  const route = ts.createSourceFile(
    file,
    await fs.readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const sourceCode =
    "const {upstream,z,reportTable,validateSelection,ExportScheduler,ExportCapacityError}=deps;\n" +
    basics +
    `\nconst wrap=fn=>async(...args)=>{try{return await fn(...args);}catch(e){if(e.__dbStatus||e.code==='42501')throw new AppError(e.message,e.__dbStatus||403);throw e;}};const session=wrap(deps.session),rpc=wrap(deps.rpc);\n` +
    route.statements
      .filter((n) => !ts.isImportDeclaration(n))
      .map((n) => n.getText(route))
      .join("\n");
  const m = { exports: {} };
  new Function(
    "deps",
    "module",
    "exports",
    ts.transpileModule(sourceCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  )(deps, m, m.exports);
  return m.exports;
}
export const httpRequest = (
  data,
  url = "http://isolated.invalid/api/followup",
) =>
  new Request(url, {
    method: "POST",
    headers: {
      origin: "http://isolated.invalid",
      "content-type": "application/json",
      "x-hr-request": "1",
    },
    body: JSON.stringify(data),
  });
export function dbDependencies(db, a, actor) {
  return {
    session: async () => {
      await a.who(actor.current);
      return {
        token: "synthetic",
        profile: (await db.query("select public.followup_session() data"))
          .rows[0].data,
      };
    },
    rpc: async (fn, args) => {
      try {
        if (fn === "followup_session")
          return (await db.query("select public.followup_session() data"))
            .rows[0].data;
        if (fn !== "followup_read" && fn !== "followup_write")
          throw Error("Unexpected RPC");
        return fn === "followup_read"
          ? await a.read(args.p_kind, args.p_filters)
          : await a.write(args.p_kind, args.p_data, args.p_request_id);
      } catch (e) {
        Object.assign(e, {
          status:
            e.code === "42501"
              ? 403
              : ["PT409", "23505", "40001"].includes(e.code)
                ? 409
                : 400,
        });
        throw Object.assign(new Error(e.message), { __dbStatus: e.status });
      }
    },
  };
}
