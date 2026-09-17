import axios from 'axios';
import { convertToKeplerian } from '../utils/orbitalMath';

let cachedSatellites: any[] = [];
let lastGeneratedAt: string = "";

const SPACE_TRACK_LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const SPACE_TRACK_QUERY_URL = 'https://www.space-track.org/basicspacedata/query/class/gp/DECAY_DATE/null-val/orderby/NORAD_CAT_ID%20asc/format/json';
const CELESTRAK_QUERY_URL = 'https://celestrak.org/NORAD/elements/index.php?FORMAT=json';

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
