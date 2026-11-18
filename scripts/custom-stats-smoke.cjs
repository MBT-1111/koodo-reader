// Start `yarn start` for --source-main; otherwise build renderer resources first.
const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const { isInside } = require('../src/utils/main/custom/runtime');

(async () => {
  const sourceMain = process.argv.includes('--source-main');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krc-test-stats-'));
  const output = path.resolve(__dirname, '../dist');
  let app;
  try {
    const engineUrl = sourceMain ? '/src/assets/lib/kookit-extra-browser.min.js' : pathToFileURL(path.resolve('build/static', fs.readdirSync('build/static').find(name => /^kookit-.*\.js$/.test(name)))).href;
    const env = { ...process.env, KRC_TEST_PROFILE: root, ELECTRON_IS_DEV: sourceMain ? '1' : '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env, timeout: 60000 });
    const locations = await app.evaluate(({ app }) => ['userData', 'sessionData', 'temp', 'logs', 'crashDumps'].map(name => app.getPath(name)));
    assert.ok(locations.every(location => isInside(root, location)), 'All writable profile locations must be isolated');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('get-file-data'); ipcMain.on('get-file-data', event => { event.returnValue = ''; }); });
    const page = await app.firstWindow(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer error:', error.message); });
    if (sourceMain) await page.goto('http://127.0.0.1:3000/');
    await page.locator('.header').waitFor();
    const invoke = (channel, data) => page.evaluate(({ channel, data }) => window.electronAPI.invoke(channel, data), { channel, data });
    const storagePath = await page.evaluate(() => window.electronAPI.sendSync('storage-location', 'ping'));
    assert.ok(isInside(root, storagePath));
    const openStats = () => page.evaluate(() => { window.location.hash = '/stats'; });
    const closeStats = async () => { await page.locator('.stats-close-btn').click(); await page.locator('.header').waitFor(); };
    await openStats();
    await page.locator('.stats-cards').waitFor();
    assert.deepEqual(await page.locator('.stats-card-value').allTextContents(), ['0', '0s', '0', '0s']);
    await closeStats();
    console.log('PASS empty-library statistics');

    const book = { key: 'stats-a', name: 'Synthetic Stats A', author: 'Test', description: '', md5: 'fixture', cover: '', format: 'EPUB', publisher: '', size: 1, page: 1, path: '', charset: 'utf-8', published: '', modified: '', identifier: '', language: 'en', subject: '', rights: '', isbn: '', layout: '' };
    for (const data of [book, { ...book, key: 'stats-b', name: 'Synthetic Stats B' }]) {
      await invoke('database-command', { statement: 'saveStatement', statementType: 'string', executeType: 'run', dbName: 'books', storagePath, data });
    }
    const expected = await page.evaluate(async engineUrl => {
      const exports = Object.values(await import(engineUrl));
      const config = exports.find(value => typeof value?.setReaderConfig === 'function');
      const time = exports.find(value => typeof value?.dateToKey === 'function' && typeof value?.prototype?.getRangeStats === 'function');
      if (!config || !time) throw new Error('Public statistics exports not found');
      const today = time.dateToKey(new Date());
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      config.setItem('readingStats', JSON.stringify({ [today]: ['stats-a-120', 'stats-b-300', 'stats-deleted-60'], [time.dateToKey(yesterday)]: ['stats-a-60'] }));
      config.setItem('readingTime', JSON.stringify({ 'stats-a': 180, 'stats-b': 300 }));
      config.setItem('recordLocation', JSON.stringify({ 'stats-a': { percentage: 0.5 }, 'stats-b': { percentage: 0.25 } }));
      return { today, total: time.formatDuration(540), average: time.formatDuration(270) };
    }, engineUrl);
    await openStats();
    await page.locator('.stats-cards').waitFor();
    assert.deepEqual(errors, [], 'Statistics loading must not raise an uncaught error');
    assert.deepEqual(await page.locator('.stats-card-value').allTextContents(), ['2', expected.total, '2', expected.average]);
    assert.equal(await page.locator('.stats-leaderboard-card').count(), 2);
    assert.deepEqual(await page.locator('.stats-leaderboard-name').allTextContents(), ['Synthetic Stats B', 'Synthetic Stats A']);
    await page.locator('.stats-book-select').selectOption('stats-a');
    for (const range of ['7d', '3m', '6m', '1y', 'custom']) {
      await page.locator('.stats-range-select:not(.stats-book-select)').selectOption(range);
      await page.locator('.recharts-surface').waitFor();
    }
    for (const input of await page.locator('.stats-range-date').all()) await input.fill(expected.today);
    assert.deepEqual(await page.locator('.stats-range-date').evaluateAll(inputs => inputs.map(input => input.value)), [expected.today, expected.today]);
    await page.locator('.stats-range-select:not(.stats-book-select)').selectOption('7d');
    await page.locator('.stats-chart-tab').nth(1).click();
    await page.locator('.recharts-area').waitFor();
    await page.locator('.stats-chart-tab').nth(0).click();
    await page.locator('.recharts-bar').waitFor();
    assert.equal(await page.locator('.stats-book-select').inputValue(), 'stats-a');
    assert.equal(await page.locator('.heatmap-cell[title]').count() >= 358, true);
    console.log('PASS recorded statistics, deleted-book history, ranking, book/date filters and both charts');

    for (const [data, expectedKeys] of [[['stats-a'], ['stats-a']], [['stats-b', 'stats-deleted', 'stats-a'], ['stats-b', 'stats-a']], [[], []]]) {
      const records = await invoke('database-command', { statement: 'getByKeysStatement', statementType: 'function', executeType: 'all', dbName: 'books', storagePath, data });
      assert.deepEqual(records.map(record => record.key), expectedKeys);
    }
    for (const data of [null, [''], [1]]) {
      await assert.rejects(invoke('database-command', { statement: 'getByKeysStatement', statementType: 'function', executeType: 'all', dbName: 'books', storagePath, data }), /CUSTOM_INVALID_DATABASE_REQUEST/);
    }
    assert.deepEqual(errors, [], 'Renderer must not raise uncaught errors');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'custom-stats-smoke.png') });
    await closeStats();
    fs.writeFileSync(path.join(output, 'custom-stats-smoke.json'), JSON.stringify({ passed: true, sourceMain, checks: ['empty-library', 'recorded-statistics', 'deleted-book-history', 'ranking', 'book-filter', 'date-ranges', 'bar-and-line-charts', 'heatmap', 'batch-lookup-order', 'single-and-empty-lookup', 'invalid-lookup-parameters', 'return-to-library'] }, null, 2));
    console.log('PASS ordered batch lookup, single/empty lookup and return to library');
  } finally {
    if (app) await app.close();
    if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('krc-test-stats-')) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
