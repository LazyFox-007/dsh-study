/**
 * 学习平台进程的生命周期：探活 / 扫端口 / 拉起 / 停下。
 *
 * 和学习平台自己的约定（_webapp/server.py）：
 * - 只监听 127.0.0.1，端口从 8777 开始往后找；
 * - GET /api/ping 返回 {"ok": true, "root": "..."} 作为存活探针；
 * - `--no-browser` 让它别自己弹浏览器（我们要嵌在面板里）；
 * - 不加 `--force` 时，若已有实例在跑，它会打印一行然后直接退出 —— 所以我们永远先探活。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getJson } from './http.js';

export const pingUrl = (port) => `http://127.0.0.1:${port}/api/ping`;
export const baseUrl = (port) => `http://127.0.0.1:${port}/`;

/** 探一个端口：在线且是本平台，返回 {port, url, info}；否则 null。 */
export const probePort = async (port, timeoutMs = 900) => {
  const res = await getJson(pingUrl(port), timeoutMs);
  if (!res.ok || !res.json || res.json.ok !== true) return null;
  return { port, url: baseUrl(port), info: res.json };
};

/** 顺序扫一段端口，第一个命中的就是它。localhost 拒绝连接是毫秒级，扫 12 个不慢。 */
export const scanPorts = async (start, span = 12, timeoutMs = 900) => {
  for (let i = 0; i < span; i += 1) {
    const hit = await probePort(start + i, timeoutMs);
    if (hit) return hit;
  }
  return null;
};

/** 拉起服务：捕获 stdout/stderr 逐行回调，返回 child。 */
export const startServer = ({ python, platformDir, args = [], env = {}, onLine }) => {
  const child = spawn(python, ['server.py', ...args], {
    cwd: platformDir,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pump = (stream) => {
    if (!stream) return;
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onLine?.(line);
    });
  };
  pump(child.stdout);
  pump(child.stderr);
  child.on('error', (err) => onLine?.(`[spawn error] ${err?.message || err}`));
  return child;
};

/** 等它上线（端口是它自己扫的，所以我们要扫一遍才知道落在哪个端口）。 */
export const waitForPorts = async (start, span, timeoutMs, isDead) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead?.()) return null;
    const hit = await scanPorts(start, span, 600);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};

/** 只结束我们自己拉起的那个进程；外部已经在跑的绝不动。 */
export const stopServer = (child) => {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    try {
      child.kill();
    } catch {
      finish();
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已经没了 */
      }
      finish();
    }, 3000);
    timer.unref?.();
  });
};

/** 简易日志环：内存里留最近 N 行，同时追加到文件。 */
export const createLog = (file, maxLines = 200) => {
  const lines = [];
  let stream = null;
  const open = () => {
    if (stream || !file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      stream = fs.createWriteStream(file, { flags: 'a' });
      // 日志是最不重要的东西：目录被删、磁盘满、权限不足都不能把插件搞崩。
      stream.on('error', () => {
        stream = null;
      });
    } catch {
      stream = null;
    }
  };
  return {
    push(line) {
      const text = String(line ?? '');
      if (!text) return;
      lines.push(text);
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
      open();
      try {
        stream?.write(`${new Date().toISOString()} ${text}\n`);
      } catch {
        /* 日志失败不影响主流程 */
      }
    },
    tail(n = 20) {
      return lines.slice(-n);
    },
    all() {
      return lines.slice();
    },
    close() {
      try {
        stream?.end();
      } catch {
        /* ignore */
      }
      stream = null;
    },
    get file() {
      return file;
    },
  };
};
