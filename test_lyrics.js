function getYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Simulated fetch for LRCLIB mock
async function mockFetch(url) {
  const query = new URL(url).searchParams.get('q');
  let data = [];
  
  // mock database matches
  if (query.includes('YOASOBI') && query.includes('アイドル')) {
    data.push({ name: 'アイドル', artistName: 'YOASOBI', plainLyrics: '無敵の笑顔で荒らすメディア...' });
  } else if (query.includes('Ado') && query.includes('踊')) {
    data.push({ name: '踊', artistName: 'Ado', plainLyrics: '半端ならK.O....' });
  } else if (query.includes('Test Song')) {
    data.push({ name: 'Test Song', artistName: 'Original Artist', plainLyrics: 'La la la...' });
  }

  return { ok: true, json: async () => data };
}

async function testFetchLyrics(q_current) {
  let track = q_current.track;
  let artist = q_current.artist;
  let cleanTitle = q_current.title;
  let partA = null;
  let partB = null;

  // 1. Extract from Japanese quotes if present
  const quoteMatch = cleanTitle.match(/[「『](.+?)[」』]/);
  if (quoteMatch && quoteMatch[1]) {
    track = track || quoteMatch[1];
    if (!artist) {
      const splitParts = cleanTitle.split(/[「『」』]/);
      const potentialArtist = splitParts[0].trim() || splitParts[2]?.trim();
      if (potentialArtist && potentialArtist.length > 1) artist = potentialArtist;
    }
  }

  // 2. Perform aggressive cleaning on the raw title
  let tempTrack = cleanTitle
    .replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
    .replace(/Music Video|Official\s*(Video|Audio|Music Video)?|MV|ft\.|feat\.|Lyric Video/gi, ' ')
    .replace(/歌ってみた|を歌ってみた|cover(ed by| by)?|弾いてみた|叩いてみた|off vocal|instrumental|inst|Remix/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle common delimiters
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

  // Helper function to strip parens for loose matching
  const looseMatch = (str1, str2) => {
    if (!str1 || !str2) return false;
    const s1 = str1.replace(/\(.*?\)|\[.*?\]/g, '').trim().toLowerCase();
    const s2 = str2.replace(/\(.*?\)|\[.*?\]/g, '').trim().toLowerCase();
    return s1 === s2 || s1.includes(s2) || s2.includes(s1);
  };

  const searchLrclib = async (query, tA, tB, exactTrack, exactArtist) => {
    try {
      const res = await mockFetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (data && data.length > 0) {
        // First pass: Try to match both parts or explicit artist/track
        for (let i = 0; i < Math.min(data.length, 5); i++) {
          const resName = data[i].name;
          const resArtist = data[i].artistName;
          
          let isMatch = false;

          // If we explicitly know track and artist
          if (exactTrack || exactArtist) {
             const trackMatch = exactTrack ? looseMatch(resName, exactTrack) : true;
             const artistMatch = exactArtist ? looseMatch(resArtist, exactArtist) || looseMatch(resName, exactArtist) : true;
             isMatch = (trackMatch && artistMatch);
          } 
          // If we only have split parts (partA and partB)
          else if (tA && tB) {
             const matchOrder1 = looseMatch(resName, tA) && looseMatch(resArtist, tB);
             const matchOrder2 = looseMatch(resName, tB) && looseMatch(resArtist, tA);
             isMatch = (matchOrder1 || matchOrder2);
          }
          // If we only have a single query string without splits
          else {
             const nameMatch = looseMatch(resName, query);
             isMatch = nameMatch; 
          }

          if (isMatch && (data[i].plainLyrics || data[i].syncedLyrics)) {
            return data[i].plainLyrics || data[i].syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
          }
        }

        // Fallback: If no strict match and we're desperate, just return the first hit if it has lyrics
        for (let i = 0; i < Math.min(data.length, 5); i++) {
          if (data[i].plainLyrics) return data[i].plainLyrics;
          if (data[i].syncedLyrics) return data[i].syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
        }
      }
    } catch (e) {
      console.warn(`[Lyrics] LRCLIB search failed for "${query}":`, e.message);
    }
    return null;
  };

  let lyrics = null;

  // Queries to try
  const queries = [];
  if (artist && track) queries.push({ q: `${artist} ${track}`, t: track, a: artist });
  if (partA && partB) {
    queries.push({ q: `${partA} ${partB}`, pA: partA, pB: partB });
    queries.push({ q: `${partB} ${partA}`, pA: partA, pB: partB }); // Sometimes LRCLIB respects order
  }
  if (artist && track) queries.push({ q: track, t: track, a: artist });
  if (partA) queries.push({ q: partA, pA: partA });
  if (partB) queries.push({ q: partB, pA: partB });
  queries.push({ q: tempTrack || cleanTitle });

  for (const qObj of queries) {
    if (!qObj.q) continue;
    lyrics = await searchLrclib(qObj.q, qObj.pA, qObj.pB, qObj.t, qObj.a);
    if (lyrics) break;
  }

  return lyrics;
}


async function runTests() {
  const testCases = [
    { title: 'YOASOBI「アイドル」 Official Music Video', expectLyrics: true },
    { title: '【MV】アイドル／YOASOBI', expectLyrics: true },
    { title: 'YOASOBI - アイドル (Official Video)', expectLyrics: true },
    { title: 'Ado - 踊', expectLyrics: true },
    { title: 'アイドル / YOASOBI', expectLyrics: true },
    { title: 'Test Song (Cover by Someone) [MV]', expectLyrics: true },
    { title: 'Some Random Unknown Song', expectLyrics: false }
  ];

  console.log("Running Fetch Lyrics Tests...\n");
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const q_current = { title: tc.title, url: 'https://youtube.com/test' };
    const result = await testFetchLyrics(q_current);
    const pass = (result !== null) === tc.expectLyrics;
    console.log(`Test ${i + 1}: ${pass ? '✅' : '❌'}`);
    console.log(`  Input:    ${tc.title}`);
    console.log(`  Found?:   ${result !== null}`);
    console.log(`  Expected: ${tc.expectLyrics}\n`);
  }
}

runTests();
