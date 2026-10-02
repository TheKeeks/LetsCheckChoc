// Audit C06/C07 (pipeline workflow) and the upstream canary: pin the
// workflow wiring, and run update-buoy's real push step against a local
// git remote that moved mid-run (an owner merge landing during a bot run).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_ROOT } = require('../helpers/fixtures');

const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// The `run: |` block of the step called `name`, dedented.
function stepScript(yml, name) {
  const lines = yml.split('\n');
  const at = lines.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `step "${name}" not found`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
  const indent = lines[runAt].search(/\S/);
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  const pad = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
  return body.map(l => l.slice(pad)).join('\n');
}

test('update-buoy.yml: schedule untouched, one run at a time, data-only commit', () => {
  const yml = read('.github/workflows/update-buoy.yml');
  assert.match(yml, /cron: '15 \*\/2 \* \* \*'/, 'the schedule is the owner\'s call');
  assert.match(yml, /\nconcurrency:\n\s+group: update-buoy\n\s+cancel-in-progress: false\n/);
  assert.match(yml, /run: python scripts\/fetch_buoy\.py/);
  const push = stepScript(yml, 'Commit and push');
  assert.match(push, /git add data\/buoy\.json data\/verification\.json\n/);
  assert.ok(push.indexOf('git pull --rebase') < push.indexOf('git push'), 'rebase before push');
});

test('canary.yml: every 6 h off the hour + manual, GITHUB_TOKEN with issues: write only', () => {
  const yml = read('.github/workflows/canary.yml');
  const cron = yml.match(/schedule:\n\s+- cron: '(\d+) (\S+) \* \* \*'/);
  assert.ok(cron, 'scheduled');
  assert.notEqual(cron[1], '0', 'off-peak minute');
  assert.equal(cron[2], '*/6');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /permissions:\n\s+contents: read\n\s+issues: write\n/);
  assert.deepEqual([...yml.matchAll(/secrets\.(\w+)/g)].map(m => m[1]), ['GITHUB_TOKEN'], 'no PAT');
  assert.match(yml, /env:\n\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n\s+run: python scripts\/canary\.py\n/);
});

function gitSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-w4-push-'));
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'owner', GIT_AUTHOR_EMAIL: 'owner@example.test',
    GIT_COMMITTER_NAME: 'owner', GIT_COMMITTER_EMAIL: 'owner@example.test',
    GITHUB_REF_NAME: 'main'
  };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const put = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const origin = path.join(tmp, 'origin.git'), owner = path.join(tmp, 'owner'), bot = path.join(tmp, 'bot');
  git(tmp, 'init', '-q', '--bare', origin);
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(tmp, 'init', '-q', owner);
  git(owner, 'checkout', '-q', '-b', 'main');
  put(owner, 'app.js', 'v1\n');
  put(owner, 'data/buoy.json', '{"run":1}\n');
  put(owner, 'data/verification.json', '{"rows":[]}\n');
  git(owner, 'add', '-A');
  git(owner, 'commit', '-q', '-m', 'seed');
  git(owner, 'remote', 'add', 'origin', origin);
  git(owner, 'push', '-q', 'origin', 'main');
  // actions/checkout: a shallow clone of main.
  git(tmp, 'clone', '-q', '--depth', '1', 'file://' + origin, bot);
  const runStep = script => execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
    { cwd: bot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { tmp, git, put, origin, owner, bot, runStep };
}

test('update-buoy push step rebases onto a main that moved mid-run', () => {
  const script = stepScript(read('.github/workflows/update-buoy.yml'), 'Commit and push');
  const s = gitSandbox();
  try {
    // While fetch_buoy.py runs, the owner merges a code change...
    s.put(s.owner, 'app.js', 'v2\n');
    s.git(s.owner, 'commit', '-q', '-am', 'owner merge');
    s.git(s.owner, 'push', '-q', 'origin', 'main');
    // ...and the bot rewrites its data.
    s.put(s.bot, 'data/buoy.json', '{"run":2}\n');
    s.runStep(script);

    const subjects = s.git(s.origin, 'log', '--format=%s', 'main').trim().split('\n');
    assert.match(subjects[0], /^Update buoy data \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
    assert.deepEqual(subjects.slice(1), ['owner merge', 'seed']);
    assert.equal(s.git(s.origin, 'show', 'main:app.js'), 'v2\n', 'owner change kept');
    assert.equal(s.git(s.origin, 'show', 'main:data/buoy.json'), '{"run":2}\n', 'bot data landed');
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('update-buoy push step commits nothing when the data did not change', () => {
  const script = stepScript(read('.github/workflows/update-buoy.yml'), 'Commit and push');
  const s = gitSandbox();
  try {
    assert.match(s.runStep(script), /No changes to commit/);
    assert.equal(s.git(s.origin, 'rev-list', '--count', 'main').trim(), '1');
  } finally {
    fs.rmSync(s.tmp, { recursive: true, force: true });
  }
});
