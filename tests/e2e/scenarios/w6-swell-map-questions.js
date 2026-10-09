// Sound Check (research/) is organized around its two research questions: what makes the surf good at Choc, and
// how real the swell window is. The header answers both (numbers computed from the same data as the charts) and
// links to them; each question opens with its answer as a chart; the window-by-direction chart is out of its
// collapsed box; and every section the page had is still there, in question order.
'use strict';

module.exports = {
  name: 'Sound Check: the page answers its two questions up top, then shows each answer as a chart',
  options: { viewport: { width: 1180, height: 820 } },
  async run({ page, ctx, assert, log }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ctx.open('/research/index.html');
    await page.waitForFunction(() => document.querySelector('#q2Share .share-row') && document.querySelector('#q1Pair svg'), null, { timeout: 30000 });

    // Every section, in question order.
    const order = await page.evaluate(() => {
      const ids = ['trip-h', 'how-h', 'q1-h', 'model-h', 'ans-h', 'q2-h', 'tr-h', 'dc-h', 'dec-h', 'week-h', 'wild-h', 'behind-h'];
      const els = ids.map(i => document.getElementById(i));
      return { missing: ids.filter((i, k) => !els[k]), sorted: els.every((e, k) => !k || !e || !!(els[k - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) };
    });
    assert.deepEqual(order, { missing: [], sorted: true }, 'map, method, question 1, question 2, ten years, forecast, Wilderness, behind the numbers');

    // The header answers both questions with the same numbers the charts show.
    const qa = await page.$$eval('.qa', as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ') })));
    log(JSON.stringify(qa));
    assert.deepEqual(qa.map(q => q.href), ['#q1-h', '#q2-h']);
    const q1 = await page.$$eval('#q1Pair svg', s => s.map(v => ({ dots: v.querySelectorAll('circle.q1-dot, circle.q1-hi').length, text: v.textContent })));
    assert.equal(q1.length, 2, 'buoy and model panels');
    assert.ok(q1.every(p => p.dots === 28), 'one dot per logged session in each panel');
    assert.match(q1[0].text, /Raw buoy height.*Picks the bigger of two sessions: 77%/);
    assert.match(q1[1].text, /Modeled height at Choc.*Picks the bigger of two sessions: 87%/);
    assert.match(qa[0].text, /picks the bigger of two of your sessions 87% of the time, the raw buoy 77%/);
    const rows = await page.$$eval('#q2Share .share-row', rs => rs.map(r => r.dataset.k + ' ' + r.querySelector('.share-val').textContent));
    log(rows.join(' | '));
    assert.deepEqual(rows, ['east 15% · 120 days', 'in 40% · 312 days', 'south 45% · 352 days']);
    assert.match(qa[1].text, /On only 40% of Choc's 3 ft\+ days.*on 45% it bends in from south of Montauk/);
    assert.match(await page.$eval('#q2Share', n => n.closest('figure').textContent.replace(/\s+/g, ' ')), /On 40% of the 784 days in ten years/);

    // The window by direction and period is a main chart now, with the window marked.
    assert.equal(await page.$eval('#kresp', n => !!n.closest('details')), false, 'not hidden in a collapsed box');
    assert.match(await page.$eval('#kresp', n => n.textContent), /the window/);
    // The tiles moved to the question they answer.
    assert.match(await page.$eval('#q1Takes', n => n.textContent), /0\.85.*2\.1 ft/s);
    assert.match(await page.$eval('#q2Takes', n => n.textContent), /58%.*29 Aug 2023/s);
    assert.ok(!/Part [123]\b/.test(await page.evaluate(() => document.body.innerText)), 'no leftover "Part 1/2/3" pointers in what you read');

    // A question card jumps to its section.
    await page.click('.qa[href="#q2-h"]');
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => location.hash), '#q2-h');
    assert.ok(await page.$eval('#q2-h', h => { const r = h.getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight / 2; }), 'question 2 is on screen');
    await ctx.screenshot('sound-check-question-2');
    await page.evaluate(() => scrollTo(0, 0));
    await ctx.screenshot('sound-check-header');
    assert.deepEqual(errors, [], 'no page errors');
  }
};
