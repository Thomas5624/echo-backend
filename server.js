import express from 'express';
import cors from 'cors';
import YTMusic from 'ytmusic-api';
import axios from 'axios';
import ytdl from '@distube/ytdl-core';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize YTMusic
const ytmusic = new YTMusic();
let isInitialized = false;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize YTMusic on startup
async function initializeYTMusic() {
    try {
        await ytmusic.initialize();
        isInitialized = true;
        console.log('✅ YTMusic API initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize YTMusic:', error.message);
        setTimeout(initializeYTMusic, 5000);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        ytmusicInitialized: isInitialized
    });
});

// ===== Shared Thumbnail Proxy Helpers =====
const proxyThumbnailUrl = (url, baseUrl) => {
    if (!url) return url;
    let upscaled = url;
    if (url.includes('lh3.googleusercontent.com')) {
        upscaled = url.replace(/=w\d+-h\d+(-p)?-l\d+-rj/, '=w500-h500$1-l90-rj');
    }
    if (url.includes('yt3.googleusercontent.com')) {
        upscaled = url.replace(/=s\d+/, '=s500');
    }
    return `${baseUrl}/api/proxy/image?url=${encodeURIComponent(upscaled)}`;
};

const processThumbnails = (thumbnails, baseUrl) => {
    if (!thumbnails || thumbnails.length === 0) return thumbnails;
    return thumbnails.map(t => ({
        ...t,
        url: proxyThumbnailUrl(t.url, baseUrl)
    }));
};

const processResults = (items, baseUrl) => {
    return items.map(item => {
        if ((!item.thumbnails || item.thumbnails.length === 0) && item.videoId) {
            item.thumbnails = [
                { url: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`, width: 320, height: 180 },
                { url: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`, width: 480, height: 360 }
            ];
        }
        item.thumbnails = processThumbnails(item.thumbnails, baseUrl);
        return item;
    });
};

const proxyAllThumbnails = (obj, baseUrl) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => proxyAllThumbnails(item, baseUrl));
    }
    const result = { ...obj };
    for (const key of Object.keys(result)) {
        if (key === 'thumbnails' && Array.isArray(result[key])) {
            result[key] = processThumbnails(result[key], baseUrl);
        } else if (typeof result[key] === 'object' && result[key] !== null) {
            result[key] = proxyAllThumbnails(result[key], baseUrl);
        }
    }
    return result;
};

// Search endpoint
app.post('/api/search', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({
                error: 'YTMusic not initialized yet. Please try again.'
            });
        }

        const { query, type = 'song' } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        console.log(`🔍 Searching for: ${query} (type: ${type})`);

        const baseUrl = `${req.protocol}://${req.get('host')}`;

        let results = [];

        if (type === 'all') {
            const [songs, albums, artists, playlists] = await Promise.all([
                ytmusic.searchSongs(query),
                ytmusic.searchAlbums(query),
                ytmusic.searchArtists(query),
                ytmusic.searchPlaylists(query)
            ]);

            res.json({
                success: true,
                results: {
                    songs: processResults(songs.slice(0, 10), baseUrl),
                    albums: processResults(albums.slice(0, 10), baseUrl),
                    artists: processResults(artists.slice(0, 10), baseUrl),
                    playlists: processResults(playlists.slice(0, 10), baseUrl)
                }
            });
            return;
        } else if (type === 'song' || type === 'video') {
            results = await ytmusic.searchSongs(query);
        } else if (type === 'album') {
            results = await ytmusic.searchAlbums(query);
        } else if (type === 'artist') {
            results = await ytmusic.searchArtists(query);
        } else if (type === 'playlist') {
            results = await ytmusic.searchPlaylists(query);
        } else {
            results = await ytmusic.search(query);
        }

        const processedResults = processResults(results, baseUrl);

        res.json({
            success: true,
            results: processedResults.slice(0, 20)
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// Get song details endpoint
app.get('/api/song/:videoId', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({
                error: 'YTMusic not initialized yet. Please try again.'
            });
        }

        const { videoId } = req.params;
        console.log(`📀 Getting song details for: ${videoId}`);

        const song = await ytmusic.getSong(videoId);

        res.json({
            success: true,
            song
        });
    } catch (error) {
        console.error('Get song error:', error);
        res.status(500).json({
            error: 'Failed to get song details',
            message: error.message
        });
    }
});

