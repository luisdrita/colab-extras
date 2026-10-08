'use strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function normalizePath(value) {
  if (typeof value !== 'string') throw new Error('Choose a folder first.');
  const path = value.replace(/\/+$/, '');
  if (!path.startsWith('/') || path === '' || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('Enter an absolute folder path, for example /content/results.');
  }
  if (path.split('/').pop().startsWith('.colab-folder-zip-')) throw new Error('Choose your original folder, not a ZIP staging folder.');
  return path.replace(/\/{2,}/g, '/');
}
function deletionPath(value) {
  const path = normalizePath(value);
  if (!path.startsWith('/content/') || path.split('/').some(p => p.startsWith('.colab-folder-zip-'))) {
    throw new Error('Choose a folder inside /content. Runtime roots and job folders cannot be deleted.');
  }
  if (['/content/drive', '/content/drive/MyDrive', '/content/drive/Shareddrives'].includes(path) ||
      /^\/content\/drive\/Shareddrives\/[^/]+$/.test(path)) {
    throw new Error('Drive roots cannot be deleted. Choose a folder inside the drive.');
  }
  return path;
}
function conflictingJob(jobs, path, kind) {
  const scope = (p, k) => k === 'extract' ? p.slice(0, p.lastIndexOf('/')) || '/' : p;
  const overlaps = (a, b) => a === b || a === '/' || b === '/' || a.startsWith(b + '/') || b.startsWith(a + '/');
  return [...jobs.values()].some(job => job.path === path ||
    ((['delete', 'extract'].includes(kind) || ['delete', 'extract'].includes(job.kind)) &&
      overlaps(scope(path, kind), scope(job.path, job.kind))));
}
const isExtractable = path => typeof path === 'string' && /\.(zip|tar|tar\.gz|tgz)$/i.test(path);
function extractionPath(value) {
  const path = normalizePath(value);
  if (!isExtractable(path)) throw new Error('Choose a ZIP, TAR, TAR.GZ, or TGZ file.');
  if (!path.startsWith('/content/') || path.split('/').some(p => p.startsWith('.colab-folder-zip-'))) {
    throw new Error('Choose an archive inside /content or a mounted Drive folder.');
  }
  return path;
}
function validateExtraction(result, source) {
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (!result || result.path !== source || result.destination !== source.slice(0, source.lastIndexOf('/')) ||
      !['checking', 'extracting', 'extracted'].includes(result.state) ||
      !['files', 'folders', 'done', 'total'].every(key => count(result[key])) || result.done > result.total) {
    throw new Error('Unexpected extraction result. Refresh Files before retrying.');
  }
  return result;
}
const encodePath = path => path.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
const quote = text => "'" + text.replaceAll("'", "'\"'\"'") + "'";
function assertRuntime(ctx) {
  if (ctx.kernel.runtime !== ctx.runtime) throw new Error('The runtime changed. Reconnect and try again.');
}
async function request(ctx, path, method = 'GET', body) {
  assertRuntime(ctx);
  const opts = {method, headers: new Headers({'Content-Type':'application/json'}), signal: AbortSignal.timeout(30000)};
  if (body !== undefined) opts.body = JSON.stringify(body);
  const response = await ctx.xhr.fetch(path, opts);
  if (!response.ok) {
    const error = new Error(`Colab request failed (${response.status}) for ${path.split('?')[0]}.`);
    error.status = response.status;
    throw error;
  }
  return response;
}
async function put(ctx, path, content) {
  return request(ctx, '/api/contents/' + encodePath(path), 'PUT', {type:'file', format:'text', content});
}
async function openTerminal(ctx) {
  // Never attach to Colab's shared /colab/tty shell.
  if (typeof ctx.kernel.runtimeProxy?.createSocket !== 'function') {
    throw new Error('This runtime does not expose an isolated terminal. Use a hosted Colab runtime.');
  }
  let data;
  try { data = await (await request(ctx, '/api/terminals', 'POST', {})).json(); }
  catch (error) {
    if ([403,404,405].includes(error.status)) throw new Error('Independent terminals are unavailable on this runtime. No notebook code was executed.');
    throw error;
  }
  if (typeof data.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.name)) throw new Error('Unexpected terminal response from Colab.');
  const name = data.name;
  let socket, timer, closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    socket?.stop();
    // This name came from our POST, never from a list of other terminals.
    try { await request(ctx, '/api/terminals/' + name, 'DELETE'); }
    catch { /* A disconnected/deleted VM cannot be cleaned up from this tab. */ }
  };
  try {
    socket = ctx.kernel.runtimeProxy.createSocket('/terminals/websocket/' + name);
    await Promise.race([
      socket.connect(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Independent terminal connection timed out.')), 15000); })
    ]);
    return {
      send(command) { assertRuntime(ctx); socket.sendString(JSON.stringify(['stdin', command])); },
      close: cleanup
    };
  } catch (error) { await cleanup(); throw error; }
  finally { clearTimeout(timer); }
}
function validateArchive(result, source) {
  const suffix = typeof result.archive === 'string' && result.archive.startsWith(source) ? result.archive.slice(source.length) : '';
  if (!/^(?: \([1-9]\d*\))?\.zip$/.test(suffix) || !Number.isFinite(result.size) || result.size < 0) throw new Error('Unexpected archive result.');
  return result.archive;
}
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / 1024 ** index).toLocaleString(undefined, {maximumFractionDigits:index ? 2 : 0}) + ' ' + units[index];
}
function validateDetails(result, source) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const relative = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..');
  if (!result || !['scanning', 'details'].includes(result.state) || result.path !== source ||
      !['bytes', 'files', 'folders', 'links', 'special', 'skipped', 'excluded'].every(key => count(result[key])) ||
      !Array.isArray(result.largest) || result.largest.length > Math.min(10, result.files) ||
      !result.largest.every(file => file && relative(file.path) && count(file.size) && file.size <= result.bytes) ||
      !Array.isArray(result.errors) || result.errors.length > Math.min(5, result.skipped) ||
      !result.errors.every(item => item && typeof item.path === 'string' && typeof item.error === 'string')) {
    throw new Error('Unexpected folder details from Colab. Please try the scan again.');
  }
  return result;
}
// Exports are removed by build.py; the browser bundle keeps these functions private.
module.exports = {normalizePath, deletionPath, conflictingJob, isExtractable, extractionPath, validateExtraction, encodePath, quote, assertRuntime, request, put, openTerminal, validateArchive, formatBytes, validateDetails};
