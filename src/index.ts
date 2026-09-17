import fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import etag from '@fastify/etag';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { fetchSatellites, getCachedSatellites, getSummary, getMarketplacePasses, searchMarketplaceWithGroq } from './services/satelliteFetcher';
import { getAttestations, getLiveFrames, getOracleInfo, triggerOraclePass, startOracleRelayer, registerActiveBooking } from './services/telemetryOracle';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
    origin: '*', 
    methods: ['GET', 'POST']
});

// Enable Brotli and Gzip compression
server.register(compress, { global: true });

// Enable automatic ETag generation
server.register(etag);

// Add Cache-Control headers hook
server.addHook('onRequest', (request, reply, done) => {
    if (request.method === 'GET' && request.url.startsWith('/api/v1/telemetry')) {
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (request.method === 'GET' && request.url.startsWith('/api/')) {
        reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=1800');
    }
    done();
});

server.get('/health', async (request, reply) => {
    return { status: 'ok', time: new Date().toISOString() };
});

server.get('/api/v1/satellites', async (request, reply) => {
    const data = getCachedSatellites();
    if (data.count === 0) {
        reply.code(503).send({ error: "Satellite data is currently being fetched or is unavailable." });
        return;
    }
    return data;
});

server.get('/api/v1/satellites/category/:cat', async (request, reply) => {
    const data = getCachedSatellites();
    const { cat } = request.params as { cat: string };
    
    if (data.count === 0) {
        reply.code(503).send({ error: "Satellite data is currently being fetched or is unavailable." });
        return;
    }

    const filtered = data.satellites.filter(s => s.cat.toLowerCase() === cat.toLowerCase());
    return {
        ...data,
        count: filtered.length,
        satellites: filtered
    };
});

server.get('/api/v1/satellites/summary', async (request, reply) => {
    const summary = getSummary();
    if (summary.total === 0) {
        reply.code(503).send({ error: "Satellite data is currently being fetched or is unavailable." });
        return;
    }
    return summary;
});

server.get('/api/v1/marketplace/passes', async (request, reply) => {
    const passes = getMarketplacePasses();
    return {
        count: passes.length,
        passes
    };
});

server.post('/api/v1/marketplace/search', async (request, reply) => {
    const body = request.body as { query?: string };
    const query = body?.query || '';
    if (!query.trim()) {
        const passes = getMarketplacePasses();
        return {
            count: passes.length,
            passes
        };
    }

    const matches = await searchMarketplaceWithGroq(query);
    return {
        query,
        count: matches.length,
        passes: matches
    };
});

// Telemetry Oracle API
server.get('/api/v1/telemetry/attestations', async (request, reply) => {
    const list = getAttestations();
    const info = getOracleInfo();
    return {
        count: list.length,
        oracle: info,
        attestations: list
    };
});

server.get('/api/v1/telemetry/live-frames', async (request, reply) => {
    const frames = getLiveFrames();
    return {
        count: frames.length,
        frames
    };
});

server.get('/api/v1/telemetry/oracle-info', async (request, reply) => {
    return getOracleInfo();
});

server.post('/api/v1/telemetry/trigger-pass', async (request, reply) => {
    const body = (request.body as any) || {};
    try {
        const attestation = await triggerOraclePass(body);
        return {
            success: true,
            attestation
        };
    } catch (e: any) {
        reply.code(500).send({ error: e.message });
    }
});

server.post('/api/v1/telemetry/register-booking', async (request, reply) => {
    const body = (request.body as any) || {};
    if (!body.bookingRef || !body.bookingId) {
        reply.code(400).send({ error: "bookingRef and bookingId are required" });
        return;
    }
    registerActiveBooking(body);
    return {
        success: true,
        message: `Booking ${body.bookingRef} registered with Oracle Relayer`,
        booking: body
    };
});

const start = async () => {
    try {
        // Fetch immediately on startup
        await fetchSatellites();
        
        // Start background Oracle Relayer for automated smart contract settlement
        startOracleRelayer();

        // Schedule fetch every 3 hours
        cron.schedule('0 */3 * * *', async () => {
            console.log("Running scheduled satellite fetch...");
            await fetchSatellites();
        });

        const port = parseInt(process.env.PORT || '8080');
        await server.listen({ port: port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
