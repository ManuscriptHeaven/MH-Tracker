import {
  calculateStageDueDate,
  deriveProjectTimeline,
  getStageDurationDays,
  getTimelineSummary,
  getWorkflowSettings,
} from '../src/lib/timeline.ts';
import { DEFAULT_WORKFLOW_SETTINGS } from '../src/lib/constants.ts';
import { runProductionTimelineTests } from '../src/lib/timeline.test.ts';

runProductionTimelineTests();
