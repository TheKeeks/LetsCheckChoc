'use strict';

module.exports = {
  name: 'Methods and Map: separate views, light charts, shared theme, historical map links',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert }) {
    ctx.serve('/tests/methods-host.html', '<!doctype html><html><body style="margin:0"><iframe title="Methods" src="/research/index.html?view=methods" style="border:0;width:100%;height:100vh"></iframe><script>window.messages=[];addEventListener("message",e=>{if(e.origin===location.origin)messages.push(e.data);});</script></body></html>');
    await ctx.open('/tests/methods-host.html');
    const frame = await (await page.$('iframe')).contentFrame();
    await frame.waitForFunction(() => window.CHOC && document.querySelector('#q1Pair svg'), null, { timeout: 30000 });
    assert.equal(await frame.locator('.sc-title').textContent(), 'Methods');
    assert.equal(await frame.locator('#tripStage').isVisible(), false, 'Methods has no interactive explorer');
    assert.equal(await frame.locator('#how-h').isVisible(), true, 'the scientific explanation remains');
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.researchTheme), 'light');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 246, 242)');
    const lightInk = await frame.$eval('#q1Pair svg text', node => node.getAttribute('fill'));
    await ctx.screenshot('methods-light');

    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'lcc-theme', theme: 'night' }, location.origin));
    await frame.waitForFunction(() => document.documentElement.dataset.researchTheme === 'dark');
    const darkInk = await frame.$eval('#q1Pair svg text', node => node.getAttribute('fill'));
    assert.notEqual(darkInk, lightInk, 'existing chart text repaints for the new theme');
    await frame.evaluate(() => dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.example', source: parent, data: { type: 'lcc-theme', theme: 'day' } })));
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.researchTheme), 'dark', 'cross-origin theme messages are ignored');
    await ctx.screenshot('methods-dark');
    await frame.evaluate(() => window.CHOC.showPast('2022-10-14'));
    await page.waitForFunction(() => messages.some(m => m.type === 'lcc-open-map' && m.date === '2022-10-14'));

    await ctx.open('/research/index.html?view=map&theme=light&date=2022-10-14');
    await page.waitForFunction(() => window.CHOC && window.CHOC.trip && window.CHOC.trip.state.phase === 'past', null, { timeout: 30000 });
    assert.equal(await page.locator('#tripStage').isVisible(), true);
    assert.equal(await page.locator('#q1-h').isVisible(), false, 'map embed omits unrelated research sections');
    assert.equal(await page.locator('#frWorld').isVisible(), true, 'forward-ray diagrams remain available on Map');
    assert.equal(await page.locator('#odWrap').isVisible(), true, 'historical ocean layers remain available on Map');
    assert.equal(await page.evaluate(() => window.CHOC.D[window.CHOC.st.idx].iso), '2022-10-14');
    await ctx.screenshot('map-explorer-past');
  }
};
