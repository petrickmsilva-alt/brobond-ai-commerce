#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_ORIGIN = "https://brobond-ai-commerce.onrender.com";
const requestedOrigin = process.argv[2] ?? DEFAULT_ORIGIN;

let origin;
try {
  origin = new URL(requestedOrigin);
} catch {
  fail(`Origem inválida: ${requestedOrigin}`);
}

if (origin.protocol !== "https:") {
  fail(`A propriedade do TikTok precisa usar HTTPS: ${origin.href}`);
}
if (origin.pathname !== "/" || origin.search || origin.hash) {
  fail(`Informe somente a origem, sem caminho: ${origin.origin}`);
}

const publicDirectory = resolve(process.cwd(), "public");
const signatureFileNames = (await readdir(publicDirectory)).filter((name) =>
  /^tiktok(?!-developers-site-verification)[A-Za-z0-9_-]+\.txt$/.test(name),
);

if (signatureFileNames.length !== 1) {
  fail(
    `Esperava um único arquivo TikTok canônico em public/, encontrei ${signatureFileNames.length}: ${signatureFileNames.join(", ") || "nenhum"}`,
  );
}

const signatureFileName = signatureFileNames[0];
const expectedBody = await readFile(resolve(publicDirectory, signatureFileName));
const expectedText = expectedBody.toString("utf8");

if (!/^tiktok-developers-site-verification=[A-Za-z0-9_-]+$/.test(expectedText)) {
  fail(`${signatureFileName} não contém um token TikTok válido e isolado.`);
}

const checks = [
  {
    label: "prefixo raiz",
    url: `${origin.origin}/`,
    contentType: "text/html",
  },
  {
    label: "arquivo de assinatura",
    url: `${origin.origin}/${signatureFileName}`,
    contentType: "text/plain",
    expectedBody,
  },
  {
    label: "Termos de Serviço (URL cadastrada)",
    url: `${origin.origin}/terms-of-service/`,
    contentType: "text/html",
  },
  {
    label: "Política de Privacidade (URL cadastrada)",
    url: `${origin.origin}/privacy-policy/`,
    contentType: "text/html",
  },
];

console.log(`Verificando a propriedade TikTok Production URL prefix: ${origin.origin}/`);
console.log(`Artefato local: public/${signatureFileName}`);

for (const check of checks) {
  let response;
  try {
    response = await fetch(check.url, {
      redirect: "manual",
      headers: {
        accept: "*/*",
        "user-agent": "TikTok-URL-Property-Preflight/1.0",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    fail(`${check.label}: não foi possível acessar ${check.url}\n${String(error)}`);
  }

  if (response.status >= 300 && response.status < 400) {
    fail(
      `${check.label}: ${response.status} redireciona para ${response.headers.get("location") ?? "destino desconhecido"}. O TikTok não segue HTTP 3xx.`,
    );
  }
  if (response.status !== 200) {
    fail(`${check.label}: esperava HTTP 200 em ${check.url}, recebeu ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith(check.contentType)) {
    fail(
      `${check.label}: Content-Type deveria começar com ${check.contentType}, recebeu ${contentType || "ausente"}.`,
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (check.expectedBody && !body.equals(check.expectedBody)) {
    fail(
      `${check.label}: o corpo publicado não é byte a byte igual a public/${signatureFileName}.`,
    );
  }

  console.log(`✓ ${check.label}: 200 ${contentType} (${body.byteLength} bytes)`);
}

console.log("\nPré-validação concluída. No TikTok, use Production → URL prefix e informe:");
console.log(`${origin.origin}/`);
console.log("Não abra uma nova propriedade para /terms-of-service/ ou /privacy-policy/.");

function fail(message) {
  console.error(`\nERRO: ${message}`);
  process.exit(1);
}
