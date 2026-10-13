// nhentai.net adapter for VeneraNext (QuickJS extension API).
// Upstream API behavior informed by venera-app/venera-configs/nhentai.js.
// No bundled content or credentials. Remote availability is site-dependent.
class NhentaiSource extends ComicSource {
    name = "nhentai";
    key = "nhentai"; // Keep stable for reading history and saved comics.
    version = "2.1.0";
    minAppVersion = "1.16.0";
    url = "https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/nhentai.js";

    baseUrl = "https://nhentai.net";
    apiUrl = "https://nhentai.net/api/v2";

    settings = {
        apiKey: { title: "API Key (optional)", type: "input", default: "" }
    };

    translation = {
        zh_CN: {
            "Latest uploads": "最新上传", "Popular today": "今日热门", "Popular galleries": "热门作品",
            "Rankings": "排行榜", "Languages": "语言", "Chinese": "中文", "English": "英语",
            "Japanese": "日语", "Sort": "排序", "Language": "语言", "Recent": "最新",
            "Popular all time": "全部热门", "Popular this week": "本周热门",
            "Popular this month": "本月热门", "API Key (optional)": "API 密钥（可选）"
        },
        zh_TW: {
            "Latest uploads": "最新上傳", "Popular today": "今日熱門", "Popular galleries": "熱門作品",
            "Rankings": "排行榜", "Languages": "語言", "Chinese": "中文", "English": "英語",
            "Japanese": "日語", "Sort": "排序", "Language": "語言", "Recent": "最新",
            "Popular all time": "全部熱門", "Popular this week": "本週熱門",
            "Popular this month": "本月熱門", "API Key (optional)": "API 金鑰（選填）"
        },
        en: {}
    };

    account = {
        loginWithWebview: {
            url: "https://nhentai.net/login",
            checkStatus: (url, title) => /^https:\/\/nhentai\.net\//i.test(url) &&
                !/\/(?:login|register)(?:\/|\?|$)/i.test(url) && /nhentai/i.test(title || ""),
            onLoginSuccess: async () => { await this.refreshAccessToken(); }
        },
        logout: () => {
            this.deleteData("accessToken");
            Network.deleteCookies(this.baseUrl);
        },
        registerWebsite: "https://nhentai.net/register/"
    };

    async refreshAccessToken() {
        if (typeof Network.getCookies !== "function") return "";
        const cookies = await Network.getCookies(this.baseUrl);
        const preferred = ["access_token", "__Secure-access_token", "__Host-access_token"];
        const candidate = Array.isArray(cookies) ? cookies.find(c => c &&
            preferred.includes(c.name) && typeof c.value === "string" && c.value) : null;
        const token = candidate ? candidate.value : "";
        if (token) this.saveData("accessToken", token);
        return token;
    }

    async headers(authenticated = false) {
        const result = { Accept: "application/json", "User-Agent": "Venera/1.0" };
        const apiKey = String(this.loadSetting("apiKey") || "").trim();
        if (apiKey) {
            result.Authorization = "Key " + apiKey;
        } else if (authenticated) {
            const token = await this.refreshAccessToken() || this.loadData("accessToken");
            if (token) result.Authorization = "User " + token;
        }
        return result;
    }

