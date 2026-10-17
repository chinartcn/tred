import { readFileSync } from 'node:fs';
import { _setStdinOverride, cliMain } from '../src/cli.js';

interface Case {
  id: string;
  args: string[];
  stdin?: string;
}

interface Result {
  id: string;
  status: number;
  stdout: string;
  stderr: string;
}

const casesFile = process.argv[2];
if (!casesFile) {
  process.stderr.write('usage: cli-worker.ts <cases.json>\n');
  process.exit(1);
}

const cases = JSON.parse(readFileSync(casesFile, "utf-8")) as Case[];

const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
const origExit = process.exit;

const results: Result[] = [];

for (const c of cases) {
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];

  process.stdout.write = ((chunk: any) => { stdoutBuf.push(String(chunk)); return true; }) as any;
  process.stderr.write = ((chunk: any) => { stderrBuf.push(String(chunk)); return true; }) as any;
  (process as any).exit = (code?: number) => { throw { __tredExit: code ?? 0 }; };

  _setStdinOverride(c.stdin);

  let exitCode = 0;
  try {
    await cliMain(c.args);
  } catch (e: any) {
    if (e && typeof e === 'object' && '__tredExit' in e) {
      exitCode = e.__tredExit;
    } else {
      stderrBuf.push('UNEXPECTED: ' + (e instanceof Error ? e.stack : String(e)));
      exitCode = 1;
    }
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    (process as any).exit = origExit;
    _setStdinOverride(undefined);
  }

  results.push({
    id: c.id,
    status: exitCode,
    stdout: stdoutBuf.join(''),
    stderr: stderrBuf.join(''),
  });
}

origOut(JSON.stringify(results, null, 2) + '\n');
