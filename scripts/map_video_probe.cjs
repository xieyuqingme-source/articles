'use strict';

// Independent local video validation shared by the browser acceptance harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fileInfo(bytes, filename) {
  assert(bytes.length > 1024, 'The encoded video contains media data');
  const extension = path.extname(filename).toLowerCase();
  let container;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) container = 'webm';
  else if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') container = 'mp4';
  else throw new Error('Unrecognized video container signature');
  assert.equal(extension, '.' + container, 'Suggested extension matches encoded container');
  return { filename, bytes: bytes.length, container, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function decodeVideo(context, url, bytes, output, name, sampleTimes = [0, 1, 2.4, 2.8, 3.4]) {
  await context.route(url, route => route.fulfill({ contentType: path.extname(name) === '.mp4' ? 'video/mp4' : 'video/webm', body: bytes }));
  const page = await context.newPage();
  try {
    const viewUrl = new URL('/__qa-video-view/' + encodeURIComponent(name) + '.html', url).href;
    await context.route(viewUrl, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#ddd}video{display:block;max-width:100%;height:auto}</style><video muted playsinline controls></video>' }));
    await page.goto(viewUrl);
    const info = await page.evaluate(async ({ encoded, mime }) => {
      const video = document.querySelector('video');
      const loaded = new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', () => reject(new Error('Decode error: ' + (video.error && video.error.message))), { once: true });
        setTimeout(() => reject(new Error('Video metadata timed out')), 20000);
      });
      const binary = atob(encoded), buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
      video.src = URL.createObjectURL(new Blob([buffer], { type: mime }));
      await loaded;
      // Some streaming WebM encoders expose Infinity until seeking to the end.
      if (!Number.isFinite(video.duration)) {
        await new Promise((resolve, reject) => {
          video.addEventListener('seeked', resolve, { once: true });
          video.addEventListener('error', reject, { once: true });
          video.currentTime = 1e6;
          setTimeout(resolve, 5000);
        });
      }
      const info = { width: video.videoWidth, height: video.videoHeight, duration: video.duration, seekable: [...Array(video.seekable.length)].map((_, i) => [video.seekable.start(i), video.seekable.end(i)]), readyState: video.readyState, mime: video.currentSrc };
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 250));
      video.pause();
      info.played = video.currentTime > 0 && !video.error;
      return info;
    }, { encoded: bytes.toString('base64'), mime: path.extname(name) === '.mp4' ? 'video/mp4' : 'video/webm' });
    assert(info.width >= 640 && info.height >= 360, 'Video has a useful decoded picture size');
    assert(info.played, 'The browser actually advances decoded video playback');
    const rangeEnd = info.seekable.length ? info.seekable.at(-1)[1] : 0;
    const duration = Number.isFinite(info.duration) ? info.duration : rangeEnd;
    assert(duration > 0, 'Video has a measurable playable duration');
    info.measuredDuration = duration;
    info.frames = [];
    for (const sample of sampleTimes.filter(time => time < duration - 0.05)) {
      const frame = await page.evaluate(async time => {
        const video = document.querySelector('video');
        if (Math.abs(video.currentTime - time) > 0.02) await new Promise((resolve, reject) => {
          video.addEventListener('seeked', resolve, { once: true });
          video.addEventListener('error', reject, { once: true });
          video.currentTime = time;
          setTimeout(() => reject(new Error('Seek timed out: ' + time)), 15000);
        });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
        return { width: canvas.width, height: canvas.height, actualTime: video.currentTime, png: canvas.toDataURL('image/png').split(',')[1] };
      }, sample);
      const filename = name.replace(/\.(mp4|webm)$/i, '') + '-frame-' + String(sample).replace('.', '_') + '.png';
      const png = Buffer.from(frame.png, 'base64');
      fs.writeFileSync(path.join(output, filename), png);
      const hash = crypto.createHash('sha256').update(png).digest('hex');
      info.frames.push({ sample, actualTime: frame.actualTime, filename, bytes: png.length, sha256: hash });
    }
    info.changingFrames = new Set(info.frames.map(frame => frame.sha256)).size;
    assert(info.changingFrames > 1 || info.frames.length < 2, 'Decoded video contains changing pictures');
    return info;
  } finally { await page.close(); }
}

module.exports = { fileInfo, decodeVideo };
