// E-Hentai adapter for VeneraNext (QuickJS extension API).
// Listing formats, search filters and gallery pagination follow venera-app/venera-configs.
// No bypass of authentication, throttling, access controls, or image quotas.
class EHentaiSource extends ComicSource {
    name = "E-Hentai";
    key = "ehentai"; // Preserve previously installed source identity.
    version = "2.1.0";
    minAppVersion = "1.16.0";
    url = "https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/ehentai.js";

    settings = {
        domain: {
            title: "Domain", type: "select", default: "e-hentai.org",
            options: [{ value: "e-hentai.org", text: "E-Hentai" },
                { value: "exhentai.org", text: "ExHentai (account required)" }]
        }
    };

    translation = {
        zh_CN: {
            "Domain": "站点域名", "Latest galleries": "最新画廊", "Popular galleries": "热门画廊",
            "Watched galleries": "订阅更新", "Category": "类型", "Language": "语言",
            "Minimum rating": "最低评分", "Rankings": "排行榜", "Yesterday": "昨日",
            "Month": "本月", "Year": "今年", "All time": "全部",
            "Chinese": "中文", "English": "英语", "Japanese": "日语"
        },
        zh_TW: {
            "Domain": "站點網域", "Latest galleries": "最新畫廊", "Popular galleries": "熱門畫廊",
            "Watched galleries": "訂閱更新", "Category": "類型", "Language": "語言",
            "Minimum rating": "最低評分", "Rankings": "排行榜", "Yesterday": "昨日",
            "Month": "本月", "Year": "今年", "All time": "全部",
            "Chinese": "中文", "English": "英語", "Japanese": "日語"
        },
        en: {}
    };

    get baseUrl() {
        return this.loadSetting("domain") === "exhentai.org" ? "https://exhentai.org" : "https://e-hentai.org";
    }

