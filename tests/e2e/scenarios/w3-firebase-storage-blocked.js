// Audit C03 (firebase-config.js part): when only the Storage compat script
// fails (ad blocker, CDN hiccup), firebase.storage() used to throw at the
// top of firebase-config.js, killing auth for the whole visit (and the
// uncaught error fails this scenario). Now photo storage is optional:
// anonymous sign-in still happens and the forecast loads.
'use strict';

module.exports = {
  name: 'Firebase Storage SDK blocked: auth and forecast still work',
  options: { firebase: { mode: 'new_anon', noStorage: true } },
  async run({ ctx, assert }) {
    await ctx.open('/');
    const auth = await ctx.waitFor(() => window._fbUserId, { label: 'anonymous sign-in', timeout: 15000 });
    assert.equal(auth.value, 'anon-1');
    assert.equal(await ctx.state(() => fbStorage), null);
    assert.equal(await ctx.state(() => typeof window._fbAuthReady.then), 'function');
    await ctx.waitForChart();
    assert.deepEqual(ctx.pageErrors.map(e => e.message), []);
  }
};
