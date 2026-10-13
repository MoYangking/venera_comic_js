'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));

function elem({ text = '', attrs = {}, one = {}, many = {}, children = [] } = {}) {
    return {
        text, attributes: attrs, children,
        querySelector(s) { return one[s] || null; },
        querySelectorAll(s) { return many[s] || []; }
    };
}
function doc({ one = {}, many = {} } = {}) {
    const o = elem({ one, many });
    o.dispose = () => { o.disposed = true; };
    return o;
}
function json(value, status = 200) { return { status, body: JSON.stringify(value) }; }
function html(label, status = 200) { return { status, body: '<html:' + label + '>' }; }

function create(file, { requests = {}, documents = {}, settings = {}, cookies = [] } = {}) {
    const calls = [];
    const transport = (method, url, headers, body) => {
        calls.push({ method, url, headers, body });
        if (!(url in requests)) throw Error('Unmocked ' + method + ': ' + url);
        const response = requests[url];
        return typeof response === 'function' ? response({ method, url, headers, body }) : response;
    };
    const context = vm.createContext({
        ComicSource: class {
            loadSetting(name) { return settings[name] || ''; }
            loadData(name) { return this['data_' + name] || ''; }
            saveData(name, value) { this['data_' + name] = value; }
            deleteData(name) { delete this['data_' + name]; }
        },
        Comic: class { constructor(data) { Object.assign(this, data); } },
        ComicDetails: class { constructor(data) { Object.assign(this, data); } },
        Cookie: class { constructor(data) { Object.assign(this, data); } },
        Network: {
            get: (u, h) => transport('GET', u, h),
            post: (u, h, b) => transport('POST', u, h, b),
            delete: (u, h) => transport('DELETE', u, h),
            getCookies: async () => cookies,
            setCookies: async (u, v) => { calls.push({ method: 'SET_COOKIE', url: u, cookies: v }); },
            deleteCookies: u => { calls.push({ method: 'DELETE_COOKIE', url: u }); }
        },
        HtmlDocument: class {
            constructor(body) {
                if (!(body in documents)) throw Error('Unmocked document: ' + body);
                return documents[body];
            }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + '\n;globalThis.Source=' +
        (file === 'nhentai.js' ? 'NhentaiSource' : 'EHentaiSource'), context);
    return { source: new context.Source(), calls };
}

const nh = 'https://nhentai.net/api/v2';
const gallery = 'https://e-hentai.org/g/2345/abcde/';
const img1 = 'https://e-hentai.org/s/imgkeya/2345-1';
const img2 = 'https://e-hentai.org/s/imgkeyb/2345-2';
const img3 = 'https://e-hentai.org/s/imgkeyc/2345-3';

function nhGallery() {
    return {
        id: 42,
        title: { pretty: 'Sample story', english: 'English story', japanese: 'Japanese story' },
        cover: { path: 'galleries/42/cover.jpg' },
        thumbnail: { path: 'galleries/42/thumb.jpg' },
        num_pages: 2,
        upload_date: 1750000000,
        is_favorited: true,
        tags: [
            { type: 'artist', name: 'Test Creator' },
            { type: 'language', name: 'english' }
        ],
        pages: [
            { path: 'galleries/42/1.jpg', thumbnail: 'galleries/42/1t.jpg' },
            { path: 'galleries/42/2.png', thumbnail: 'galleries/42/2t.jpg' }
        ],
        related: [{ id: 43, title: { pretty: 'Related title' }, thumbnail: { path: 'related.jpg' } }]
    };
}

function row({ title = 'Gallery Example', url = gallery, layout = 'compact' } = {}) {
    const titleElem = elem({ text: title });
    const cover = elem({ attrs: { src: 'data:image/gif;base64,placeholder', 'data-src': 'https://ehgt.org/sample.webp' } });
    const albumLink = elem({ attrs: { href: url }, one: { '.glink': titleElem }, text: title });
    const languageTag = elem({ attrs: { title: 'language:english' } });
    return elem({
        text: 'Example 12 pages 2026-10-13',
        one: { '.glink': titleElem },
        many: {
            a: [albumLink], img: [cover], '.gt, .gtl': [languageTag]
        }
    });
}
function listDoc(rows = [row()], next = '?next=123') {
    return doc({
        one: next ? { 'a#dnext': elem({ attrs: { href: next } }) } : {},
        many: { 'table.itg tr': rows, 'div.gl1t': [] }
    });
}
function galleryDoc() {
    return doc({
        one: {
            '#gn': elem({ text: 'Gallery Example' }),
            '#gj': elem({ text: 'Alt name' }),
            '#gd1 div': elem({ attrs: { style: "background: transparent url('https://ehgt.org/g-cover.jpg')" } }),
            '#gdn a': elem({ text: 'Uploader Name' }),
            '.cs': elem({ text: 'Manga' }),
            '#rating_label': elem({ text: 'Average: 4.35' }),
            '#favoritelink': elem({ text: 'Add to Favorites' })
        },
        many: {
            '#taglist tr': [elem({ many: { td: [elem({ text: 'artist:' }),
                elem({ many: { a: [elem({ text: 'Artist One' }), elem({ text: 'Artist Two' })] } })] } })],
            '#gdd tr': [elem({ text: 'Length: 3 pages' }), elem({ text: 'Posted: 2026-10-13 03:00' })],
            '#gdt img': [elem({ attrs: { src: 'https://ehgt.org/preview1.jpg' } })],
            '#gdt a': [elem({ attrs: { href: img1 } }), elem({ attrs: { href: img2 } })],
            'table.ptb a': [elem({ attrs: { href: gallery + '?p=1' } })]
        }
    });
}

test('index and source metadata agree and have stable keys/versions', () => {
    assert.equal(index.length, 2);
    assert.deepEqual(index.map(x => x.key).sort(), ['ehentai', 'nhentai']);
    for (const item of index) {
        assert.match(item.version, /^\d+\.\d+\.\d+$/);
        const source = fs.readFileSync(path.join(root, item.fileName), 'utf8');
        assert.ok(source.includes('key = "' + item.key + '"'));
        assert.ok(source.includes('version = "' + item.version + '"'));
        assert.ok(source.includes('/' + item.fileName + '"'));
        assert.match(source, /minAppVersion\s*=\s*"1\.16\.0"/);
        assert.doesNotMatch(source, /\b(?:require|module\.exports|fetch\()\b/);
    }
});

test('nhentai latest API handles galleries with structured tags and stable paths', async () => {
    const { source } = create('nhentai.js', {
        requests: { [nh + '/galleries?page=1']: json({ result: [nhGallery()], num_pages: 5 }) }
    });
    const data = await source.explore[0].load(1);
    assert.equal(data.maxPage, 5);
    assert.equal(data.comics[0].id, '42');
    assert.equal(data.comics[0].cover, 'https://t3.nhentai.net/galleries/42/thumb.jpg');
    assert.equal(data.comics[0].language, 'english');
});

test('nhentai popular, ranked and filtered search use API v2 routes', async () => {
    const requests = {
        [nh + '/galleries/popular']: json([nhGallery()]),
        [nh + '/search?query=*&page=3&sort=popular-month']: json({ result: [nhGallery()], num_pages: 7 }),
        [nh + '/search?query=hello%20language%3Achinese&page=2&sort=popular-week']: json({ result: [nhGallery()], num_pages: 2 })
    };
    const { source } = create('nhentai.js', { requests });
    assert.equal((await source.explore[1].load())[0].comics[0].id, '42');
    assert.equal((await source.categoryComics.ranking.load('popular-month', 3)).maxPage, 7);
    assert.equal((await source.search.load('hello', ['popular-week', 'chinese'], 2)).comics[0].id, '42');
    assert.equal(source.category.parts[0].categories[0].target.attributes.text, 'language:chinese');
    assert.equal(source.comic.onClickTag('artist', 'Test Creator').attributes.text, 'artist:"Test Creator"');
});

test('nhentai detailed data uses VeneraNext plain-object tags, thumbnails and no chapters', async () => {
    const { source } = create('nhentai.js', { requests: {
        [nh + '/galleries/42?include=related,favorite']: json(nhGallery()),
        [nh + '/galleries/42']: json(nhGallery())
    } });
    const info = await source.comic.loadInfo('nh42');
    assert.equal(info.title, 'Sample story');
    assert.equal(info.subtitle, 'English story');
    assert.equal(info.chapters, null);
    assert.equal(Object.getPrototypeOf(info.tags) !== null, true);
    assert.deepEqual(Array.from(info.tags.artist), ['Test Creator']);
    assert.equal(info.recommend[0].id, '43');
    assert.equal(info.thumbnails.length, 2);
    assert.equal(info.isFavorite, true);
    assert.match(info.updateTime, /^\d{4}-\d{2}-\d{2}$/);
    const pages = await source.comic.loadEp('https://nhentai.net/g/42/', null);
    assert.deepEqual(Array.from(pages.images), [
        'https://i3.nhentai.net/galleries/42/1.jpg',
        'https://i3.nhentai.net/galleries/42/2.png'
    ]);
    assert.equal(source.comic.link.linkToId('https://nhentai.net/g/42/?source=1'), '42');
    assert.equal(source.comic.link.linkToId('https://nhentai.net.evil.test/g/42/'), null);
});

test('nhentai API key and online favorites call authenticated API methods', async () => {
    const urls = {
        [nh + '/galleries/42/favorite']: { status: 204, body: '' },
        [nh + '/favorites?page=1']: json({ result: [nhGallery()], num_pages: 1 })
    };
    const { source, calls } = create('nhentai.js', { requests: urls, settings: { apiKey: 'mock-key' } });
    assert.equal(await source.favorites.addOrDelFavorite('42', null, true), true);
    assert.equal(await source.favorites.addOrDelFavorite('42', null, false), true);
    assert.equal((await source.favorites.loadComics(1)).comics.length, 1);
    assert.deepEqual(calls.slice(0, 3).map(c => c.method), ['POST', 'DELETE', 'GET']);
    assert.equal(calls[0].headers.Authorization, 'Key mock-key');
});

test('nhentai differentiates access errors, rate limiting, malformed JSON and bad ids', async () => {
    const requests = { [nh + '/galleries?page=1']: { status: 403, body: '' } };
    const { source } = create('nhentai.js', { requests });
    await assert.rejects(() => source.explore[0].load(1), /HTTP 403/);
    assert.throws(() => source.idOf('https://evil.test/g/42/'), /Invalid nhentai/);
    const s2 = create('nhentai.js', { requests: { [nh + '/galleries?page=1']: { status: 200, body: '<html>challenge' } } }).source;
    await assert.rejects(() => s2.explore[0].load(1), /did not return JSON/);
});

test('E-Hentai supports list rows from table and thumbnail mode plus cursor pagination', async () => {
    const thumbnail = row({ title: 'Thumb Layout' });
    const document = listDoc([row(), row()], '?next=7788');
    document.querySelectorAll = s => s === 'table.itg tr' ? [row(), row()] :
        s === 'div.gl1t' ? [thumbnail] : [];
    const { source } = create('ehentai.js', {
        requests: { 'https://e-hentai.org/': html('list') },
        documents: { '<html:list>': document }
    });
    const data = await source.explore[0].loadNext(null);
    assert.equal(data.comics.length, 1); // duplicate canonical IDs suppressed
    assert.equal(data.comics[0].id, gallery);
    assert.equal(data.comics[0].cover, 'https://ehgt.org/sample.webp');
    assert.equal(data.comics[0].language, 'english');
    assert.equal(data.next, 'https://e-hentai.org/?next=7788');
    assert.equal(document.disposed, true);
});

test('E-Hentai thumbnail-only list layout is recognized', async () => {
    const rowThumb = row({ title: 'A thumbnail gallery' });
    const list = doc({ many: { 'table.itg tr': [], 'div.gl1t': [rowThumb] } });
    const { source } = create('ehentai.js', {
        requests: { 'https://e-hentai.org/popular': html('thumb-list') },
        documents: { '<html:thumb-list>': list }
    });
    assert.equal((await source.explore[1].loadNext(null)).comics[0].title, 'A thumbnail gallery');
});

test('E-Hentai category mask, minimum rating and language filters are preserved', async () => {
    const { source } = create('ehentai.js');
    assert.equal(source.buildSearchUrl('hello', [JSON.stringify(['1', '2']), '4', 'japanese']),
        'https://e-hentai.org/?f_search=hello%20language%3Ajapanese&f_cats=1017&f_srdd=4');
    assert.equal(source.buildSearchUrl('language:english', [], null),
        'https://e-hentai.org/?f_search=language%3Aenglish');
    assert.equal(source.comic.onClickTag('artist', 'Test Name').attributes.text, 'artist:"Test Name"');
    assert.equal(source.comic.onClickTag('category', 'Manga').attributes.options[0], '["2"]');
});

test('E-Hentai details parse cover, dates, tags, rating and use plain objects', async () => {
    const d = galleryDoc();
    const { source } = create('ehentai.js', {
        requests: { [gallery]: html('gallery') },
        documents: { '<html:gallery>': d }
    });
    const info = await source.comic.loadInfo(gallery);
    assert.equal(info.title, 'Gallery Example');
    assert.equal(info.subtitle, 'Alt name');
    assert.equal(info.cover, 'https://ehgt.org/g-cover.jpg');
    assert.equal(info.maxPage, 3);
    assert.equal(info.updateTime, '2026-10-13');
    assert.equal(info.stars, 4.35);
    assert.equal(info.chapters, null);
    assert.equal(info.tags.category[0], 'Manga');
    assert.deepEqual(Array.from(info.tags.artist), ['Artist One', 'Artist Two']);
    assert.equal(d.disposed, true);
});

test('E-Hentai resolves every gallery overview page in correct image order', async () => {
    const details = galleryDoc();
    const second = doc({ many: { '#gdt a': [elem({ attrs: { href: img3 } })] } });
    const { source, calls } = create('ehentai.js', {
        requests: { [gallery]: html('detail'), [gallery + '?p=1']: html('page-two') },
        documents: { '<html:detail>': details, '<html:page-two>': second }
    });
    const images = await source.comic.loadEp(gallery, null);
    assert.deepEqual(Array.from(images.images), [img1, img2, img3]);
    assert.ok(calls.some(call => call.url === gallery + '?p=1'));
});

test('E-Hentai lazy full-image resolution caches URLs and retries on image failure', async () => {
    const d1 = doc({ one: { '#img': elem({ attrs: { src: 'https://i.test.invalid/42.webp' } }) } });
    const d2 = doc({ one: { '#img': elem({ attrs: { src: 'https://i.test.invalid/43.webp' } }) } });
    let count = 0;
    const { source } = create('ehentai.js', {
        requests: { [img1]: () => html(++count === 1 ? 'img1' : 'img2') },
        documents: { '<html:img1>': d1, '<html:img2>': d2 }
    });
    const loaded = await source.comic.onImageLoad(img1, gallery, null);
    assert.equal(loaded.url, 'https://i.test.invalid/42.webp');
    assert.equal(loaded.headers.Referer, img1);
    const cached = await source.comic.onImageLoad(img1, gallery, null);
    assert.equal(cached.url, loaded.url);
    assert.equal(count, 1);
    const retry = await loaded.onLoadFailed();
    assert.equal(retry.url, 'https://i.test.invalid/43.webp');
    assert.equal(count, 2);
});

test('E-Hentai gallery thumbnails expose page URLs and navigation tokens', async () => {
    const d = galleryDoc();
    const { source } = create('ehentai.js', {
        requests: { [gallery]: html('gallery') }, documents: { '<html:gallery>': d }
    });
    const result = await source.comic.loadThumbnails(gallery, null);
    assert.deepEqual(Array.from(result.urls), [img1, img2]);
    assert.equal(result.thumbnails[0], 'https://ehgt.org/preview1.jpg');
    assert.equal(result.next, '1');
});

test('E-Hentai ExHentai switch preserves gallery IDs and changes request host', async () => {
    const d = galleryDoc();
    const { source, calls } = create('ehentai.js', {
        settings: { domain: 'exhentai.org' },
        requests: { 'https://exhentai.org/g/2345/abcde/': html('gallery') },
        documents: { '<html:gallery>': d }
    });
    assert.equal(source.comic.link.linkToId('https://exhentai.org/g/2345/abcde/'), gallery);
    assert.equal((await source.comic.loadInfo(gallery)).title, 'Gallery Example');
    assert.equal(calls[0].url, 'https://exhentai.org/g/2345/abcde/');
});

test('E-Hentai cookie-based login and favorites use the expected operations', async () => {
    const favDoc = doc({ many: { 'div.fp': [elem({ text: 'Show All Favorites' }),
        elem({ children: [elem(), elem(), elem({ text: 'Folder A' })] })] } });
    const forumDoc = doc({ one: { '#userlinks .home, #userlinks p.home': elem() } });
    const { source, calls } = create('ehentai.js', {
        requests: {
            'https://forums.e-hentai.org/': html('forum'),
            'https://e-hentai.org/favorites.php': html('favorites'),
            'https://e-hentai.org/gallerypopups.php?gid=2345&t=abcde&act=addfav': html('success')
        },
        documents: { '<html:forum>': forumDoc, '<html:favorites>': favDoc }
    });
    assert.equal(await source.account.loginWithCookies.validate(['id', 'hash', '', '']), true);
    const folders = await source.favorites.loadFolders(null);
    assert.equal(folders.folders['0'], 'Folder A');
    assert.equal(await source.favorites.addOrDelFavorite(gallery, '0', true), true);
    assert.equal(await source.favorites.addOrDelFavorite(gallery, '0', false), true);
    assert.deepEqual(calls.filter(c => c.method === 'POST').map(c => c.body), [
        'favcat=0&favnote=&apply=Add+to+Favorites&update=1',
        'favcat=favdel&favnote=&apply=Apply+Changes&update=1'
    ]);
});

test('E-Hentai rejects cross-origin navigation and invalid image pages', async () => {
    const { source } = create('ehentai.js', {
        requests: { 'https://e-hentai.org/': { status: 429, body: '' } }
    });
    assert.equal(source.comic.link.linkToId('https://example.invalid/g/2345/abcde/'), null);
    await assert.rejects(() => source.comic.onImageLoad('https://example.invalid/s/key/2345-1'), /Unexpected E-Hentai/);
    await assert.rejects(() => source.explore[0].loadNext(null), /HTTP 429/);
    assert.throws(() => source.siteUrl('https://e-hentai.org.example.invalid/g/2345/abcde/'), /outside the selected site/);
});

test('E-Hentai thumbnail-style listing without glink uses the direct anchor title', async () => {
    const album = elem({ attrs: { href: gallery }, text: 'Thumbnail-only title' });
    const thumbnail = elem({
        text: '12 pages',
        many: { a: [album], img: [elem({ attrs: { src: 'https://ehgt.org/cover2.webp' } })],
            '.gt, .gtl': [] }
    });
    const { source } = create('ehentai.js', {
        requests: { 'https://e-hentai.org/': html('thumb-no-glink') },
        documents: { '<html:thumb-no-glink>': doc({ many: {
            'table.itg tr': [], 'div.gl1t': [thumbnail] } }) }
    });
    const list = await source.explore[0].loadNext(null);
    assert.equal(list.comics[0].title, 'Thumbnail-only title');
});

test('E-Hentai favorite folder ID is preserved from known gallery sprite metadata', async () => {
    const d = galleryDoc();
    d.querySelector = s => s === '#fav > div'
        ? elem({ attrs: { style: 'background-position:0px -40px;' } })
        : (s === '#favoritelink' ? elem({ text: 'Remove from Favorites' })
            : galleryDoc().querySelector(s));
    const folderPage = doc({ many: { 'div.fp': [elem({ children: [elem(), elem(),
        elem({ text: 'Folder A' })] }), elem({ children: [elem(), elem(), elem({ text: 'Folder B' })] }),
        elem({ children: [elem(), elem(), elem({ text: 'Folder C' })] })] } });
    const { source } = create('ehentai.js', {
        requests: { [gallery]: html('favorite-gallery'),
            'https://e-hentai.org/favorites.php': html('favorite-folders') },
        documents: { '<html:favorite-gallery>': d,
            '<html:favorite-folders>': folderPage }
    });
    const result = await source.favorites.loadFolders(gallery);
    assert.deepEqual(Array.from(result.favorited), ['2']);
    assert.equal(result.folders['2'], 'Folder C');
});

test('E-Hentai listing never follows an untrusted next link', async () => {
    const { source } = create('ehentai.js', {
        requests: { 'https://e-hentai.org/': html('evil-next') },
        documents: { '<html:evil-next>': listDoc([], 'https://evil.example/steal') }
    });
    const result = await source.explore[0].loadNext(null);
    assert.equal(result.next, null);
});

test('nhentai search accepts punctuation after correct URL encoding', async () => {
    const endpoint = nh + '/search?query=' + encodeURIComponent("artist:o'brien~test") + '&page=1&sort=date';
    const { source } = create('nhentai.js', { requests: { [endpoint]: json({ result: [], num_pages: 1 }) } });
    assert.equal((await source.search.load("artist:o'brien~test", ['date'], 1)).maxPage, 1);
});
