const fs = require("node:fs");
const path = require("node:path");

// Prisma 6's client engine loads this file from the generated client directory.
// Some build environments keep the embedded package asset but omit the
// materialized wasm file, which causes ENOENT on the first query.
const generatedDir = path.join(process.cwd(), "node_modules", ".prisma", "client");
const target = path.join(generatedDir, "query_compiler_bg.wasm");

if (!fs.existsSync(target)) {
  const { wasm } = require("@prisma/client/runtime/query_compiler_bg.postgresql.wasm-base64.js");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(target, Buffer.from(wasm, "base64"));
  console.log(`Materialized Prisma query compiler at ${target}`);
}
