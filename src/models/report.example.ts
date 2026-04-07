import { Report, ReportStatus, Priority } from '../models';

/**
 * Example of a valid Report document.
 * Useful for testing, seeding, and documentation.
 */
export const SAMPLE_REPORT: Report = {
  id: 'rpt_01HXYZ1234567890',
  title: 'Q4 2025 Clinical Trial Summary',
  description: 'Comprehensive summary of Phase II trial results for compound MED-4821.',
  status: ReportStatus.IN_PROGRESS,
  createdBy: 'usr_dr_smith',
  tags: ['clinical-trial', 'phase-2', 'Q4-2025'],
  metadata: {
    department: 'Clinical Research',
    category: 'Trial Summary',
    confidential: true,
    trialId: 'CT-2025-4821',
  },
  entries: [
    {
      id: 'ent_001',
      title: 'Patient Enrollment Summary',
      content: 'Total of 342 patients enrolled across 12 sites.',
      priority: Priority.HIGH,
      author: 'usr_dr_smith',
      comments: [
        {
          id: 'cmt_001',
          text: 'Numbers verified against site reports.',
          author: 'usr_analyst_jones',
          createdAt: new Date('2025-11-15T10:30:00Z'),
        },
      ],
      createdAt: new Date('2025-11-01T09:00:00Z'),
      updatedAt: new Date('2025-11-15T10:30:00Z'),
    },
    {
      id: 'ent_002',
      title: 'Adverse Events Overview',
      content: 'No serious adverse events reported. Minor events within expected parameters.',
      priority: Priority.MEDIUM,
      author: 'usr_dr_patel',
      comments: [],
      createdAt: new Date('2025-11-05T14:00:00Z'),
      updatedAt: new Date('2025-11-05T14:00:00Z'),
    },
  ],
  attachments: [
    {
      id: 'att_001',
      fileName: 'enrollment-data.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 245_760,
      storagePath: 'reports/rpt_01HXYZ1234567890/enrollment-data.xlsx',
      uploadedAt: new Date('2025-11-01T09:15:00Z'),
    },
  ],
  version: 3,
  createdAt: new Date('2025-10-28T08:00:00Z'),
  updatedAt: new Date('2025-11-15T10:30:00Z'),
};
