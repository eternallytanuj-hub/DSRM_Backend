export function categorizeSatellite(name: string): string {
    const nameUpper = name.toUpperCase();
    if (nameUpper.includes("STARLINK")) return "starlink";
    if (nameUpper.includes("ONEWEB")) return "oneweb";
    if (nameUpper.includes("NAVSTAR") || nameUpper.includes("GPS")) return "gps";
    if (nameUpper.includes("GLONASS")) return "glonass";
    if (nameUpper.includes("GALILEO") || nameUpper.includes("GSAT")) return "galileo";
    if (nameUpper.includes("IRIDIUM")) return "iridium";
    if (nameUpper.includes("NOAA") || nameUpper.includes("GOES") || nameUpper.includes("METEOSAT")) return "weather";
    if (nameUpper.includes("LANDSAT") || nameUpper.includes("SENTINEL")) return "earth";
    return "other";
}

export function convertToKeplerian(sat: any) {
    try {
        const meanMotion = parseFloat(sat.MEAN_MOTION);
        if (isNaN(meanMotion) || meanMotion <= 0) return null;
        
        const period = 86400 / meanMotion;
        const n = meanMotion * 2 * Math.PI / 86400;
        const a = Math.pow(3.986004418e14 / (n * n), 1/3);
        const alt = Math.round(a / 1000 - 6371);
        
        const name = sat.OBJECT_NAME || "";
        const cat = categorizeSatellite(name);
        
        return {
            name: name,
            id: parseInt(sat.NORAD_CAT_ID) || 0,
            incl: (parseFloat(sat.INCLINATION) || 0) * Math.PI / 180,
            raan: (parseFloat(sat.RA_OF_ASC_NODE) || 0) * Math.PI / 180,
            alt: alt,
            phase: (parseFloat(sat.MEAN_ANOMALY) || 0) * Math.PI / 180,
            period: Math.round(period),
            ecc: parseFloat(sat.ECCENTRICITY) || 0,
            cat: cat,
            labeled: false
        };
    } catch (e) {
        return null;
    }
}
