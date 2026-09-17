import fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import etag from '@fastify/etag';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { fetchSatellites, getCachedSatellites, getSummary } from './services/satelliteFetcher';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
    origin: '*', 
    methods: ['GET']
});

// Enable Brotli and Gzip compression
server.register(compress, { global: true });

// Enable automatic ETag generation
server.register(etag);

// Add Cache-Control headers hook
server.addHook('onRequest', (request, reply, done) => {
    if (request.method === 'GET' && request.url.startsWith('/api/')) {
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

const start = async () => {
    try {
        // Fetch immediately on startup
        await fetchSatellites();
        
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
