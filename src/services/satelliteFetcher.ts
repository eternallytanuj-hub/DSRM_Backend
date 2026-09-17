import axios from 'axios';
import { convertToKeplerian } from '../utils/orbitalMath';

let cachedSatellites: any[] = [];
let lastGeneratedAt: string = "";

const SPACE_TRACK_LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const SPACE_TRACK_QUERY_URL = 'https://www.space-track.org/basicspacedata/query/class/gp/DECAY_DATE/null-val/orderby/NORAD_CAT_ID%20asc/format/json';
const CELESTRAK_QUERY_URL = 'https://celestrak.org/NORAD/elements/index.php?FORMAT=json';

export interface MarketplacePass {
    id: string;
    noradId: number;
    name: string;
    operator: string;
    cat: string;
    alt: number;
    speed: string;
    window: string;
    price: string;
    reason?: string;
}

export async function fetchSatellites() {
    console.log("Fetching satellite data...");
    
    let rawData = null;

    try {
        if (process.env.SPACE_TRACK_IDENTITY && process.env.SPACE_TRACK_PASSWORD) {
            console.log("Attempting Space-Track...");
            const authResponse = await axios.post(SPACE_TRACK_LOGIN_URL, new URLSearchParams({
                identity: process.env.SPACE_TRACK_IDENTITY,
                password: process.env.SPACE_TRACK_PASSWORD
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (authResponse.status === 200) {
                const cookies = authResponse.headers['set-cookie'];
                if (cookies) {
                    const dataResponse = await axios.get(SPACE_TRACK_QUERY_URL, {
                        headers: {
                            'Cookie': cookies.join('; ')
                        }
                    });
                    if (dataResponse.data && Array.isArray(dataResponse.data)) {
                        rawData = dataResponse.data;
                        console.log(`Fetched ${rawData.length} satellites from Space-Track.`);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Space-Track fetch failed:", (error as Error).message);
    }

    if (!rawData) {
        console.log("Falling back to CelesTrak...");
        try {
            const dataResponse = await axios.get(CELESTRAK_QUERY_URL);
            if (dataResponse.data && Array.isArray(dataResponse.data)) {
                rawData = dataResponse.data;
                console.log(`Fetched ${rawData.length} satellites from CelesTrak.`);
            }
        } catch (error) {
            console.error("CelesTrak fetch failed:", (error as Error).message);
        }
    }

    if (rawData) {
        processRawData(rawData);
    } else {
        console.error("Failed to fetch satellite data from all sources.");
    }
}

function processRawData(data: any[]) {
    const processed = [];
    for (const sat of data) {
        const keplerian = convertToKeplerian(sat);
        if (keplerian) {
            processed.push(keplerian);
        }
    }
    
    // Label some satellites for UI display
    for (let i = 0; i < Math.min(100, processed.length); i += 10) {
        processed[i].labeled = true;
    }

    cachedSatellites = processed;
    lastGeneratedAt = new Date().toISOString();
    console.log(`Successfully processed ${cachedSatellites.length} active satellites.`);
}

export function getCachedSatellites() {
    return {
        count: cachedSatellites.length,
        generatedAt: lastGeneratedAt,
        parseErrors: 0,
        satellites: cachedSatellites
    };
}

export function getSummary() {
    const summary: Record<string, number> = {};
    for (const sat of cachedSatellites) {
        summary[sat.cat] = (summary[sat.cat] || 0) + 1;
    }
    return {
        total: cachedSatellites.length,
        generatedAt: lastGeneratedAt,
        categories: summary
    };
}

function formatPass(sat: any, index: number): MarketplacePass {
    let operator = "Commercial / LEO";
    let speed = "45 Mbps";
    let price = "$36";

    switch (sat.cat) {
        case 'starlink':
            operator = "SpaceX / Starlink";
            speed = "180 - 220 Mbps (Ku/Ka)";
            price = "$42";
            break;
        case 'oneweb':
            operator = "Eutelsat OneWeb";
            speed = "95 - 150 Mbps (Ku)";
            price = "$38";
            break;
        case 'iridium':
            operator = "Iridium Communications";
            speed = "128 Kbps (L-Band IoT)";
            price = "$28";
            break;
        case 'earth':
            operator = "ESA / Copernicus Optical";
            speed = "450 - 900 Mbps (X-Band)";
            price = "$65";
            break;
        case 'weather':
            operator = "NOAA / EUMETSAT";
            speed = "25 - 50 Mbps (HRPT)";
            price = "$32";
            break;
        case 'gps':
        case 'glonass':
        case 'galileo':
            operator = "GNSS / PNT Fleet";
            speed = "L1/L2 Attestation Beacon";
            price = "$49";
            break;
        default:
            operator = "Orbital Relay Network";
            speed = "50 Mbps (S-Band)";
            price = "$35";
    }

    const now = new Date();
    const startHour = (now.getUTCHours() + Math.floor(index / 2)) % 24;
    const startMin = (index * 13 + 5) % 60;
    const duration = Math.min(18, Math.max(9, Math.round(sat.period / 550)));
    const endMin = (startMin + duration) % 60;
    const endHour = startMin + duration >= 60 ? (startHour + 1) % 24 : startHour;

    const pad = (n: number) => String(n).padStart(2, '0');
    const windowStr = `${pad(startHour)}:${pad(startMin)} - ${pad(endHour)}:${pad(endMin)} UTC (${duration}m)`;

    return {
        id: sat.name || `SAT-${sat.id}`,
        noradId: sat.id,
        name: sat.name || `SAT-${sat.id}`,
        operator,
        cat: sat.cat,
        alt: sat.alt,
        speed,
        window: windowStr,
        price
    };
}

export function getMarketplacePasses(): MarketplacePass[] {
    if (cachedSatellites.length === 0) {
        return [];
    }

    const categories = ['starlink', 'oneweb', 'iridium', 'earth', 'weather', 'gps'];
    const passes: MarketplacePass[] = [];

    // Sample distinct satellites across active constellations
    for (const cat of categories) {
        const satsInCat = cachedSatellites.filter(s => s.cat === cat);
        const sampled = satsInCat.slice(0, 3);
        sampled.forEach((sat, i) => {
            passes.push(formatPass(sat, passes.length));
        });
    }

    return passes;
}

export async function searchMarketplaceWithGroq(query: string): Promise<MarketplacePass[]> {
    const allPasses = getMarketplacePasses();
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || allPasses.length === 0) {
        return allPasses;
    }

    // Prepare candidate list for Groq
    const candidates = allPasses.map(p => ({
        id: p.id,
        name: p.name,
        operator: p.operator,
        category: p.cat,
        altitude_km: p.alt,
        throughput: p.speed,
        window: p.window,
        price: p.price
    }));

    const systemPrompt = `You are DSRM's AI Orbital Matchmaker. Analyze user natural language query and recommend the most suitable satellites from the candidate list.
Criteria to match:
- Geographic coverage / inclination
- Service type (broadband internet, earth observation, IoT/M2M messaging, navigation/timing, weather)
- Bandwidth & latency
Return ONLY a valid JSON array of objects with keys: 'id' (the candidate id) and 'reason' (a crisp 1-sentence technical explanation of why this satellite fits the user's mission). Example: [{"id":"STARLINK-32573","reason":"LEO 550km Ku/Ka-band provides high-bandwidth low-latency connectivity over the requested region."}]`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'openai/gpt-oss-120b',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `User query: "${query}"\n\nCandidate Satellites:\n${JSON.stringify(candidates, null, 2)}` }
            ],
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const content = response.data?.choices?.[0]?.message?.content || "";
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const matches: Array<{ id: string; reason: string }> = JSON.parse(jsonMatch[0]);
            if (Array.isArray(matches) && matches.length > 0) {
                const results: MarketplacePass[] = [];
                for (const match of matches) {
                    const pass = allPasses.find(p => p.id === match.id || p.name === match.id);
                    if (pass) {
                        results.push({
                            ...pass,
                            reason: match.reason
                        });
                    }
                }
                if (results.length > 0) {
                    return results;
                }
            }
        }
    } catch (err: any) {
        console.error("Groq AI search error in backend:", err.message);
    }

    // Fallback: simple keyword matching if AI call didn't yield matches
    const q = query.toLowerCase();
    return allPasses.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.operator.toLowerCase().includes(q) ||
        p.cat.toLowerCase().includes(q) ||
        p.speed.toLowerCase().includes(q)
    );
}
