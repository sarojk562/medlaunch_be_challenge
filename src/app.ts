import express from 'express';
import { requestLogger } from './middleware/requestLogger';
import { reportController } from './controllers/report.controller';
import { fileController } from './controllers/file.controller';
import { ReportService } from './services/report.service';
import { AuditService } from './services/audit.service';
import { LocalFileStorageService } from './services/file-storage.service';
import { InMemoryReportRepository } from './repositories';

const app = express();

app.use(express.json());
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

export default app;
