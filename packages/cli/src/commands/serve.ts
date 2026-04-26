import { resolve } from 'node:path';
import { createHttpServer, makeHandlers, type ServerOptions } from '../server/server.ts';
import { INDEX_HTML } from '../server/ui.ts';

export interface ServeOptions {
  cwd?: string;
  configPath?: string;
  port?: number;
  host?: string;
  mock?: boolean;
  /** Override the registry root used by the Runs drawer. Defaults to `~/.rubric/runs`. */
  registryRoot?: string;
  /** Stream for human chatter; defaults to stdout. */
  write?: (line: string) => void;
  /** If set, the function resolves after the server is listening instead of blocking forever. Useful for tests. */
  returnOnListen?: boolean;
}

export interface ServeResult {
  url: string;
  close: () => Promise<void>;
}

export async function runServe(opts: ServeOptions = {}): Promise<ServeResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const port = opts.port ?? 5174;
  const host = opts.host ?? '127.0.0.1';
  const write = opts.write ?? ((line: string) => process.stdout.write(line));

  const serverOpts: ServerOptions = { cwd };
  if (opts.configPath) serverOpts.configPath = opts.configPath;
  if (opts.mock) serverOpts.mock = true;
  if (opts.registryRoot) serverOpts.registryRoot = opts.registryRoot;

  const handlers = makeHandlers(serverOpts);
  const server = createHttpServer(serverOpts, handlers, INDEX_HTML);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const url = `http://${host}:${port}`;
  write(`rubric serve: ${url}\n`);
  write(`  cwd:      ${cwd}\n`);
  if (opts.mock) write(`  mode:     mock\n`);
  write(`  press Ctrl-C to stop.\n`);

  const close = async (): Promise<void> => {
    await new Promise<void>((r) => server.close(() => r()));
  };

  if (!opts.returnOnListen) {
    // Block forever; on SIGINT the caller will invoke process.exit via the signal handler.
    await new Promise<void>(() => {});
  }

  return { url, close };
}
