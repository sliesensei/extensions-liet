import {
    Chapter,
    ChapterDetails,
    ContentRating,
    HomeSection,
    Manga,
    MangaStatus,
    MangaTile,
    MangaUpdates,
    PagedResults,
    Response,
    SearchRequest,
    Section,
    Source,
    SourceInfo,
    TagSection,
    TagType,
} from "paperback-extensions-common";

import {parseLangCode} from "./Languages";

import {getKomgaAPI, getOptions, getServerUnavailableMangaTiles,} from "./Common";

export const PaperbackInfo: SourceInfo = {
    version: "0.1",
    name: "RaijinScans",
    icon: "icon.png",
    author: "Lïet | Davy",
    // authorWebsite: "https://github.com/FramboisePi",
    description: "Raijin Scans extension for Paperback",
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: "https://komga.org",
    sourceTags: [
        {
            text: "Self hosted",
            type: TagType.RED,
        },
    ],
};

const SUPPORTED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
];

// Number of items requested for paged requests
const PAGE_SIZE = 40;

export const parseMangaStatus = (komgaStatus: string): MangaStatus => {
    switch (komgaStatus) {
        case "ENDED":
            return MangaStatus.COMPLETED;
        case "ONGOING":
            return MangaStatus.ONGOING;
        case "ABANDONED":
            return MangaStatus.ONGOING;
        case "HIATUS":
            return MangaStatus.ONGOING;
    }
    return MangaStatus.ONGOING;
};

export const capitalize = (tag: string): string => {
    return tag.replace(/^\w/, (c) => c.toUpperCase());
};

export class Paperback extends Source {
    stateManager = createSourceStateManager({});

