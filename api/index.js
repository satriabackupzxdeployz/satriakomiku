const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://komiku.org/";

const getAbsoluteUrl = (relativePath) => {
    try {
        if (!relativePath) return 'N/A';
        if (relativePath.startsWith('http')) return relativePath;
        return new URL(relativePath, BASE_URL).href;
    } catch {
        return relativePath;
    }
};

async function downloadImageMetadata(imgUrl) {
    try {
        const response = await axios.head(imgUrl, { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

async function scrapeKomikuSearch(keyword) {
    const url = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(keyword)}`;
    try {
        const { data } = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(data);
        const mangas = [];
        
        $('.bge').each((i, el) => {
            const bgei = $(el).find('.bgei > a');
            const href = bgei.attr('href');
            if (!href) return;
            
            const manga = {
                href: href.startsWith('http') ? href : `https://komiku.org${href}`,
                url: href.startsWith('http') ? href : `https://komiku.org${href}`,
                thumbnail: bgei.find('img').attr('src'),
                title: $(el).find('.kan > a > h3').text().trim(),
                type: bgei.find('b').text().trim(),
                genre: bgei.find('.tpe1_inf').text().trim().replace(bgei.find('b').text().trim(), '').trim(),
                last_update: $(el).find('.kan > p').text().trim()
            };
            mangas.push(manga);
        });
        
        return mangas;
    } catch {
        return [];
    }
}

async function getAllEpisodes(comicUrl, pageLimit = 5) {
    const episodes = [];
    let pageNum = 1;
    let hasMorePages = true;
    let pageCount = 0;

    while (hasMorePages && pageCount < pageLimit) {
        try {
            const pageUrl = pageNum === 1 ? comicUrl : `${comicUrl}?page=${pageNum}`;
            const { data } = await axios.get(pageUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 10000
            });
            
            const $ = cheerio.load(data);
            const selectors = ['#Daftar_Chapter tbody tr', '.chapter-list tr', '.episode-list .episode'];
            
            let foundEpisodes = 0;
            for (const selector of selectors) {
                if ($(selector).length > 0) {
                    $(selector).each((i, el) => {
                        if (i === 0 && $(el).find('th').length > 0) return;
                        
                        const chapterLinkElement = $(el).find('td.judulseries a, .chapter-title a, a');
                        const chapterTitle = chapterLinkElement.find('span').text().trim() || chapterLinkElement.text().trim();
                        const relativeChapterLink = chapterLinkElement.attr('href');
                        
                        if (chapterTitle && relativeChapterLink) {
                            const chapterLink = getAbsoluteUrl(relativeChapterLink);
                            if (!episodes.find(ep => ep.link === chapterLink)) {
                                episodes.push({
                                    title: chapterTitle,
                                    link: chapterLink,
                                    url: chapterLink,
                                    views: $(el).find('td.pembaca i, .views').text().trim() || 'N/A',
                                    release_date: $(el).find('td.tanggalseries, .date').text().trim() || 'N/A'
                                });
                                foundEpisodes++;
                            }
                        }
                    });
                    break;
                }
            }
            
            if (foundEpisodes === 0) hasMorePages = false;
            else pageNum++;
            pageCount++;
            
        } catch (error) {
            hasMorePages = false;
        }
    }
    
    return episodes;
}

async function getComicDetails(comicUrl) {
    try {
        const { data } = await axios.get(comicUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 15000
        });
        
        const $ = cheerio.load(data);
        const details = {
            url: comicUrl,
            title: $('h1 span[itemprop="name"]').text().trim() || 'N/A',
            title_indonesian: $('p.j2').text().trim() || 'N/A',
            short_description: $('p[itemprop="description"]').text().trim() || 'Tidak ada deskripsi',
            full_synopsis: $('section#Sinopsis p').first().text().trim() || 'Tidak ada sinopsis',
            genres: [],
            metaInfo: {},
            episodes: [],
            thumbnail_url: $('img[itemprop="image"]').attr('src') || '',
            rating: 4.5,
            views: 'N/A'
        };

        $('ul.genre li.genre a span[itemprop="genre"]').each((i, el) => {
            details.genres.push($(el).text().trim());
        });

        $('.inftable tr').each((i, el) => {
            const label = $(el).find('td').first().text().trim();
            const value = $(el).find('td').eq(1).text().trim();
            if (label === 'Pengarang') details.metaInfo.author = value;
            else if (label === 'Status') details.metaInfo.status = value;
            else if (label === 'Jenis Komik') details.metaInfo.type = value;
        });

        details.episodes = await getAllEpisodes(comicUrl, 3);
        
        return details;
    } catch (error) {
        return null;
    }
}

async function getComicsbyType(type) {
    try {
        const url = `https://komiku.org/?order=update&search_type=${type}`;
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        
        const $ = cheerio.load(data);
        const comics = [];
        
        $('.bge').each((i, el) => {
            if (i >= 30) return;
            const bgei = $(el).find('.bgei > a');
            const href = bgei.attr('href');
            if (!href) return;
            
            comics.push({
                url: href.startsWith('http') ? href : `https://komiku.org${href}`,
                title: $(el).find('.kan > a > h3').text().trim(),
                genre: bgei.find('.tpe1_inf').text().trim().replace(bgei.find('b').text().trim(), '').trim(),
                thumbnail: bgei.find('img').attr('src'),
                last_update: $(el).find('.kan > p').text().trim()
            });
        });
        
        return comics;
    } catch {
        return [];
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);

    try {
        if (pathname === '/api/search') {
            const q = searchParams.get('q');
            if (!q) return res.status(400).json({ error: 'Query required' });
            
            const results = await scrapeKomikuSearch(q);
            return res.status(200).json(results);
        }

        if (pathname === '/api/detail') {
            const url = searchParams.get('url');
            if (!url) return res.status(400).json({ error: 'URL required' });
            
            const details = await getComicDetails(url);
            if (!details) return res.status(404).json({ error: 'Not found' });
            return res.status(200).json(details);
        }

        if (pathname === '/api/manga') {
            const comics = await getComicsbyType('manga');
            return res.status(200).json(comics);
        }

        if (pathname === '/api/manhwa') {
            const comics = await getComicsbyType('manhwa');
            return res.status(200).json(comics);
        }

        if (pathname === '/api/manhua') {
            const comics = await getComicsbyType('manhua');
            return res.status(200).json(comics);
        }

        return res.status(404).json({ error: 'Endpoint not found' });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
};const