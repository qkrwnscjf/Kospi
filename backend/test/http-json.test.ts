// 외부 API 호출 공통 처리 보안 테스트 (docs/Task_ORDER.md T-67, 12단계 보안 검토)
// 외부에 접속하지 않고, 테스트 안에서 127.0.0.1에만 띄운 임시 서버로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchJson, HttpJsonError, safeLogList, safeLogText } from '../src/infrastructure/http-json.js';

test('외부 문자열을 로그에 쓸 때 줄바꿈·제어 문자·줄 구분 문자를 지우고 길이를 자른다 (로그 위조 방지)', () => {
  const lineSeparator = String.fromCharCode(0x2028);
  const nul = String.fromCharCode(0);
  const escape = String.fromCharCode(0x1b);
  assert.equal(safeLogText('IDX_NM\n[krx] fake log line'), 'IDX_NM[krx] fake log line');
  assert.equal(safeLogText(`a${lineSeparator}b${nul}c${escape}[31m`), 'abc[31m');
  assert.equal(safeLogText('x'.repeat(100)).length, 60);
  assert.equal(safeLogList(Array.from({ length: 50 }, (_, index) => `f${index}`)).split(',').length, 40);
});

async function withServer(handler: Parameters<typeof createServer>[1], run: (base: string) => Promise<void>) {
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const options = { timeoutMs: 2000, maxBytes: 1024 };

test('리다이렉트는 따라가지 않는다 (키가 다른 주소로 가지 않게)', async () => {
  let followed = false;
  await withServer((req, res) => {
    if (req.url === '/elsewhere') {
      followed = true;
      res.end('{}');
      return;
    }
    res.writeHead(302, { location: '/elsewhere' }).end();
  }, async base => {
    await assert.rejects(fetchJson(`${base}/start?crtfc_key=secret`, options), (error: unknown) =>
      error instanceof HttpJsonError && error.message === 'redirect_blocked');
  });
  assert.equal(followed, false);
});

test('POST도 307 리다이렉트를 따라가지 않아 본문(시크릿)이 다른 주소로 다시 가지 않는다', async () => {
  const received: string[] = [];
  await withServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push(`${req.method} ${req.url} ${body}`);
      if (req.url === '/token') {
        res.writeHead(307, { location: '/elsewhere' }).end();
        return;
      }
      res.end('{}');
    });
  }, async base => {
    await assert.rejects(
      fetchJson(`${base}/token`, { ...options, method: 'POST', headers: { appsecret: 'secret' }, body: '{"appsecret":"secret"}' }),
      (error: unknown) => error instanceof HttpJsonError && error.message === 'redirect_blocked'
    );
  });
  assert.deepEqual(received, ['POST /token {"appsecret":"secret"}']);
});

test('응답이 상한보다 크면 읽기를 멈춘다 (content-length 없음 포함)', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('['.padEnd(800, ' '));
    res.end(' '.repeat(800) + ']');
  }, async base => {
    await assert.rejects(fetchJson(`${base}/big`, options), (error: unknown) => error instanceof HttpJsonError && error.message === 'too_large');
  });
});

test('응답이 늦으면 시간 제한으로 끊는다', async () => {
  await withServer(() => undefined, async base => {
    await assert.rejects(fetchJson(`${base}/slow`, { ...options, timeoutMs: 200 }), (error: unknown) =>
      error instanceof HttpJsonError && error.message === 'timeout');
  });
});

test('정상 응답은 JSON으로 읽고, 오류 메시지에 요청 주소(키)가 들어가지 않는다', async () => {
  await withServer((req, res) => {
    if (req.url?.startsWith('/ok')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"000"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not json</html>');
  }, async base => {
    const ok = await fetchJson(`${base}/ok`, options);
    assert.deepEqual(ok.body, { status: '000' });
    await assert.rejects(fetchJson(`${base}/html?crtfc_key=secret`, options), (error: unknown) => {
      assert.ok(error instanceof HttpJsonError);
      assert.equal(String(error.message).includes('secret'), false);
      assert.equal(String(error.stack).includes('secret'), false);
      return true;
    });
  });
});