    // Both gallery domains share IDs and gallery tokens; keep the old E-H URL as a stable ID.
    galleryId(raw) {
        const value = String(raw || "").trim();
        const m = value.match(/^(?:https?:\/\/(?:www\.)?(?:e-hentai|exhentai)\.org)?(\/g\/(\d+)\/([a-z0-9]+)\/?)(?:[?#].*)?$/i);
        if (!m) throw new Error("Invalid E-Hentai gallery URL");
        return "https://e-hentai.org/g/" + m[2] + "/" + m[3] + "/";
    }

    galleryUrl(id) { return this.baseUrl + this.galleryId(id).slice("https://e-hentai.org".length); }

    galleryParts(id) {
        const match = this.galleryId(id).match(/\/g\/(\d+)\/([a-z0-9]+)\//i);
        return { id: match[1], token: match[2] };
    }

    absolute(raw, from = this.baseUrl + "/") {
        const href = String(raw || "").trim().replace(/&amp;/g, "&");
        if (!href || href.startsWith("#") || /^(?:javascript|data|blob|file|about):/i.test(href)) return "";
        if (/^https?:\/\//i.test(href)) return href;
        if (href.startsWith("//")) return "https:" + href;
        const parsed = String(from).match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/i);
        const root = parsed ? parsed[1] : this.baseUrl;
        const pathname = parsed && parsed[2] ? parsed[2] : "/";
        if (href.startsWith("/")) return root + href;
        if (href.startsWith("?")) return root + pathname + href;
        const parent = pathname.slice(0, pathname.lastIndexOf("/") + 1);
        return root + parent + href.replace(/^\.\//, "");
    }

    isSiteUrl(value) {
        return /^https:\/\/(?:e-hentai\.org|exhentai\.org)(?:\/|$)/i.test(String(value || ""));
    }

    siteUrl(raw) {
        const url = this.absolute(raw);
        if (!this.isSiteUrl(url)) throw new Error("E-Hentai page URL is outside the selected site");
        return url;
    }

    async html(raw) {
        const url = this.siteUrl(raw);
        const response = await Network.get(url, {
            Accept: "text/html,application/xhtml+xml",
            Referer: this.baseUrl + "/"
        });
        if (response.status !== 200) {
            const hint = response.status === 403 ? " (restricted or login needed)" :
                response.status === 429 ? " (rate limited)" : "";
            throw new Error("E-Hentai: HTTP " + response.status + hint);
        }
        const body = String(response.body || "");
        // Without a permitted ExHentai session the server may return HTTP 200
        // with a completely empty document instead of an HTTP error.
        if (url.includes("exhentai.org") &&
            (!body.trim() || /<body\b[^>]*>\s*<\/body>/i.test(body))) {
            throw new Error("ExHentai is blank: login or access permission required");
        }
        if (!body.trim().startsWith("<")) {
            const hint = /IP|ban|limit/i.test(body) ? " (IP quota or restriction)" : "";
            throw new Error("E-Hentai returned a non-HTML response" + hint);
        }
        if (/<title>\s*(?:Just a moment|Attention Required|Access Denied)/i.test(body)) {
            throw new Error("E-Hentai returned an access challenge; check your network or login");
        }
        return new HtmlDocument(body);
    }

    parseListRow(row) {
        const anchors = row.querySelectorAll("a");
        const album = anchors.find(a => /\/g\/\d+\/[a-z0-9]+/i.test(String(a.attributes?.href || "")));
        if (!album) return null;
        let id;
        try { id = this.galleryId(this.absolute(album.attributes.href)); }
        catch (_) { return null; }
        const titleNode = row.querySelector(".glink");
        const titleAnchor = anchors.find(a => (a.querySelector(".glink") || a.attributes?.title) &&
            /\/g\/\d+\/[a-z0-9]+/i.test(String(a.attributes?.href || "")));
        const readableAlbum = anchors.find(a =>
            /\/g\/\d+\/[a-z0-9]+/i.test(String(a.attributes?.href || "")) &&
            String(a.text || "").trim());
        // Thumbnail layout often uses <a> text directly, without a .glink node.
        const title = String(titleNode?.text || titleAnchor?.attributes?.title ||
            titleAnchor?.text || readableAlbum?.text || "").trim();
        if (!title) return null;
        const imgs = row.querySelectorAll("img");
        const img = imgs.find(e => /(?:https?:)?\/\/|^data:/.test(e.attributes?.src || "") ||
            e.attributes?.["data-src"]) || imgs[0];
        const rawCover = img?.attributes?.["data-src"] || img?.attributes?.src || "";
        const cover = /^data:/i.test(rawCover) ? "" : this.absolute(rawCover);
        const tags = row.querySelectorAll(".gt, .gtl")
            .map(e => e.attributes?.title || e.text).filter(Boolean);
        const lang = tags.find(t => /^language:(?!translated)/i.test(t));
        const text = String(row.text || "");
        const count = text.match(/\b(\d+)\s+pages?\b/i);
        const published = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        return new Comic({
            id, title, subtitle: "", cover, tags,
            language: lang ? lang.split(":")[1].trim() : "",
            maxPage: count ? Number(count[1]) : 0,
            description: published ? published[1] : ""
        });
    }

    async listing(raw) {
        const url = this.siteUrl(raw);
        const document = await this.html(url);
        try {
            // Account settings can select compact, thumbnail, extended or minimal layouts.
            const rows = document.querySelectorAll("table.itg tr")
                .concat(document.querySelectorAll("div.gl1t"));
            const seen = new Set();
            const comics = [];
            for (const row of rows) {
                const item = this.parseListRow(row);
                if (!item || seen.has(item.id)) continue;
                seen.add(item.id);
                comics.push(item);
            }
            const href = document.querySelector("a#dnext")?.attributes?.href || "";
            const next = href ? this.absolute(href, url) : "";
            return { comics, next: next && this.isSiteUrl(next) && next !== url ? next : null };
        } finally {
            document.dispose();
        }
    }

    searchOptions = [
        { label: "Category", type: "multi-select", options: [
            "0-Misc", "1-Doujinshi", "2-Manga", "3-Artist CG", "4-Game CG",
            "5-Image Set", "6-Cosplay", "7-Asian Porn", "8-Non-H", "9-Western"
        ], default: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
        { label: "Minimum rating", type: "dropdown", options: [
            "-Any", "2-2", "3-3", "4-4", "5-5"
        ] },
        { label: "Language", type: "dropdown", options: [
            "-Any", "chinese-Chinese", "english-English", "japanese-Japanese"
        ] }
    ];

    buildSearchUrl(keyword, options) {
        const choices = Array.isArray(options) ? options : [];
        let selected;
        try {
            selected = typeof choices[0] === "string" ? JSON.parse(choices[0]) : choices[0];
        } catch (_) { selected = null; }
        if (!Array.isArray(selected)) selected = Array.from({ length: 10 }, (_, n) => String(n));
        const allowed = new Set(selected.map(String).filter(x => /^(?:[0-9])$/.test(x)));
        let excludedMask = 0;
        for (let i = 0; i < 10; i++) if (!allowed.has(String(i))) excludedMask |= 1 << i;
        let term = String(keyword || "").trim();
        const lang = ["chinese", "english", "japanese"].includes(choices[2]) ? choices[2] : "";
        if (lang && !/(?:^|\s)language:/i.test(term)) term += " language:" + lang;
        let url = this.baseUrl + "/?f_search=" + encodeURIComponent(term);
        if (excludedMask) url += "&f_cats=" + excludedMask;
        if (["2", "3", "4", "5"].includes(choices[1])) url += "&f_srdd=" + choices[1];
        return url;
    }

    explore = [
        { title: "Latest galleries", type: "multiPageComicList",
            loadNext: async next => this.listing(next || this.baseUrl + "/") },
        { title: "Popular galleries", type: "multiPageComicList",
            loadNext: async next => this.listing(next || this.baseUrl + "/popular") },
        { title: "Watched galleries", type: "multiPageComicList",
            loadNext: async next => this.listing(next || this.baseUrl + "/watched") }
    ];

    search = {
        optionList: this.searchOptions,
        loadNext: async (keyword, options, next) => this.listing(next || this.buildSearchUrl(keyword, options)),
        enableTagsSuggestions: true
    };

    category = { title: "E-Hentai", parts: [], enableRankingPage: true };
    categoryComics = {
        ranking: {
            options: ["15-Yesterday", "13-Month", "12-Year", "11-All time"],
            load: async (option, page) => {
                const code = ["15", "13", "12", "11"].includes(option) ? option : "11";
                const currentPage = Math.max(1, Number(page) || 1);
                const result = await this.listing(this.baseUrl + "/toplist.php?tl=" + code + "&p=" + (currentPage - 1));
                return { comics: result.comics, maxPage: 200 };
            }
        }
    };

    account = {
        loginWithWebview: {
            url: "https://forums.e-hentai.org/index.php?act=Login&CODE=00",
            checkStatus: (url, title) => /^https:\/\/forums\.e-hentai\.org\//i.test(url) &&
                !/[?&]act=Login(?:&|$)/i.test(url) && /E-Hentai Forums/i.test(title || ""),
            onLoginSuccess: async () => {
                // E-H and ExH are separate cookie domains. Forward forum session cookies to ExH.
                const cookies = await Network.getCookies("https://forums.e-hentai.org");
                if (!Array.isArray(cookies)) return;
                const allowed = ["ipb_member_id", "ipb_pass_hash", "igneous", "star"];
                const share = cookies.filter(c => c && allowed.includes(c.name) && c.value)
                    .map(c => new Cookie({ name: c.name, value: c.value, domain: ".exhentai.org" }));
                if (share.length) await Network.setCookies("https://exhentai.org", share);
            }
        },
        loginWithCookies: {
            fields: ["ipb_member_id", "ipb_pass_hash", "igneous", "star"],
            validate: async values => {
                if (!Array.isArray(values) || values.length !== 4 || !values[0] || !values[1]) return false;
                for (const host of ["e-hentai.org", "exhentai.org"]) {
                    const cookies = values.map((value, i) => ({ name: this.account.loginWithCookies.fields[i], value }))
                        .filter(c => c.value)
                        .map(c => new Cookie({ ...c, domain: "." + host }));
                    await Network.setCookies("https://" + host, cookies);
                }
                const response = await Network.get("https://forums.e-hentai.org/", {});
                if (response.status !== 200) return false;
                const document = new HtmlDocument(response.body);
                try { return Boolean(document.querySelector("#userlinks .home, #userlinks p.home")); }
                finally { document.dispose(); }
            }
        },
        logout: () => {
            for (const site of ["https://e-hentai.org", "https://exhentai.org", "https://forums.e-hentai.org"])
                Network.deleteCookies(site);
        }
    };

    async readInfo(rawId) {
        const id = this.galleryId(rawId);
        const document = await this.html(this.galleryUrl(id));
        try {
            const title = String(document.querySelector("#gn")?.text || "").trim();
            if (!title) throw new Error("E-Hentai gallery metadata unavailable (login, layout or access issue)");
            const subtitle = String(document.querySelector("#gj")?.text || "").trim();
            const style = String(document.querySelector("#gd1 div")?.attributes?.style || "");
            const styleUrl = style.match(/https?:\/\/[^\s'"\)]+/i);
            const coverSrc = styleUrl ? styleUrl[0] : document.querySelector("#gd1 img")?.attributes?.src || "";
            const tags = {};
            for (const row of document.querySelectorAll("#taglist tr")) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) continue;
                const group = String(cells[0].text || "").trim().replace(/[:：]$/, "").toLowerCase();
                if (!group) continue;
                const names = cells[cells.length - 1].querySelectorAll("a")
                    .map(a => String(a.text || "").trim()).filter(Boolean);
                if (names.length) tags[group] = names;
            }
            const category = String(document.querySelector(".cs")?.text || "").trim();
            if (category) tags.category = [category];
            const uploader = String(document.querySelector("#gdn a")?.text || "").trim();
            if (uploader) tags.uploader = [uploader];
            const meta = document.querySelectorAll("#gdd tr").map(row => row.text || "").join(" ");
            const count = meta.match(/\b(\d+)\s+pages?\b/i);
            const date = meta.match(/\b(\d{4}-\d{2}-\d{2})\b/);
            const ratingText = String(document.querySelector("#rating_label")?.text || "");
            const rating = ratingText.match(/(?:average|rating)\s*:\s*(\d+(?:\.\d+)?)/i);
            const favoriteText = document.querySelector("#favoritelink")?.text || "";
            const isFavorite = favoriteText ? !/add to favorites/i.test(favoriteText) : false;
            // The favorite-folder sprite can be on #fav itself or a child.
            const favStyle = String(document.querySelector("#fav")?.attributes?.style ||
                document.querySelector("#fav > div")?.attributes?.style || "");
            const pos = favStyle.match(/background-position:\s*0px\s+-(\d+)px/i);
            const folderIndex = pos ? (Number(pos[1]) - 2) / 19 : -1;
            const thumbs = this.galleryThumbnailPairs(document, id).thumbnails;
            const info = {
                title, subtitle, cover: this.absolute(coverSrc), tags,
                chapters: null, maxPage: count ? Number(count[1]) : 0,
                updateTime: date ? date[1] : "", uploadTime: date ? date[1] : "",
                isFavorite, thumbnails: thumbs, url: id
            };
            if (rating) info.stars = Math.min(5, Number(rating[1]));
            const result = new ComicDetails(info);
            if (Number.isInteger(folderIndex) && folderIndex >= 0 && folderIndex <= 9)
                result.favoriteFolder = String(folderIndex);
            return result;
        } finally { document.dispose(); }
    }

    // Gallery overview pages usually contain 20/40 clickable /s/ links per page.
    async imagePageUrls(rawId) {
        const id = this.galleryUrl(rawId);
        const seen = new Set();
        const pages = [];
        const pushPages = document => {
            for (const link of document.querySelectorAll("#gdt a")) {
                const value = this.absolute(link.attributes?.href || "", id);
                if (!/^https:\/\/(?:e-hentai\.org|exhentai\.org)\/s\/[a-z0-9]+\/\d+-\d+/i.test(value)) continue;
                if (!seen.has(value)) { seen.add(value); pages.push(value); }
            }
        };
        const first = await this.html(id);
        let last = 0;
        try {
            pushPages(first);
            for (const a of first.querySelectorAll("table.ptb a")) {
                const href = String(a.attributes?.href || "");
                const match = href.match(/[?&]p=(\d+)/);
                if (match) last = Math.max(last, Number(match[1]));
            }
        } finally { first.dispose(); }
        if (last > 199) throw new Error("E-Hentai gallery index exceeded supported pagination limit");
        for (let index = 1; index <= last; index++) {
            const document = await this.html(id + "?p=" + index);
            try { pushPages(document); }
            finally { document.dispose(); }
        }
        if (!pages.length) throw new Error("E-Hentai gallery contains no readable image-page links");
        return pages;
    }

    // Inspected 2026-10-13: #gdt is often the gt200 *container* and each
    // anchor has a background-image sprite div, not an img or .gdtm descendant.
    // Parse each anchor as one image to preserve page order and sprite offsets.
    galleryThumbnailPairs(document, galleryUrl) {
        const urls = [];
        const thumbnails = [];
        const fallbackImages = document.querySelectorAll("#gdt img");
        const anchors = document.querySelectorAll("#gdt a");
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            const pageUrl = this.absolute(anchor.attributes?.href || "", galleryUrl);
            if (!/^https:\/\/(?:e-hentai\.org|exhentai\.org)\/s\/[a-z0-9]+\/\d+-\d+/i.test(pageUrl)) continue;
            urls.push(pageUrl);
            const image = anchor.querySelector("img") || fallbackImages[i];
            let thumb = this.absolute(image?.attributes?.["data-src"] || image?.attributes?.src || "", galleryUrl);
            if (/^data:/i.test(thumb)) thumb = "";
            if (!thumb) {
                const css = String(anchor.querySelector("div")?.attributes?.style || "");
                const background = css.match(/url\(\s*['"]?(https?:\/\/[^)'"\s]+)['"]?\s*\)/i);
                const position = css.match(/\)\s*(-?\d+)px\s+(-?\d+)(?:px)?(?:\s|;|$)/i);
                const width = css.match(/width\s*:\s*(\d+)px/i);
                const height = css.match(/height\s*:\s*(\d+)px/i);
                if (background && position && width && height) {
                    const x = Math.max(0, -Number(position[1]));
                    const y = Math.max(0, -Number(position[2]));
                    const w = Number(width[1]);
                    const h = Number(height[1]);
                    if (w > 0 && h > 0) thumb = background[1] +
                        "@x=" + x + "-" + (x + w) + "&y=" + y + "-" + (y + h);
                }
            }
            if (thumb) thumbnails.push(thumb);
        }
        return { urls, thumbnails };
    }

    async loadThumbnails(rawId, next) {
        const id = this.galleryUrl(rawId);
        const p = next == null ? 0 : Math.max(0, Number(next) || 0);
        const document = await this.html(id + (p ? "?p=" + p : ""));
        try {
            const { urls, thumbnails } = this.galleryThumbnailPairs(document, id);
            const nav = document.querySelectorAll("table.ptb a").map(a => String(a.attributes?.href || ""));
            const hasNext = nav.some(link => {
                const m = link.match(/[?&]p=(\d+)/);
                return m && Number(m[1]) > p;
            });
            return { thumbnails, urls, next: hasNext ? String(p + 1) : null };
        } finally { document.dispose(); }
    }

    imageCache = {};
    async resolveImage(imageKey, bypassCache = false) {
        const url = this.absolute(imageKey);
        if (!/^https:\/\/(?:e-hentai\.org|exhentai\.org)\/s\/[a-z0-9]+\/\d+-\d+(?:\/|[?#]|$)/i.test(url)) {
            throw new Error("Unexpected E-Hentai image page URL");
        }
        const existing = this.imageCache[url];
        if (!bypassCache && existing && Date.now() - existing.at < 5 * 60 * 1000) return existing.config;
        const document = await this.html(url);
        try {
            const image = document.querySelector("#img") || document.querySelector("#i3 img");
            const src = image?.attributes?.["data-src"] || image?.attributes?.src || "";
            if (!/^https?:\/\//i.test(src) && !src.startsWith("//")) {
                throw new Error("E-Hentai image unavailable (possible quota or permission restriction)");
            }
            const config = { url: this.absolute(src), headers: { Referer: url } };
            if (Object.keys(this.imageCache).length >= 200) this.imageCache = {};
            this.imageCache[url] = { at: Date.now(), config };
            return config;
        } finally { document.dispose(); }
    }

    favorites = {
        multiFolder: true, singleFolderForSingleComic: true,
        loadFolders: async comicId => {
            const document = await this.html(this.baseUrl + "/favorites.php");
            try {
                const folders = { "-1": "All favorites" };
                let index = 0;
                for (const node of document.querySelectorAll("div.fp")) {
                    if (/show all favorites/i.test(node.text || "")) continue;
                    const name = String(node.children?.[2]?.text || "").trim();
                    if (name && index < 10) folders[String(index++)] = name;
                }
                const favorited = [];
                if (comicId) {
                    const info = await this.readInfo(comicId);
                    if (info.isFavorite && info.favoriteFolder != null)
                        favorited.push(info.favoriteFolder);
                }
                return { folders, favorited };
            } finally { document.dispose(); }
        },
        loadNext: async (next, folder) => {
            const code = folder != null && /^\d$/.test(String(folder)) ? String(folder) : "";
            const start = this.baseUrl + "/favorites.php" + (code ? "?favcat=" + code : "");
            return this.listing(next || start);
        },
        addOrDelFavorite: async (rawId, folder, isAdding) => {
            const { id, token } = this.galleryParts(rawId);
            const endpoint = this.baseUrl + "/gallerypopups.php?gid=" + id +
                "&t=" + encodeURIComponent(token) + "&act=addfav";
            const code = folder != null && /^\d$/.test(String(folder)) ? String(folder) : "0";
            const body = isAdding
                ? "favcat=" + code + "&favnote=&apply=Add+to+Favorites&update=1"
                : "favcat=favdel&favnote=&apply=Apply+Changes&update=1";
            const response = await Network.post(endpoint, {
                "Content-Type": "application/x-www-form-urlencoded", Referer: this.galleryUrl(rawId)
            }, body);
            if (response.status !== 200 || !String(response.body || "").includes("<")) {
                throw new Error("E-Hentai favorite change failed (HTTP " + response.status + ")");
            }
            const bodyText = String(response.body || "");
            if (/<p[^>]*class=["'][^"']*\bbr\b/i.test(bodyText))
                throw new Error("E-Hentai rejected the favorite update");
            return true;
        }
    };

    comic = {
        loadInfo: async id => this.readInfo(id),
        loadEp: async (id, epId) => ({ images: await this.imagePageUrls(id) }),
        loadThumbnails: async (id, next) => this.loadThumbnails(id, next),
        onImageLoad: async imageKey => {
            const config = await this.resolveImage(imageKey);
            return { ...config, onLoadFailed: async () => this.resolveImage(imageKey, true) };
        },
        onThumbnailLoad: imageKey => ({
            url: imageKey, headers: { Referer: this.baseUrl + "/" }
        }),
        onClickTag: (namespace, tag) => {
            const type = String(namespace || "tag").toLowerCase();
            const name = String(tag || "").replace(/"/g, "").trim();
            if (!name) return null;
            const categories = ["misc", "doujinshi", "manga", "artist cg", "game cg",
                "image set", "cosplay", "asian porn", "non-h", "western"];
            if (type === "category") {
                const i = categories.indexOf(name.toLowerCase());
                if (i >= 0) return {
                    page: "search", attributes: { text: "", options: [JSON.stringify([String(i)]), "", ""] }
                };
            }
            const exact = name.includes(" ") ? '"' + name + '"' : name;
            return { page: "search", attributes: { text: type + ":" + exact } };
        },
        enableTagsTranslate: true,
        link: {
            domains: ["e-hentai.org", "exhentai.org"],
            linkToId: url => {
                try { return this.galleryId(url); }
                catch (_) { return null; }
            }
        }
    };
}
