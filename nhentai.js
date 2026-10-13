// VeneraNext comic source: nhentai.net
// This extension contains no comics, images, cookies, or account credentials.
class NhentaiSource extends ComicSource {
    name = "nhentai";
    key = "nhentai";
    version = "1.0.0";
    minAppVersion = "1.16.0";
    url = "https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/nhentai.js";

    baseUrl = "https://nhentai.net";
    apiUrl = "https://nhentai.net/api/v2";

    settings = {
        apiKey: {
            title: "Optional API key",
            type: "input",
            default: ""
        }
    };

    headers() {
        const result = { Accept: "application/json" };
        const apiKey = String(this.loadSetting("apiKey") || "").trim();
        if (apiKey) result.Authorization = "Key " + apiKey;
        return result;
    }

    async request(path) {
        const response = await Network.get(this.apiUrl + path, this.headers());
        if (response.status !== 200) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("nhentai API denied access (HTTP " + response.status + "). Check site access and credentials.");
            }
            throw new Error("nhentai API error: HTTP " + response.status);
        }
        try {
            const data = JSON.parse(response.body);
            if (!data || typeof data !== "object") throw new Error("Invalid response");
            return data;
        } catch (_) {
            throw new Error("nhentai API returned invalid JSON. The site may be unavailable or showing a challenge.");
        }
    }

    media(value, thumbnail) {
        const path = typeof value === "object" && value ? value.path : value;
        if (typeof path !== "string" || !path.trim()) return "";
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith("//")) return "https:" + path;
        const host = thumbnail ? "https://t3.nhentai.net" : "https://i3.nhentai.net";
        return host + "/" + path.replace(/^\/+/, "");
    }

    idOf(raw) {
        const value = String(raw || "").trim();
        const match = value.match(/(?:^|\/g\/)(\d+)(?:\/|$)/);
        const id = match ? match[1] : value;
        if (!/^\d+$/.test(id)) throw new Error("Invalid nhentai gallery ID");
        return id;
    }

    listItem(item) {
        const title = item.title || {};
        const sourceTags = Array.isArray(item.tags) ? item.tags : [];
        const tags = sourceTags.map(t => t && t.name).filter(Boolean);
        const languageTag = sourceTags.find(t => t && t.type === "language");
        return new Comic({
            id: String(item.id),
            title: typeof title === "string" ? title : (item.english_title || title.pretty || title.english || title.japanese || String(item.id)),
            cover: this.media(item.thumbnail || item.cover, true),
            subtitle: "",
            tags: tags,
            language: languageTag ? languageTag.name : "",
            maxPage: Number(item.num_pages) || 0
        });
    }

    async list(path) {
        const payload = await this.request(path);
        const rows = Array.isArray(payload.result) ? payload.result : (Array.isArray(payload) ? payload : []);
        return {
            comics: rows.filter(item => item && item.id != null).map(item => this.listItem(item)),
            maxPage: Math.max(1, Number(payload.num_pages) || 1)
        };
    }

    dateOf(value) {
        if (value == null || value === "") return "";
        const date = new Date(typeof value === "number" ? value * 1000 : value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    }

    explore = [{
        title: "Latest uploads",
        type: "multiPageComicList",
        load: async page => this.list("/galleries?page=" + Math.max(1, Number(page) || 1))
    }];

    search = {
        optionList: [{
            label: "Sort",
            type: "select",
            options: [
                "date-Recent",
                "popular-Popular",
                "popular-today-Popular today",
                "popular-week-Popular this week",
                "popular-month-Popular this month"
            ],
            default: "date"
        }],
        load: async (keyword, options, page) => {
            const allowed = ["date", "popular", "popular-today", "popular-week", "popular-month"];
            const sort = options && allowed.includes(options[0]) ? options[0] : "date";
            const query = String(keyword || "").trim() || "*";
            return this.list("/search?query=" + encodeURIComponent(query) +
                "&page=" + Math.max(1, Number(page) || 1) + "&sort=" + sort);
        }
    };

    comic = {
        loadInfo: async rawId => {
            const id = this.idOf(rawId);
            const data = await this.request("/galleries/" + id);
            const title = data.title || {};
            const name = title.pretty || title.english || title.japanese || data.english_title || id;
            const groups = {};
            for (const tag of (Array.isArray(data.tags) ? data.tags : [])) {
                if (!tag || !tag.name) continue;
                const group = String(tag.type || "tag").toLowerCase();
                if (!groups[group]) groups[group] = [];
                groups[group].push(String(tag.name));
            }
            const pages = Array.isArray(data.pages) ? data.pages : [];
            const thumbnails = pages.map(page => this.media(page.thumbnail, true)).filter(Boolean);
            const updateTime = this.dateOf(data.upload_date);
            return new ComicDetails({
                title: String(name),
                subtitle: title.english && title.english !== name ? title.english : "",
                cover: this.media(data.cover || data.thumbnail, true),
                tags: groups,
                chapters: null,
                maxPage: Number(data.num_pages) || pages.length,
                thumbnails: thumbnails,
                updateTime: updateTime,
                uploadTime: updateTime,
                url: this.baseUrl + "/g/" + id + "/"
            });
        },
        loadEp: async (rawId, epId) => {
            const id = this.idOf(rawId);
            const data = await this.request("/galleries/" + id);
            const pages = Array.isArray(data.pages) ? data.pages : [];
            const images = pages.map(page => this.media(page.path, false)).filter(Boolean);
            if (!images.length) throw new Error("nhentai gallery has no readable image paths");
            return { images: images };
        },
        onImageLoad: imageKey => ({
            url: imageKey,
            headers: { Referer: "https://nhentai.net/" }
        }),
        onThumbnailLoad: imageKey => ({
            url: imageKey,
            headers: { Referer: "https://nhentai.net/" }
        }),
        link: {
            domains: ["nhentai.net"],
            linkToId: value => {
                const match = String(value || "").match(/^https?:\/\/(?:www\.)?nhentai\.net\/g\/(\d+)(?:\/|$)/i);
                return match ? match[1] : null;
            }
        }
    };
}