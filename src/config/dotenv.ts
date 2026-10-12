import { existsSync } from "node:fs";
import { join } from "node:path";

export function loadDotenvIfPresent(dir: string): boolean {
  const path = join(dir, ".env");
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}
