import express from 'express';
import { requestLogger } from './middleware/requestLogger';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
