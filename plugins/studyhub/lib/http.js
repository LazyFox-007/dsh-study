/**
 * 极简 HTTP 助手。宿主半边只用 node 内置模块，不引任何依赖
 * （和学习平台「零第三方依赖」的取向一致）。
 */
import http from 'node:http';

const MAX_BODY = 64 * 1024;

/** 读一个 JSON 请求体；坏数据/超限一律给 {}，绝不让路由抛。 */
export const readJsonBody = (req) => new Promise((resolve) => {
  let raw = '';
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  req.on('data', (chunk) => {
    if (settled) return;
    raw += chunk;
    if (raw.length > MAX_BODY) done({});
  });
  req.on('end', () => {
    try {
      done(raw ? JSON.parse(raw) : {});
    } catch {
      done({});
    }
  });
  req.on('error', () => done({}));
});

export const sendJson = (res, status, value) => {
  if (!res || typeof res.end !== 'function') return;
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
  } catch {
    /* 客户端已断开，忽略 */
  }
};

/**
 * POST 一个 JSON，拿回 JSON。
 * 同样永远 resolve —— 失败要能当"业务结果"处理，不是异常。
 */
export const postJson = (url, body, timeoutMs = 20000) => new Promise((resolve) => {
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  let payload;
  try {
    payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  } catch (err) {
    done({ ok: false, status: 0, json: null, error: `请求体无法序列化：${err?.message || err}` });
    return;
  }
  let target;
  try {
    target = new URL(url);
  } catch (err) {
    done({ ok: false, status: 0, json: null, error: `地址不合法：${url}` });
    return;
  }
  let req;
  try {
    req = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': payload.length,
      },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 512 * 1024) {
          req.destroy();
          done({ ok: false, status: res.statusCode ?? 0, json: null, error: 'response too large' });
        }
      });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        done({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, json, raw });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, status: 0, json: null, error: 'timeout' });
    });
    req.on('error', (err) => done({ ok: false, status: 0, json: null, error: err?.message || String(err) }));
    req.end(payload);
  } catch (err) {
    done({ ok: false, status: 0, json: null, error: err?.message || String(err) });
  }
});

export const getJson = (url, timeoutMs = 1200) => new Promise((resolve) => {
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  let req;
  try {
    req = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 256 * 1024) {
          req.destroy();
          done({ ok: false, status: res.statusCode ?? 0, json: null, error: 'response too large' });
        }
      });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        done({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode ?? 0, json });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, status: 0, json: null, error: 'timeout' });
    });
    req.on('error', (err) => done({ ok: false, status: 0, json: null, error: err?.message || String(err) }));
  } catch (err) {
    done({ ok: false, status: 0, json: null, error: err?.message || String(err) });
  }
});
