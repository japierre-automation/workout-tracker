import fp from 'fastify-plugin';

/**
 * Dormant API-key gate. No auth for the MVP (the service runs on a private
 * network), but the hook exists so enabling protection later is a config change
 * (`API_KEY_ENABLED=true` + `API_KEY=...`), not a code change.
 */
export default fp(async (app) => {
  if (!app.config.API_KEY_ENABLED) return;

  app.addHook('preHandler', async (req, reply) => {
    if (req.headers['x-api-key'] !== app.config.API_KEY) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid or missing API key' });
    }
  });
});
