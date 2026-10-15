'use strict';

// The public map/research pages stay available while journal/model access
// follows real account changes, including a failed Google popup and logout.
module.exports = {
  name: 'navigation auth: four public tabs, Google login feedback, protected My ratings and shared light/dark settings',
  options: {
    viewport: { width: 390, height: 844 },
    firebase: { mode: 'returning_anon' }
  },
  async run({ page, ctx, assert }) {
    const tabs = () => ctx.state(() => Array.from(document.querySelectorAll('.cl-tabs .cl-tab'))
      .filter(button => !button.hidden).map(button => button.textContent.trim()));
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && window._fbUserId === 'anon-1', { label: 'public shell' });
    assert.equal(await ctx.state(() => CLEAN.tab()), 'forecast');
    assert.equal(await ctx.state(() => CLEAN.themeMode()), 'light');
    assert.equal(await ctx.state(() => CLEAN.theme()), 'day');
    assert.deepEqual(await tabs(), ['Forecast', 'Explore', 'Methods', 'Log']);

    await page.locator('.cl-tabs [data-tab="log"]').click();
    await ctx.waitFor(() => !document.querySelector('.cl-l-gate').hidden, { label: 'Log login page' });
    assert.match(await page.locator('.cl-l-gate').innerText(), /To log surfs and model them, you need to be logged in\./);
    assert.equal(await page.locator('.cl-l-form').isVisible(), false);
    assert.equal(await page.locator('.cl-l-past').isVisible(), false);
    await ctx.screenshot('log-login');

    // Both links and imperative navigation must pass the same account gate.
    await ctx.state(() => { location.hash = 'model'; });
    await ctx.waitFor(() => CLEAN.tab() === 'log' && location.hash === '#log', { label: 'Model deep link gated' });
    await ctx.state(() => CLEAN.show('model'));
    assert.equal(await ctx.state(() => CLEAN.tab()), 'log');

    await ctx.state(() => { window.__FB_LINK_ERROR = 'auth/unauthorized-domain'; });
    await page.locator('.cl-l-signin').click();
    await ctx.waitFor(() => /not enabled for this preview/.test(document.querySelector('.cl-l-auth-status').textContent), { label: 'actionable auth error' });
    assert.equal(await page.locator('.cl-l-signin').isEnabled(), true);
    assert.deepEqual(await tabs(), ['Forecast', 'Explore', 'Methods', 'Log']);

    await ctx.state(() => {
      window.__FB_LINK_ERROR = 'auth/credential-already-in-use';
      window.__FB_POPUP_USER = { uid: 'google-1', displayName: 'Test Surfer' };
    });
    await page.locator('.cl-l-signin').click();
    await ctx.waitFor(() => CLEAN.auth().signedIn && !document.querySelector('.cl-l-form').hidden, { label: 'Google account restored' });
    assert.deepEqual(await tabs(), ['Forecast', 'Explore', 'Methods', 'Log', 'My ratings']);
    assert.equal(await ctx.state(() => CLEAN.authStatus().error), '');
    await page.locator('.cl-tabs [data-tab="model"]').click();
    await ctx.waitFor(() => CLEAN.tab() === 'model', { label: 'signed-in Model' });

    await page.locator('#cl-settings-btn').click();
    await page.locator('#cl-sub-settings [data-mode="dark"]').click();
    assert.equal(await ctx.state(() => CLEAN.theme()), 'night');
    await page.locator('#cl-sub-settings [data-act="signout"]').click();
    await ctx.waitFor(() => !CLEAN.auth().signedIn && CLEAN.tab() === 'log', { label: 'logout protects Model' });
    assert.deepEqual(await tabs(), ['Forecast', 'Explore', 'Methods', 'Log']);
    assert.equal(await page.locator('.cl-l-form').isVisible(), false);
    assert.equal(await page.locator('#cl-view-model').isVisible(), false);
    assert.equal(await ctx.state(() => CLEAN.theme()), 'night');
    await page.setViewportSize({ width: 375, height: 667 });
    assert.equal(await ctx.state(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await ctx.screenshot('log-login-dark');

    await ctx.open('/?preview=clean#log');
    await ctx.waitFor(() => window.CLEAN && CLEAN.tab() === 'log', { label: 'saved theme on reload' });
    assert.equal(await ctx.state(() => CLEAN.themeMode()), 'dark');
    assert.equal(await ctx.state(() => CLEAN.theme()), 'night');
    assert.deepEqual(await ctx.state(() => CLEAN.errors), []);
  }
};
