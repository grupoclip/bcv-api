// Executable entry of the `bcv-today` command (dist/cli.js).
import { EXIT_OK, EXIT_UPSTREAM, main } from "./cli.js";

main().then(
  (code) => {
    // `bcv-today mcp` keeps running on stdio until the client disconnects.
    if (code !== EXIT_OK) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`bcv-today: unexpected error: ${(err as Error)?.stack ?? String(err)}\n`);
    process.exitCode = EXIT_UPSTREAM;
  },
);
