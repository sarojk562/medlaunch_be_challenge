import express from 'express';
import { requestLogger } from './middleware/requestLogger';
import { reportController } from './controllers/report.controller';
import { ReportService } from './services/report.service';
import { InMemoryReportRepository } from './repositories';

const app = express();

app.use(express.json());
app.use(requestLogger);

// ── Dependencies ─────────────────────────────────────────────────────────────
const reportRepository = new InMemoryReportRepository();
const reportService = new ReportService(reportRepository);

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/reports', reportController(reportService));

export default app;
