import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { serveHtml } from '../src/index.js';

describe('serveHtml', function () {
  it('返回当前 HTML', async function () {
    let html = '<h1>v1</h1>';
    const handle = await serveHtml(() => html, { port: 0 });
    try {
      const r = await fetch(handle.url);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') || '', /text\/html/);
      const body = await r.text();
      assert.equal(body, '<h1>v1</h1>');
    } finally {
      handle.close();
    }
  });

  it('getHtml 动态更新：二次请求返回新内容', async function () {
    let html = '<h1>first</h1>';
    const handle = await serveHtml(() => html, { port: 0 });
    try {
      const r1 = await fetch(handle.url);
      assert.equal(await r1.text(), '<h1>first</h1>');

      html = '<h1>second</h1>';
      const r2 = await fetch(handle.url);
      assert.equal(await r2.text(), '<h1>second</h1>');
    } finally {
      handle.close();
    }
  });

  it('favicon.ico 返回 204', async function () {
    const handle = await serveHtml(() => '<html></html>', { port: 0 });
    try {
      const r = await fetch(handle.url + '/favicon.ico');
      assert.equal(r.status, 204);
    } finally {
      handle.close();
    }
  });

  it('getHtml 抛异常时返回 500', async function () {
    const handle = await serveHtml(
      () => { throw new Error('boom'); },
      { port: 0 },
    );
    try {
      const r = await fetch(handle.url);
      assert.equal(r.status, 500);
      assert.match(await r.text(), /tred serve error: boom/);
    } finally {
      handle.close();
    }
  });

  it('port:0 自动分配且 url 含实际端口', async function () {
    const handle = await serveHtml(() => 'ok', { port: 0 });
    try {
      assert.ok(handle.port > 0);
      assert.match(handle.url, /^http:\/\/localhost:\d+$/);
    } finally {
      handle.close();
    }
  });

  it('port 已被占用时 reject EADDRINUSE', async function () {
    const h1 = await serveHtml(() => 'first', { port: 0 });
    try {
      await assert.rejects(
        serveHtml(() => 'second', { port: h1.port }),
        (err: unknown) => {
          const e = err as { code?: string; message?: string };
          return e.code === 'EADDRINUSE' || e.code === 'EACCES' || /EADDR/i.test(String(e.message || ''));
        },
      );
    } finally {
      h1.close();
    }
  });
});
