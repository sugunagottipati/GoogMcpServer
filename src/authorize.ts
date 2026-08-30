import "dotenv/config";
import { authorizeGoogle } from "./auth.js";
import { loadConfig } from "./config.js";

authorizeGoogle(loadConfig()).catch((error) => {
  process.stderr.write(`Authorization failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exit(1);
});