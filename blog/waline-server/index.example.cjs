// Preparation only: copy these options into the separate official Vercel backend.
// Do not execute or deploy this file from the static article repository.
const Waline = require('@waline/vercel');
const domains = ['xieyuqingme-source.github.io'];
if (process.env.SERVER_URL) domains.push(new URL(process.env.SERVER_URL).hostname);
module.exports = Waline({
  secureDomains: domains,
  // No email-derived or third-party avatars, including guest comments.
  avatarUrl() {
    return 'https://xieyuqingme-source.github.io/articles/assets/comment-avatar.svg';
  }
});
