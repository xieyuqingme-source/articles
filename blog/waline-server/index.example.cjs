// Preparation only: merge into the separate official Vercel backend entry.
// Do not execute or deploy this file from the static website repository.
const Waline = require('@waline/vercel');
// Waline's secureDomains option overrides its native SECURE_DOMAINS handling,
// so explicitly read that environment variable here instead of ignoring it.
const configuredDomains = (process.env.SECURE_DOMAINS || '')
  .split(',').map(domain => domain.trim()).filter(Boolean);
const domains = new Set(configuredDomains.length ? configuredDomains : ['xieyuqing.me']);
if (process.env.SERVER_URL) domains.add(new URL(process.env.SERVER_URL).hostname);
module.exports = Waline({
  secureDomains: [...domains],
  // This hook is the single avatar setting; do not also set GRAVATAR_STR.
  // Use the same local image for guests and administrators, without email lookup.
  avatarUrl() {
    return 'https://xieyuqing.me/articles/assets/comment-avatar.svg';
  }
});
