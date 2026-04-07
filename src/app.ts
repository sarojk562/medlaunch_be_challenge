import express from 'express';
import { requestContextMiddleware } from './middleware/request-context.middleware';
import { requestLogger } from './middleware/requestLogger';
import { errorHandlerMiddleware } from './middleware/error.middleware';
import { reportController } from './controllers/report.controller';
import { fileController } from './controllers/file.controller';
import { ReportService } from './services/report.service';
import { AuditService } from './services/audit.service';
import { LocalFileStorageService } from './services/file-storage.service';
import { InMemoryReportRepository } from './repositories';

const app = express();

// ── Global Middleware (order matters) ────────────────────────────────────────
app.use(express.json());
app.use(requestContextMiddleware);
app.use(requestLogger);

// ── Dependencies ─────────────────────────────────────────────────────────────
const reportRepository = new InMemoryReportRepository();
const auditService = new AuditService();
const fileStorage = new LocalFileStorageService();
const reportService = new ReportService(reportRepository, auditService, fileStorage);

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/reports', reportController(reportService));
app.use('/files', fileController(fileStorage));

// ── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandlerMiddleware);

export default app;