    async request(path, method = "GET", authenticated = false) {
        if (!path.startsWith("/") || path.startsWith("//") || /[\\#\r\n]/.test(path))
            throw new Error("Invalid nhentai API path");
        const headers = await this.headers(authenticated);
        const endpoint = this.apiUrl + path;
        const response = method === "GET"
            ? await Network.get(endpoint, headers)
            : method === "POST" ? await Network.post(endpoint, headers, "")
                : method === "DELETE" ? await Network.delete(endpoint, headers)
                    : null;
        if (!response) throw new Error("Unsupported nhentai request method");
        if ((response.status < 200 || response.status >= 300)) {
            const suffix = response.status === 401 ? " (login or API key required)"
                : response.status === 403 ? " (access denied / possible challenge)"
                    : response.status === 429 ? " (rate limited; retry later)" : "";
            throw new Error("nhentai API: HTTP " + response.status + suffix);
        }
        if (response.status === 204 || !String(response.body || "").trim()) return {};
        try {
            const payload = JSON.parse(response.body);
            if (!payload || typeof payload !== "object") throw new Error("invalid payload");
            if (payload.error) throw new Error("nhentai API rejected request: " + String(payload.error));
            return payload;
        } catch (error) {
            if (String(error.message || error).startsWith("nhentai API rejected")) throw error;
            throw new Error("nhentai API did not return JSON (possible site/API change or challenge)");
        }
    }

    media(value, thumbnail = false) {
        const path = value && typeof value === "object" ? value.path || value.url : value;
        if (typeof path !== "string" || !path.trim()) return "";
        let result = path.trim();
        if (result.startsWith("//")) result = "https:" + result;
        if (!/^https?:\/\//i.test(result)) {
            result = (thumbnail ? "https://t3.nhentai.net/" : "https://i3.nhentai.net/") + result.replace(/^\/+/, "");
        }
        return result.replace(/(\.(?:jpe?g|png|webp|gif))(?:\.(?:jpe?g|png|webp|gif))+(?=\?|$)/gi, "$1");
    }

    idOf(raw) {
        const value = String(raw == null ? "" : raw).trim();
        const match = value.match(/^(?:https?:\/\/(?:www\.)?nhentai\.net\/g\/)?(?:nhentai|nh)?(\d+)\/?(?:[?#].*)?$/i);
        if (!match) throw new Error("Invalid nhentai gallery ID");
        return match[1];
    }

    toComic(item) {
        if (!item || item.id == null) return null;
        const title = item.title && typeof item.title === "object" ? item.title : {};
        const tags = Array.isArray(item.tags) ? item.tags : [];
        // Actual API v2 list responses expose tag_ids, not full tag objects.
        // The language IDs are stable source identifiers, not guessed from titles.
        const tagIds = Array.isArray(item.tag_ids) ? item.tag_ids.map(Number) : [];
        const language = tags.find(tag => tag && tag.type === "language")?.name ||
            (tagIds.includes(12227) ? "english" : tagIds.includes(6346) ? "japanese" :
                tagIds.includes(29963) ? "chinese" : "");
        return new Comic({
            id: String(item.id),
            title: String(item.english_title || (typeof item.title === "string" ? item.title :
                title.pretty || title.english || title.japanese) || String(item.id)),
            subtitle: "",
            cover: this.media(item.thumbnail || item.cover, true),
            tags: tags.map(t => t && t.name).filter(Boolean),
            language: language,
            maxPage: Math.max(0, Number(item.num_pages) || 0)
        });
    }

    toComicList(payload) {
        const rows = Array.isArray(payload) ? payload :
            (Array.isArray(payload.result) ? payload.result :
                (Array.isArray(payload.galleries) ? payload.galleries : []));
        const comics = rows.map(item => this.toComic(item)).filter(Boolean);
        const maxPage = Math.max(1, Number(payload.num_pages || payload.total_pages) || 1);
        return { comics, maxPage };
    }

    async listing(path) { return this.toComicList(await this.request(path)); }

    pageNumber(page) { return Math.max(1, Math.min(100000, Number(page) || 1)); }

    dateOf(value) {
        if (value == null || value === "") return "";
        const time = new Date(typeof value === "number" ? value * 1000 : value);
        return Number.isNaN(time.getTime()) ? "" : time.toISOString().slice(0, 10);
    }

    // Unlike the older full page scraper, API v2 can return stable paths and tags.
    explore = [
        {
            title: "Latest uploads", type: "multiPageComicList",
            load: async page => this.listing("/galleries?page=" + this.pageNumber(page))
        },
        {
            title: "Popular galleries", type: "multiPartPage",
            load: async () => {
                const data = await this.request("/galleries/popular");
                return [{ title: "Popular today", comics: this.toComicList(data).comics }];
            }
        }
    ];

    search = {
        optionList: [
            { label: "Sort", type: "select", default: "date", options: [
                "date-Recent", "popular-Popular all time", "popular-today-Popular today",
                "popular-week-Popular this week", "popular-month-Popular this month"
            ] },
            { label: "Language", type: "dropdown", options: [
                "-All", "chinese-Chinese", "english-English", "japanese-Japanese"
            ] }
        ],
        load: async (keyword, options, page) => {
            const validSorts = ["date", "popular", "popular-today", "popular-week", "popular-month"];
            const sort = options && validSorts.includes(options[0]) ? options[0] : "date";
            let term = String(keyword || "").trim() || "*";
            const language = options && ["chinese", "english", "japanese"].includes(options[1]) ? options[1] : "";
            if (language && !/(?:^|\s)language:/i.test(term)) term += " language:" + language;
            return this.listing("/search?query=" + encodeURIComponent(term) +
                "&page=" + this.pageNumber(page) + "&sort=" + sort);
        },
        enableTagsSuggestions: true
    };

    category = {
        title: "nhentai", enableRankingPage: true,
        parts: [{
            name: "Languages", type: "fixed",
            categories: [
                { label: "Chinese", target: { page: "search", attributes: { text: "language:chinese" } } },
                { label: "English", target: { page: "search", attributes: { text: "language:english" } } },
                { label: "Japanese", target: { page: "search", attributes: { text: "language:japanese" } } }
            ]
        }]
    };

    categoryComics = {
        ranking: {
            options: ["popular-today-Popular today", "popular-week-Popular this week",
                "popular-month-Popular this month", "popular-Popular all time"],
            load: async (option, page) => {
                const allowed = ["popular-today", "popular-week", "popular-month", "popular"];
                const sort = allowed.includes(option) ? option : "popular";
                return this.listing("/search?query=*&page=" + this.pageNumber(page) + "&sort=" + sort);
            }
        }
    };

    favorites = {
        multiFolder: false,
        addOrDelFavorite: async (rawId, folder, isAdding) => {
            const id = this.idOf(rawId);
            await this.request("/galleries/" + id + "/favorite", isAdding ? "POST" : "DELETE", true);
            return true;
        },
        loadComics: async page => this.toComicList(await this.request(
            "/favorites?page=" + this.pageNumber(page), "GET", true))
    };

    comic = {
        loadInfo: async rawId => {
            const id = this.idOf(rawId);
            const data = await this.request("/galleries/" + id + "?include=related,favorite", "GET", true);
            const title = data.title && typeof data.title === "object" ? data.title : {};
            const name = String(title.pretty || title.english || title.japanese || data.english_title || id);
            const tags = {};
            for (const tag of (Array.isArray(data.tags) ? data.tags : [])) {
                if (!tag || !tag.name) continue;
                const type = String(tag.type || "tag").toLowerCase();
                if (!tags[type]) tags[type] = [];
                tags[type].push(String(tag.name));
            }
            const pages = Array.isArray(data.pages) ? data.pages : [];
            const date = this.dateOf(data.upload_date);
            const related = (Array.isArray(data.related) ? data.related : []).map(item => this.toComic(item)).filter(Boolean);
            return new ComicDetails({
                title: name,
                subtitle: title.english && title.english !== name ? title.english : "",
                cover: this.media(data.cover || data.thumbnail, true),
                tags, chapters: null, maxPage: Math.max(Number(data.num_pages) || 0, pages.length),
                thumbnails: pages.map(page => this.media(page.thumbnail, true)).filter(Boolean),
                recommend: related, isFavorite: Boolean(data.is_favorited),
                updateTime: date, uploadTime: date,
                url: this.baseUrl + "/g/" + id + "/"
            });
        },
        loadEp: async (rawId, epId) => {
            const id = this.idOf(rawId);
            const data = await this.request("/galleries/" + id);
            const pages = Array.isArray(data.pages) ? data.pages : [];
            const images = pages.map(page => this.media(page.path, false)).filter(Boolean);
            if (!images.length) throw new Error("nhentai gallery has no usable image paths");
            return { images };
        },
        onImageLoad: imageKey => ({
            url: this.media(imageKey), headers: { Referer: this.baseUrl + "/" }
        }),
        onThumbnailLoad: imageKey => ({
            url: this.media(imageKey, true), headers: { Referer: this.baseUrl + "/" }
        }),
        onClickTag: (namespace, name) => {
            const allowed = ["artist", "character", "group", "parody", "category", "language", "tag"];
            const type = String(namespace || "tag").toLowerCase().replace(/s$/, "");
            const prefix = allowed.includes(type) ? type : "tag";
            const value = String(name || "").replace(/"/g, "").trim();
            if (!value) return null;
            return { page: "search", attributes: { text: prefix + ':"' + value + '"' } };
        },
        enableTagsTranslate: true,
        idMatch: "^(?:nh|nhentai)?[0-9]+$",
        link: {
            domains: ["nhentai.net"],
            linkToId: link => {
                const m = String(link || "").match(/^https?:\/\/(?:www\.)?nhentai\.net\/g\/(\d+)(?:\/?(?:[?#].*)?)$/i);
                return m ? m[1] : null;
            }
        }
    };
}
