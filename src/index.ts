import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { fetchSatellites, getCachedSatellites } from './services/satelliteFetcher';

dotenv.config();

const server = fastify({ logger: true });

server.register(cors, {
    origin: '*', 
    methods: ['GET']
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
    
    // Check if query param for specific category exists
    const query = request.query as any;
    if (query.cat) {
        const cat = query.cat.toLowerCase();
        const filtered = data.satellites.filter(s => s.cat === cat);
        return {
            ...data,
            count: filtered.length,
            satellites: filtered
        };
    }

    return data;
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
