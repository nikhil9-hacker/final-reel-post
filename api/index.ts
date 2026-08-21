import app from '../server.js';

export default function handler(req: any, res: any) {
  try {
    return app(req, res);
  } catch (err: any) {
    console.error('[Vercel Serverless Error]:', err);
    res.status(500).json({ error: 'Serverless execution error', details: err?.message || String(err) });
  }
}
