// VeneraNext comic source: e-hentai.org
// The extension reads public gallery listings and pages; it does not bypass access controls.
class EHentaiSource extends ComicSource {
    name = "E-Hentai";
    key = "ehentai";
    version = "1.0.0";
    minAppVersion = "1.16.0";
    url = "https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/ehentai.js";

    baseUrl = "https://e-hentai.org";

    absolute(href) {
        if (typeof href !== "string" || !href) return "";
        if (/^https?:\/\//i.test(href)) return href;
        if (href.startsWith("//")) return "https:" + href;
        if (href.startsWith("/")) return this.baseUrl + href;
        return this.baseUrl + "/" + href;
    }

    galleryId(raw) {
        const match = String(raw || "").match(/^(?:https?:\/\/(?:www\.)?e-hentai\.org)?(\/g\/\d+\/[a-z0-9]+\/?)(?:[?#].*)?$/i);
        if (!match) throw new Error("Invalid E-Hentai gallery URL");
        return this.baseUrl + match[1].replace(/\/?$/, "/");
    }

    async html(url) {
        const response = await Network.get(url, {
            Accept: "text/html",
            Referer: this.baseUrl + "/"
        });
        if (response.status !== 200) {
            throw new Error("E-Hentai request failed (HTTP " + response.status + "). Check site access and login status.");
        }
        if (!response.body || !response.body.includes("<")) {
            throw new Error("E-Hentai did not return HTML. Access may be blocked or rate-limited.");
        }
        return new HtmlDocument(response.body);
    }

    parseListRow(element) {
        const links = element.querySelectorAll("a");
        const anchor = links.find(link => /\/g\/\d+\/[a-z0-9]+/i.test(link.attributes?.href || ""));
        if (!anchor) return null;
        let id;
        try { id = this.galleryId(this.absolute(anchor.attributes.href)); }
        catch (_) { return null; }
        const titleElement = element.querySelector(".glink");
        const title = String(titleElement?.text || anchor.attributes?.title || anchor.text || "").trim();
        if (!title) return null;
        const image = element.querySelector("img");
        const rawCover = image?.attributes?.["data-src"] || image?.attributes?.["src"] || "";
        const cover = rawCover.startsWith("data:") ? "" : this.absolute(rawCover);
        const tags = element.querySelectorAll(".gt, .gtl").map(tag => tag.attributes?.title || tag.text).filter(Boolean);
        const match = String(element.text || "").match(/(\d+)\s+pages?\b/i);
        return new Comic({
            id: id,
            title: title,
            cover: cover,
            subtitle: "",
            tags: tags,
            maxPage: match ? Number(match[1]) : 0
        });
    }

    async listing(url) {
        const document = await this.html(url);
        try {
            const entries = document.querySelectorAll("table.itg tr").concat(document.querySelectorAll("div.gl1t"));
            const seen = new Set();
            const comics = [];
            for (const entry of entries) {
                const item = this.parseListRow(entry);
                if (!item || seen.has(item.id)) continue;
                seen.add(item.id);
                comics.push(item);
            }
            const nextHref = document.querySelector("a#dnext")?.attributes?.href || "";
            const next = nextHref ? this.absolute(nextHref.startsWith("?") ? url.split("?")[0] + nextHref : nextHref) : null;
            const validNext = next && /^https:\/\/e-hentai\.org\//i.test(next) && next !== url;
            return { comics: comics, next: validNext ? next : null };
        } finally {
            document.dispose();
        }
    }

    explore = [
        {
            title: "Latest galleries",
            type: "multiPageComicList",
            loadNext: async next => this.listing(next || this.baseUrl + "/")
        },
        {
            title: "Popular galleries",
            type: "multiPageComicList",
            loadNext: async next => this.listing(next || this.baseUrl + "/popular")
        }
    ];

    search = {
        optionList: [],
        loadNext: async (keyword, options, next) => {
            const first = this.baseUrl + "/?f_search=" + encodeURIComponent(String(keyword || "").trim());
            return this.listing(next || first);
        }
    };

    async readInfo(rawId) {
        const id = this.galleryId(rawId);
        const document = await this.html(id);
        try {
            const title = String(document.querySelector("#gn")?.text || "").trim();
            if (!title) throw new Error("E-Hentai gallery details are unavailable");
            const subtitle = String(document.querySelector("#gj")?.text || "").trim();
            const coverStyle = String(document.querySelector("#gd1 div")?.attributes?.style || "");
            const coverMatch = coverStyle.match(/url\(\s*['\"]?(https?:\/\/[^\s)'\"]+)/i);
            const imgCover = document.querySelector("#gd1 img")?.attributes?.src || "";
            const cover = this.absolute(coverMatch ? coverMatch[1] : imgCover);
            const groups = {};
            for (const row of document.querySelectorAll("#taglist tr")) {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) continue;
                const group = String(cells[0].text || "").replace(/:\s*$/, "").trim().toLowerCase();
                if (!group) continue;
                const values = cells[cells.length - 1].querySelectorAll("a")
                    .map(node => String(node.text || "").trim()).filter(Boolean);
                if (values.length) groups[group] = values;
            }
            const metaRows = document.querySelectorAll("#gdd tr").map(row => String(row.text || ""));
            const allMeta = metaRows.join(" ");
            const pageMatch = allMeta.match(/(\d+)\s+pages?\b/i);
            const dateMatch = allMeta.match(/\b(\d{4}-\d{2}-\d{2})\b/);
            const count = pageMatch ? Number(pageMatch[1]) : 0;
            const date = dateMatch ? dateMatch[1] : "";
            return new ComicDetails({
                title: title,
                subtitle: subtitle,
                cover: cover,
                tags: groups,
                chapters: null,
                maxPage: count,
                updateTime: date,
                uploadTime: date,
                url: id
            });
        } finally {
            document.dispose();
        }
    }

    async imagePageUrls(rawId) {
        const id = this.galleryId(rawId);
        const first = await this.html(id);
        let totalIndexPages = 1;
        const collect = document => document.querySelectorAll("#gdt a")
            .map(a => a.attributes?.href || "")
            .filter(href => /\/s\/[a-z0-9]+\/\d+-\d+/i.test(href))
            .map(href => this.absolute(href));
        const seen = new Set();
        const images = [];
        const append = urls => {
            for (const value of urls) {
                if (!seen.has(value)) { seen.add(value); images.push(value); }
            }
        };
        try {
            append(collect(first));
            for (const link of first.querySelectorAll("table.ptb a")) {
                const href = link.attributes?.href || "";
                const pageMatch = href.match(/[?&]p=(\d+)/);
                if (pageMatch) totalIndexPages = Math.max(totalIndexPages, Number(pageMatch[1]) + 1);
            }
        } finally {
            first.dispose();
        }
        if (totalIndexPages > 200) {
            throw new Error("E-Hentai gallery has too many index pages for this source");
        }
        for (let p = 1; p < totalIndexPages; p++) {
            const document = await this.html(id + "?p=" + p);
            try { append(collect(document)); }
            finally { document.dispose(); }
        }
        if (images.length === 0) throw new Error("No readable E-Hentai image pages found");
        return images;
    }

    async resolveImage(imagePageUrl) {
        const target = this.absolute(imagePageUrl);
        if (!/^https?:\/\/(?:www\.)?e-hentai\.org\/s\//i.test(target)) {
            throw new Error("Unexpected E-Hentai image page URL");
        }
        const document = await this.html(target);
        try {
            const image = document.querySelector("img#img");
            const src = image?.attributes?.src || "";
            if (!/^https?:\/\//i.test(src) && !src.startsWith("//")) {
                throw new Error("E-Hentai image URL unavailable. Check site access or image limits.");
            }
            return {
                url: this.absolute(src),
                headers: { Referer: target }
            };
        } finally {
            document.dispose();
        }
    }

    comic = {
        loadInfo: async id => this.readInfo(id),
        loadEp: async (id, epId) => ({ images: await this.imagePageUrls(id) }),
        onImageLoad: async imageKey => this.resolveImage(imageKey),
        onThumbnailLoad: imageKey => ({
            url: imageKey,
            headers: { Referer: "https://e-hentai.org/" }
        }),
        link: {
            domains: ["e-hentai.org"],
            linkToId: value => {
                try { return this.galleryId(value); }
                catch (_) { return null; }
            }
        }
    };
}