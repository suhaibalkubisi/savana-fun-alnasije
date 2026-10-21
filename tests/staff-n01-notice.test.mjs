import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

test("N01 a new duplicate or unknown error clears prior success notice while clearing an error preserves the current notice", () => {
  const relative = "components/followup/app.tsx";
  const file = process.env.FANU_TEST_BEFORE
    ? path.join(process.env.FANU_TEST_BEFORE, relative)
    : relative;
  const tree = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  const walk = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "fail" &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(tree) === "useCallback"
    )
      callback = node.initializer.arguments[0];
    ts.forEachChild(node, walk);
  };
  walk(tree);
  assert.ok(callback, "Extract the application's actual fail callback");
  const compiled = ts.transpileModule(
    "module.exports=" + callback.getText(tree),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const h = { error: "", notice: "ثبت اكتمال الحساب. يمكنك بدء طلب حساب آخر." },
    m = { exports: {} };
  new Function("setError", "setNotice", "module", compiled)(
    (value) => (h.error = value),
    (value) => (h.notice = value),
    m,
  );
  for (const error of [
    "الحساب موجود بالفعل. لم يُنشأ حساب بديل.",
    "نتيجة الإنشاء غير محسومة؛ تحقق من الطلب المحفوظ.",
  ]) {
    h.notice = "ثبت اكتمال الحساب. يمكنك بدء طلب حساب آخر.";
    m.exports(error);
    assert.equal(h.error, error);
    assert.equal(
      h.notice,
      "",
      "The current failed or unknown attempt must not retain an earlier account's success status",
    );
  }
  h.notice = "نتيجة موثقة تخص العملية الحالية";
  m.exports("");
  assert.equal(h.error, "");
  assert.equal(
    h.notice,
    "نتيجة موثقة تخص العملية الحالية",
    "Clearing an old error is not a new failure and must not discard the current notice",
  );
});