// Get stream URL endpoint
app.get('/api/stream/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        console.log(`🎵 Getting stream for: ${videoId}`);

        let query = '';
        try {
            const song = await ytmusic.getSong(videoId);
            console.log('📄 Song Metadata:', JSON.stringify(song, null, 2));

            let artistName = '';
            if (song.artist) {
                artistName = song.artist.name;
            } else if (song.artists && song.artists.length > 0) {
                artistName = song.artists[0].name;
            }

            query = `${song.name} ${artistName}`;
            console.log(`🔍 Resolved metadata: ${query}`);
        } catch (e) {
            console.warn(`⚠️ Failed to get metadata for ${videoId}, using videoId as fallback query`);
            query = videoId;
        }

        console.log(`🎯 Using YouTube as audio source`);
        
        const info = await ytdl.getInfo(videoId, {
            requestOptions: { clientName: 'ANDROID' }
        });
        
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
        const bestAudio = audioFormats[0];
        
        if (bestAudio) {
            console.log(`✅ Found audio format: ${bestAudio.container} - ${Math.round(bestAudio.bitrate/1000)}kbps`);
        }

        const ytStreamUrl = `${req.protocol}://${req.get('host')}/api/proxy/${videoId}`;

        return res.json({
            success: true,
            url: ytStreamUrl,
            quality: bestAudio ? `${Math.round(bestAudio.bitrate/1000)}kbps` : '128kbps',
            source: 'YouTube (ytdl-core)',
            title: info.videoDetails.title
        });

    } catch (error) {
        console.error('❌ Get stream error:', error);
        res.status(500).json({
            error: 'Failed to get stream URL',
            message: error.message
        });
    }
});

// Image Proxy Endpoint
app.get('/api/proxy/image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) {
        return res.status(400).send('URL required');
    }

    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(response.data));
    } catch (error) {
        console.error(`❌ Image proxy error: ${error.message}`);
        res.status(502).send('Failed to fetch image');
    }
});

// Proxy endpoint using ytdl-core
app.get('/api/proxy/:videoId', async (req, res) => {
    const { videoId } = req.params;
    console.log(`🎧 Proxying stream for: ${videoId}`);

    try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');

        const info = await ytdl.getInfo(videoId, {
            requestOptions: { clientName: 'ANDROID' }
        });

        const format = ytdl.chooseFormat(info.formats, {
            format: 'best[ext=mp4]/best',
            quality: 'highest'
        });

        if (!format) {
            return res.status(404).send('No suitable format found');
        }

        console.log(`🎵 Streaming: ${format.container} - ${format.bitrate}`);

        const stream = ytdl.downloadFromInfo(info, {
            format: format,
            requestOptions: { clientName: 'ANDROID' }
        });

        stream.on('error', (err) => {
            console.error(`❌ Stream error: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).send('Stream failed');
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error(`❌ Proxy error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send('Failed to proxy stream');
        }
    }
});

// Get artist details endpoint
app.get('/api/artist/:artistId', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({
                error: 'YTMusic not initialized yet. Please try again.'
            });
        }

        const { artistId } = req.params;
        console.log(`👤 Getting artist details for: ${artistId}`);

        const artist = await ytmusic.getArtist(artistId);

        if (artist) {
            if (!artist.songs && artist.topSongs) artist.songs = artist.topSongs;
            if (!artist.albums && artist.topAlbums) artist.albums = artist.topAlbums;
            if (!artist.singles && artist.topSingles) artist.singles = artist.topSingles;
            if (!artist.videos && artist.topVideos) artist.videos = artist.topVideos;
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const proxiedArtist = proxyAllThumbnails(artist, baseUrl);

        res.json({
            success: true,
            artist: proxiedArtist
        });
    } catch (error) {
        console.error('Get artist error:', error);
        res.status(500).json({
            error: 'Failed to get artist details',
            message: error.message
        });
    }
});

