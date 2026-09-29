import { validateStartup } from "@/lib/startup";

/** One-shot gate executed by npm's prestart lifecycle before `next start`. */
async function main(): Promise<void> {
  await validateStartup({ disconnect: true });
}

void main().catch(() => {
  // validateStartup already emitted the non-secret DATABASE_NOT_READY reason.
  process.exitCode = 1;
});
