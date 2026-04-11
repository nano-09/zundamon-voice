// src/lyrics_utils.js
import ytSearch from 'yt-search';
import { getLyricsFromCache, saveLyricsToCache } from './db_supabase.js';

/**
 * Extracts YouTube Video ID from various URL formats.
 */
function getYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Fetches lyrics for a song, utilizing the Supabase cache and multiple sources.
 * Includes a 1-week retry logic for "Not Found" results.
 */
export async function fetchLyrics(song) {
  const url = song.url;
  
  // 1. Check Cache
  const cached = await getLyricsFromCache(url);
  if (cached) {
    const now = Date.now();
    const updated = new Date(cached.updated_at).getTime();
    const weekInMs = 7 * 24 * 60 * 60 * 1000;

    if (cached.found) {
      return { lyrics: cached.lyrics, source: cached.source };
    } else {
      // If marked as not found, check if it's been a week or was manually marked incorrect recently
      if (now - updated < weekInMs) {
        const daysLeft = Math.ceil((weekInMs - (now - updated)) / (24 * 60 * 60 * 1000));
        return { lyrics: null, source: null, cooldown: true, lastChecked: cached.updated_at, daysLeft };
      }
      // Else, proceed to re-fetch
      console.log(`[Lyrics] Cooldown expired for ${url}. Re-fetching...`);
    }
  }

  // 2. Fetch Logic (Step-by-step search)
  let lyrics = null;
  let source = 'YouTube Description';

  try {
    let track = song.track;
    let artist = song.artist;
    let cleanTitle = song.title;

    let partA = null;
    let partB = null;

    const quoteMatch = cleanTitle.match(/[「『](.+?)[」』]/);
    if (quoteMatch && quoteMatch[1]) {
      track = track || quoteMatch[1];
      if (!artist) {
        const splitParts = cleanTitle.split(/[「『」』]/);
        const potentialArtist = splitParts[0].trim() || splitParts[2]?.trim();
        if (potentialArtist && potentialArtist.length > 1) artist = potentialArtist;
      }
    }

    let tempTrack = cleanTitle
      .replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
      .replace(/Music Video|Official\s*(Video|Audio|Music Video)?|MV|ft\.|feat\.|Lyric Video/gi, ' ')
      .replace(/歌ってみた|を歌ってみた|cover(ed by| by)?|弾いてみた|叩いてみた|off vocal|instrumental|inst|Remix/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!track && !artist) {
      const delimiters = [/\s*-\s*/, /\s*—\s*/, /\s*\/\s*/, /\s*／\s*/, /\s*\|\s*/, /\s*｜\s*/, /\s*:\s*/];
      for (const delim of delimiters) {
        if (tempTrack.match(delim)) {
          const parts = tempTrack.split(delim).filter(p => p.trim().length > 0);
          if (parts.length >= 2) {
            partA = parts[0].trim();
            partB = parts[1].trim();
            break; 
          }
        }
      }
    }

    if (!track && !partA) {
      track = tempTrack;
    }

    // --- Search Strategy A: YouTube Description ---
    const videoId = getYouTubeId(url);
    if (videoId) {
      const info = await ytSearch({ videoId });
      const desc = info.description;
      if (desc) {
          const markers = [/歌詞[:：\n]/i, /Lyrics?[:：\n]/i, /Words[:：\n]/i, /【歌詞】/, /■歌詞/];
          for (const marker of markers) {
              const parts = desc.split(marker);
              if (parts.length > 1) {
                  const lines = parts[1].trim().split('\n');
                  const resultLines = [];
                  const stopKeywords = ['Background', 'Chorus', 'Shouts', 'Music', 'Compose', 'Arrange', 'Mix', 'Illust', 'Movie', 'Vocal', 'Artist', 'Video', 'Credit', 'Track', 'Album', 'Recorded'];
                  for (let line of lines) {
                      let trimmed = line.trim();
                      if (!trimmed) { resultLines.push(''); continue; }
                      if (trimmed.includes('http') || trimmed.includes('@')) break;
                      let isCredit = false;
                      const tLower = trimmed.toLowerCase();
                      for (const kw of stopKeywords) {
                          if (tLower.includes(kw.toLowerCase()) && (trimmed.includes(':') || trimmed.includes('：'))) {
                              isCredit = true; break;
                          }
                      }
                      if (isCredit) break;
                      resultLines.push(line);
                  }
                  const potential = resultLines.join('\n').trim();
                  if (potential.length > 50) {
                      lyrics = potential;
                      break;
                  }
              }
          }
      }
    }

    // --- Search Strategy B: LRCLIB API ---
    if (!lyrics) {
      source = 'LRCLIB';
      const looseMatch = (str1, str2) => {
          if (!str1 || !str2) return false;
          const s1 = str1.replace(/\(.*?\)|\[.*?\]|【.*?】|「.*?」|『.*?』/g, '').trim().toLowerCase();
          const s2 = str2.replace(/\(.*?\)|\[.*?\]|【.*?】|「.*?」|『.*?』/g, '').trim().toLowerCase();
          return s1 === s2 || s1.includes(s2) || s2.includes(s1);
      };

      const searchLrclib = async (query, tA, tB, exactTrack, exactArtist) => {
          if (!query) return null;
          try {
            const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.length > 0) {
                for (let i = 0; i < Math.min(data.length, 5); i++) {
                    const resName = data[i].name;
                    const resArtist = data[i].artistName;
                    let isMatch = false;
                    if (exactTrack || exactArtist) {
                        const trackMatch = exactTrack ? looseMatch(resName, exactTrack) : true;
                        const artistMatch = exactArtist ? looseMatch(resArtist, exactArtist) || looseMatch(resName, exactArtist) : true;
                        isMatch = (trackMatch && artistMatch);
                    } else if (tA && tB) {
                        const matchOrder1 = looseMatch(resName, tA) && looseMatch(resArtist, tB);
                        const matchOrder2 = looseMatch(resName, tB) && looseMatch(resArtist, tA);
                        isMatch = (matchOrder1 || matchOrder2);
                    } else {
                        isMatch = looseMatch(resName, query); 
                    }
                    if (isMatch && (data[i].plainLyrics || data[i].syncedLyrics)) {
                      return data[i].plainLyrics || data[i].syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
                    }
                }
            }
          } catch (e) {}
          return null;
      };

      const queries = [];
      if (artist && track) queries.push({ q: `${artist} ${track}`, t: track, a: artist });
      if (partA && partB) queries.push({ q: `${partA} ${partB}`, pA: partA, pB: partB });
      if (artist && track) queries.push({ q: track, t: track, a: artist });
      queries.push({ q: tempTrack || cleanTitle });

      for (const qObj of queries) {
        lyrics = await searchLrclib(qObj.q, qObj.pA, qObj.pB, qObj.t, qObj.a);
        if (lyrics) break;
      }
    }

  } catch (e) {
    console.warn(`[Lyrics] Fetch error for ${url}:`, e.message);
  }

  // 3. Save result to Cache
  if (lyrics) {
    await saveLyricsToCache(url, lyrics, source, true);
    return { lyrics, source };
  } else {
    await saveLyricsToCache(url, null, null, false);
    return { lyrics: null, source: null };
  }
}