// Get album details endpoint
app.get('/api/album/:albumId', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({
                error: 'YTMusic not initialized yet. Please try again.'
            });
        }
        const { albumId } = req.params;
        const albumName = req.query.name;
        const artistName = req.query.artist;
        console.log(`💿 Getting album details for: ${albumId} (${albumName || 'unknown name'})`);

        let album;
        let fetchError;

        try {
            album = await ytmusic.getAlbum(albumId);
            console.log('✅ Album details fetched via getAlbum');
        } catch (e) {
            console.warn(`⚠️ getAlbum failed for ${albumId}: ${e.message}`);
            fetchError = e;
        }

        if ((!album || !album.songs || album.songs.length === 0) && (albumId.startsWith('OLAK5uy_') || albumId.startsWith('PL') || albumId.startsWith('VL'))) {
            console.log(`🔄 Attempting fallback to getPlaylistVideos for: ${albumId}`);
            try {
                const tracks = await ytmusic.getPlaylistVideos(albumId);
                if (tracks && tracks.length > 0) {
                    console.log(`✅ Successfully fetched ${tracks.length} tracks via getPlaylistVideos`);
                    if (!album) {
                        album = {
                            albumId: albumId,
                            name: albumName || 'Album',
                            tracks: tracks,
                            songs: tracks
                        };
                    } else {
                        album.tracks = tracks;
                        album.songs = tracks;
                    }
                }
            } catch (e2) {
                console.error(`❌ Fallback getPlaylistVideos also failed for ${albumId}: ${e2.message}`);
            }
        }

        if ((!album || !album.tracks || album.tracks.length === 0) && albumName) {
            console.log(`🔍 Desperation fallback: searching for album by name: ${albumName} ${artistName || ''}`);
            try {
                const searchResults = await ytmusic.searchAlbums(`${albumName} ${artistName || ''}`);
                const match = searchResults.find(r => r.name.toLowerCase() === albumName.toLowerCase() || r.playlistId === albumId);
                if (match && match.albumId && match.albumId !== albumId) {
                    console.log(`🎯 Found matching albumId: ${match.albumId}. Retrying getAlbum...`);
                    const recoveredAlbum = await ytmusic.getAlbum(match.albumId);
                    if (recoveredAlbum && recoveredAlbum.songs && recoveredAlbum.songs.length > 0) {
                        album = recoveredAlbum;
                        console.log(`✅ Recovered album tracks via name search!`);
                    }
                }
            } catch (e3) {
                console.error(`❌ Desperation search failed: ${e3.message}`);
            }
        }

        if (!album && fetchError) {
            throw fetchError;
        }

        if (!album) {
            return res.status(404).json({ error: 'Album not found' });
        }

        if (album.songs && !album.tracks) {
            album.tracks = album.songs;
        }

        console.log(`📀 Album "${album.name || album.title || 'Unknown'}" has ${album.tracks ? album.tracks.length : 0} tracks`);

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const proxiedAlbum = proxyAllThumbnails(album, baseUrl);

        res.json({
            success: true,
            album: proxiedAlbum
        });
    } catch (error) {
        console.error('Get album error:', error);
        res.status(500).json({
            error: 'Failed to get album details',
            message: error.message
        });
    }
});

// Get playlist details endpoint
app.get('/api/playlist/:playlistId', async (req, res) => {
    try {
        if (!isInitialized) {
            return res.status(503).json({
                error: 'YTMusic not initialized yet. Please try again.'
            });
        }

        const { playlistId } = req.params;
        console.log(`Cc Getting playlist details for: ${playlistId}`);

        const playlist = await ytmusic.getPlaylist(playlistId);

        try {
            const videos = await ytmusic.getPlaylistVideos(playlistId);
            playlist.tracks = videos;
        } catch (e) {
            console.warn('Failed to get playlist videos:', e.message);
            playlist.tracks = [];
        }

        res.json({
            success: true,
            playlist: proxyAllThumbnails(playlist, `${req.protocol}://${req.get('host')}`)
        });
    } catch (error) {
        console.error('Get playlist error:', error);
        res.status(500).json({
            error: 'Failed to get playlist details',
            message: error.message
        });
    }
});

// FLAC endpoint - disabled on Vercel
app.get('/api/download/flac', async (req, res) => {
    res.json({
        success: false,
        error: 'FLAC downloads unavailable on Vercel. Use local server for FLAC.'
    });
});

app.get('/api/download/flac/direct', async (req, res) => {
    res.json({
        success: false,
        error: 'FLAC downloads unavailable on Vercel. Use local server for FLAC.'
    });
});

// Export for Vercel
export default app;

// Start server (only for local development)
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`🚀 Echo YTMusic Proxy running on port ${PORT}`);
        initializeYTMusic();
    });
}