    requestManager = createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
    });

    override async getSourceMenu(): Promise<Section> {
        return createSection({
            id: "main",
            header: "Source Settings",
            rows: async () => [
                // serverSettingsMenu(this.stateManager),
                // testServerSettingsMenu(this.stateManager, this.requestManager),
                // resetSettingsButton(this.stateManager),
            ],
        });
    }

    override async getTags(): Promise<TagSection[]> {
        return [];
    }

    async getMangaDetails(mangaId: string): Promise<Manga> {
        const request = createRequestObject({
            url: `https://raijinscans.fr/manga/${mangaId}`,
            method: "GET",
        });
        const response = await this.requestManager.schedule(request, 1);
        const $ = this.cheerio.load(response.data)
        const title: string = $('h1').text() || ''
        const imageUrl: string = $('.summary_image img').attr('data-src') || ''

        return createManga({
            id: mangaId,
            titles: [title],
            image: imageUrl,
            status: MangaStatus.COMPLETED,
            // langFlag: metadata.language,
            // Unused: langName

            // artist: artists.join(", "),
            // author: authors.join(", "),

            // desc: metadata.summary ? metadata.summary : booksMetadata.summary,
            // tags: tagSections,
            // lastUpdate: metadata.lastModified,
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = createRequestObject({
            url: `https://raijinscans.fr/manga/${mangaId}`,
            method: "GET",
        });
        const response = await this.requestManager.schedule(request, 1);
        const $ = this.cheerio.load(response.data)
        const domArray = $('.listing-chapters_wrap .wp-manga-chapter').toArray()
        const chapters = []
        let i = 0

        for (const obj of domArray) {
            chapters.push(
                createChapter({
                    id: `${domArray.length - i}`,
                    mangaId: mangaId,
                    chapNum: domArray.length - i,
                    name: `Ch. ${domArray.length - i}`,
                    // @ts-ignore
                    sortingIndex: domArray.length - i
                })
            );
            i++
        }

        return chapters;
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const komgaAPI = await getKomgaAPI(this.stateManager);

        const request = createRequestObject({
            url: `${komgaAPI}/books/${chapterId}/pages`,
            method: "GET",
        });

        const data = await this.requestManager.schedule(request, 1);
        const result =
            typeof data.data === "string" ? JSON.parse(data.data) : data.data;

        const pages: string[] = [];
        for (const page of result) {
            if (SUPPORTED_IMAGE_TYPES.includes(page.mediaType)) {
                pages.push(`intercept*${komgaAPI}/books/${chapterId}/pages/${page.number}`);
            } else {
                pages.push(
                    `intercept*${komgaAPI}/books/${chapterId}/pages/${page.number}?convert=png`
                );
            }
        }

        // Determine the preferred reading direction which is only available in the serie metadata
        const serieRequest = createRequestObject({
            url: `${komgaAPI}/series/${mangaId}`,
            method: "GET",
        });

        const serieResponse = await this.requestManager.schedule(serieRequest, 1);
        const serieResult =
            typeof serieResponse.data === "string"
                ? JSON.parse(serieResponse.data)
                : serieResponse.data;

        let longStrip = false;
        if (
            ["VERTICAL", "WEBTOON"].includes(serieResult.metadata.readingDirection)
        ) {
            longStrip = true;
        }

        return createChapterDetails({
            id: chapterId,
            longStrip: longStrip,
            mangaId: mangaId,
            pages: pages,
        });
    }

    override async getSearchResults(searchQuery: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 0;
        let searchString: string = encodeURIComponent(searchQuery.title ?? "");

        const request = createRequestObject({
            url: `https://raijinscans.fr/`,
            method: "GET",
            param: `?s=${searchString}&post_type=wp-manga`,
        });

        // We don't want to throw if the server is unavailable
        let data: Response;
        try {
            data = await this.requestManager.schedule(request, 1);
        } catch (error) {
            console.log(`searchRequest failed with error: ${error}`);
            return createPagedResults({results: getServerUnavailableMangaTiles()});
        }

        const tiles = [];
        const $ = this.cheerio.load(data.data)
        const domArray = $('.search-wrap .c-tabs-item > .c-tabs-item__content').toArray()

        for(let obj of domArray) {
            let idString = $('.tab-summary .post-title a', $(obj)).attr('href');
            let idArr = idString?.split('/')
            let id: string | undefined;
            if (idString?.endsWith('/')) {
                idArr?.pop()
                id = idArr?.pop()
            } else {
                id = idArr?.pop()
            }

            tiles.push(
                createMangaTile({
                    id: id || '',
                    title: createIconText({ text: $('.tab-summary .post-title a', $(obj)).text() || '' }),
                    image: $('.tab-thumb img', $(obj)).attr('data-src') || '',
                })
            );
        }

        // metadata = tiles.length === 0 ? undefined : { page: page + 1 };
        return createPagedResults({
            results: tiles,
            metadata: undefined,
        });
    }

    override async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        // This function is called on the homepage and should not throw if the server is unavailable

        // We won't use `await this.getKomgaAPI()` as we do not want to throw an error on
        // the homepage when server settings are not set
        const komgaAPI = await getKomgaAPI(this.stateManager);
        const { showOnDeck, showContinueReading } = await getOptions(this.stateManager);


        if (komgaAPI === null) {
            console.log("searchRequest failed because server settings are unset");
            const section = createHomeSection({
                id: "unset",
                title: "Go to source settings to set your Komga server credentials.",
                view_more: false,
                items: getServerUnavailableMangaTiles(),
            });
            sectionCallback(section);
            return;
        }

        // The source define two homepage sections: new and latest
        const sections = [];

        if (showOnDeck) {
            sections.push(createHomeSection({
                id: 'ondeck',
                title: 'On Deck',
                view_more: false,
            }));
        }

        if (showContinueReading) {
            sections.push(createHomeSection({
                id: 'continue',
                title: 'Continue Reading',
                view_more: false,
            }));
        }

        sections.push(createHomeSection({
            id: 'new',
            title: 'Recently added series',
            //type: showRecentFeatured ? HomeSectionType.featured : HomeSectionType.singleRowNormal,
            view_more: true,
        }));
        sections.push(createHomeSection({
            id: 'updated',
            title: 'Recently updated series',
            view_more: true,
        }));
        const promises: Promise<void>[] = [];

        for (const section of sections) {
            // Let the app load empty tagSections
            sectionCallback(section);

            let apiPath: string, thumbPath: string, params: string, idProp: string;
            switch (section.id) {
                case 'ondeck':
                    apiPath = `${komgaAPI}/books/${section.id}`;
                    thumbPath = `${komgaAPI}/books`;
                    params = '?page=0&size=20&deleted=false';
                    idProp = 'seriesId';
                    break;
                case 'continue':
                    apiPath = `${komgaAPI}/books`;
                    thumbPath = `${komgaAPI}/books`;
                    params = '?sort=readProgress.readDate,desc&read_status=IN_PROGRESS&page=0&size=20&deleted=false';
                    idProp = 'seriesId';
                    break;
                default:
                    apiPath = `${komgaAPI}/series/${section.id}`;
                    thumbPath = `${komgaAPI}/series`;
                    params = '?page=0&size=20&deleted=false';
                    idProp = 'id';
                    break;
            }

            const request = createRequestObject({
                url: apiPath,
                param: params,
                method: "GET",
            });

            // Get the section data
            promises.push(
                this.requestManager.schedule(request, 1).then((data) => {
                    const result =
                        typeof data.data === "string" ? JSON.parse(data.data) : data.data;

                    const tiles = [];

                    for (const serie of result.content) {
                        tiles.push(
                            createMangaTile({
                                id: serie[idProp],
                                title: createIconText({ text: serie.metadata.title }),
                                image: `${thumbPath}/${serie.id}/thumbnail`,
                            })
                        );
                    }
                    section.items = tiles;
                    sectionCallback(section);
                })
            );
        }

        // Make sure the function completes
        await Promise.all(promises);
    }

    override async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const komgaAPI = await getKomgaAPI(this.stateManager);
        const page: number = metadata?.page ?? 0;

        const request = createRequestObject({
            url: `${komgaAPI}/series/${homepageSectionId}`,
            param: `?page=${page}&size=${PAGE_SIZE}&deleted=false`,
            method: "GET",
        });

        const data = await this.requestManager.schedule(request, 1);
        const result =
            typeof data.data === "string" ? JSON.parse(data.data) : data.data;

        const tiles: MangaTile[] = [];
        for (const serie of result.content) {
            tiles.push(
                createMangaTile({
                    id: serie.id,
                    title: createIconText({ text: serie.metadata.title }),
                    image: `${komgaAPI}/series/${serie.id}/thumbnail`,
                })
            );
        }

        // If no series were returned we are on the last page
        metadata = tiles.length === 0 ? undefined : { page: page + 1 };

        return createPagedResults({
            results: tiles,
            metadata: metadata,
        });
    }

    override async filterUpdatedManga(mangaUpdatesFoundCallback: (updates: MangaUpdates) => void, time: Date, ids: string[]): Promise<void> {
        const komgaAPI = await getKomgaAPI(this.stateManager);

        // We make requests of PAGE_SIZE titles to `series/updated/` until we got every titles
        // or we got a title which `lastModified` metadata is older than `time`
        let page = 0;
        const foundIds: string[] = [];
        let loadMore = true;

        while (loadMore) {
            const request = createRequestObject({
                url: `${komgaAPI}/series/updated`,
                param: `?page=${page}&size=${PAGE_SIZE}&deleted=false`,
                method: "GET",
            });

            const data = await this.requestManager.schedule(request, 1);
            const result =
                typeof data.data === "string" ? JSON.parse(data.data) : data.data;

            for (const serie of result.content) {
                const serieUpdated = new Date(serie.metadata.lastModified);

                if (serieUpdated >= time) {
                    if (ids.includes(serie)) {
                        foundIds.push(serie);
                    }
                } else {
                    loadMore = false;
                    break;
                }
            }

            // If no series were returned we are on the last page
            if (result.content.length === 0) {
                loadMore = false;
            }

            page = page + 1;

            if (foundIds.length > 0) {
                mangaUpdatesFoundCallback(
                    createMangaUpdates({
                        ids: foundIds,
                    })
                );
            }
        }
    }
}
