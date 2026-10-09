// Sound Check (research/): the model-comparison caption quoted the ratings model's share of your size rating
// explained as 61%, typed in by hand from an older version, while the ratings panel (computed from the saved model
// results) shows 0.63. The caption now reads the same saved number as the panel, so the two always agree.
'use strict';

module.exports = {
  name: 'Sound Check: the comparison caption quotes the same size R² as the ratings panel',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => document.querySelector('#modelTiles .take b'), null, { timeout: 30000 });
    await page.click('#targetSeg [data-t="size"]');
    const panel = await page.$eval('#modelTiles .take b', b => b.textContent.trim());
    const caption = await page.evaluate(() => {
      const f = [...document.querySelectorAll('figcaption')].find(c => /ratings model lifts the share of your size rating/.test(c.textContent));
      return f ? f.textContent.replace(/\s+/g, ' ') : '';
    });
    const quoted = (caption.match(/size rating explained to (\d+)%/) || [])[1];
    log(`panel: ${panel} · caption: ${quoted}%`);
    assert.ok(/^0\.\d\d$/.test(panel), `the panel shows a leave-one-out R² (${panel})`);
    assert.equal(Number(quoted), Math.round(Number(panel) * 100), 'the caption quotes the panel’s size R²');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
