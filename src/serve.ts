import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

export interface ServeOptions {
  port: number;
}

export interface ServeHandle {
  url: string;
  port: number;
  close: () => void;
}

export function serveHtml(getHtml: () => string, opts: ServeOptions): Promise<ServeHandle> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }
      try {
        const html = getHtml();
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.end(html);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("tred serve error: " + (e instanceof Error ? e.message : String(e)));
      }
    });

    server.on('error', reject);
    server.listen(opts.port, () => {
      const addr = server.address();
      let actualPort = opts.port;
      if (addr && typeof addr === 'object') actualPort = addr.port;
      resolve({
        url: 'http://localhost:' + actualPort,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}

export function tryOpenBrowser(url: string): boolean {
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "termux-open-url", args: [url] },
    { cmd: "termux-open", args: [url] },
    { cmd: "open", args: [url] },
    { cmd: "xdg-open", args: [url] },
    { cmd: "cmd", args: ["/c", "start", "", url] },
  ];
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, c.args, { stdio: "ignore", timeout: 2000 });
      if (r.status === 0) return true;
    } catch {
      // try next
    }
  }
  return false;
}
