import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import logger from './src/lib/logger';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  }).listen(3000, '0.0.0.0', () => {
    logger.info('Server ready', { url: 'http://localhost:3000' });
  });
});
