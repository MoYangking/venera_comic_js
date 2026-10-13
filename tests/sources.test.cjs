'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));

function source(file, mocks = {}) {
  const calls = [];
  const sandbox = {
    ComicSource: class { loadSetting() { return ''; } },
    Comic: class { constructor(data) { Object.assign(this, data); } },
    ComicDetails: class { constructor(data) { Object.assign(this, data); } },
    Network: {
      get: async (url, headers) => {
        calls.push({ url, headers });
        if (!(url in mocks)) throw Error('Unexpected request: ' + url);
        return mocks[url];
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') +
    '\n;globalThis.sourceClass = ' + (file === 'nhentai.js' ? 'NhentaiSource' : 'EHentaiSource'), sandbox);
  return { source: new sandbox.sourceClass(), calls };
}

test('catalog entries match scripts and stable source keys', () => {
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map(e => e.key).sort(), ['ehentai', 'nhentai']);
  for (const entry of catalog) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    const code = fs.readFileSync(path.join(root, entry.fileName), 'utf8');
    assert.ok(code.includes('extends ComicSource'));
    assert.ok(code.includes('key = "' + entry.key + '"'));
    assert.ok(code.includes('version = "' + entry.version + '"'));
    assert.ok(code.includes('/' + entry.fileName + '"'));
  }
});

test('nhentai listing, details and image links', async () => {
  const base = 'https://nhentai.net/api/v2';
  const gallery = {
    id: 42, title: { pretty: 'Mock title', english: 'Alt title' },
    thumbnail: { path: 'covers/42.jpg' }, cover: { path: 'covers/42.jpg' },
    num_pages: 2, tags: [{ type: 'artist', name: 'Test artist' }],
    pages: [{ path: 'galleries/42/1.jpg' }, { path: 'galleries/42/2.png' }]
  };
  const mock = body => ({ status: 200, body: JSON.stringify(body) });
  const { source: s } = source('nhentai.js', {
    [base + '/galleries?page=1']: mock({ result: [gallery], num_pages: 3 }),
    [base + '/search?query=hello&page=1&sort=date']: mock({ result: [gallery], num_pages: 1 }),
    [base + '/galleries/42']: mock(gallery)
  });
  const list = await s.explore[0].load(1);
  assert.equal(list.maxPage, 3);
  assert.equal(list.comics[0].id, '42');
  const result = await s.search.load('hello', ['date'], 1);
  assert.equal(result.comics[0].title, 'Mock title');
  const info = await s.comic.loadInfo('42');
  assert.equal(info.chapters, null);
  assert.deepEqual(Array.from(info.tags.artist), ['Test artist']);
  const images = await s.comic.loadEp('42', null);
  assert.deepEqual(Array.from(images.images), [
    'https://i3.nhentai.net/galleries/42/1.jpg',
    'https://i3.nhentai.net/galleries/42/2.png'
  ]);
});

test('nhentai reports HTTP errors', async () => {
  const { source: s } = source('nhentai.js', {
    'https://nhentai.net/api/v2/galleries?page=1': { status: 403, body: '' }
  });
  await assert.rejects(() => s.explore[0].load(1), /HTTP 403/);
});

test('E-Hentai gallery and image URL validation', async () => {
  const { source: s } = source('ehentai.js');
  assert.equal(s.comic.link.linkToId('https://e-hentai.org/g/1234/abcde/'),
    'https://e-hentai.org/g/1234/abcde/');
  assert.equal(s.comic.link.linkToId('https://example.org/g/1234/abcde/'), null);
  await assert.rejects(() => s.comic.loadInfo('https://example.org/g/1234/abcde/'), /Invalid E-Hentai/);
  await assert.rejects(() => s.comic.onImageLoad('https://example.org/s/key/1234-1'), /Unexpected E-Hentai/);
});

test('image handlers preserve origin referers', () => {
  const { source: n } = source('nhentai.js');
  assert.equal(n.comic.onImageLoad('https://i3.nhentai.net/x.jpg').headers.Referer,
    'https://nhentai.net/');
  const { source: e } = source('ehentai.js');
  assert.equal(e.comic.onThumbnailLoad('https://ehgt.org/x.jpg').headers.Referer,
    'https://e-hentai.org/');
});
