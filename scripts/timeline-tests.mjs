import assert from 'node:assert/strict';

const DESIGN_CONCEPT_DAYS = 3;
const PRINT_VERSION_DAYS = 5;
const EBOOK_VERSION_DAYS = 2;
const PRINT_ONLY_DAYS = DESIGN_CONCEPT_DAYS + PRINT_VERSION_DAYS;
const FULL_PROJECT_DAYS = PRINT_ONLY_DAYS + EBOOK_VERSION_DAYS;

function addCalendarDays(startDate, days) {
  const date = new Date(`${startDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function projectRequiresEbook(project) {
  const serviceType = (project.service_type || '').toLowerCase();
  return serviceType.includes('ebook') || serviceType.includes('e-book') || serviceType.includes('kindle');
}

function estimatedFinalDueDate(project) {
  const needsEbook = projectRequiresEbook(project);

  if (project.final_delivery_date) {
    return project.final_delivery_date;
  }

  if (project.print_version_approval_date) {
    return needsEbook
      ? addCalendarDays(project.print_version_approval_date, EBOOK_VERSION_DAYS)
      : project.print_version_due_date || project.print_version_approval_date;
  }

  if (project.design_concept_approval_date) {
    return addCalendarDays(project.design_concept_approval_date, PRINT_VERSION_DAYS + (needsEbook ? EBOOK_VERSION_DAYS : 0));
  }

  if (project.files_received_date) {
    return addCalendarDays(project.files_received_date, needsEbook ? FULL_PROJECT_DAYS : PRINT_ONLY_DAYS);
  }

  return project.due_date || null;
}

function withFinalDue(project) {
  const dueDate = estimatedFinalDueDate(project);
  return dueDate ? { ...project, due_date: dueDate, internal_deadline: dueDate } : project;
}

function derive(project) {
  const next = { print_timeline_days: PRINT_VERSION_DAYS, service_type: 'Print + eBook', ...project };

  if (next.final_delivery_date) {
    return withFinalDue({ ...next, current_stage: 'Completed', progress_percentage: 100, timeline_status: 'Completed', waiting_on: 'None' });
  }

  if (next.ebook_approval_date) {
    return withFinalDue({
      ...next,
      current_stage: 'Final Quality Check',
      progress_percentage: 95,
      timeline_status: 'Active',
      waiting_on: 'Manuscript Heaven',
    });
  }

  if (next.ebook_submitted_date) {
    return withFinalDue({
      ...next,
      current_stage: 'eBook Review',
      progress_percentage: 90,
      timeline_status: 'Paused',
      waiting_on: 'Client',
      client_action_required: 'Review the eBook version',
    });
  }

  if (next.print_version_approval_date) {
    if (!projectRequiresEbook(next)) {
      return withFinalDue({
        ...next,
        ebook_due_date: null,
        current_stage: 'Final Quality Check',
        progress_percentage: 95,
        timeline_status: 'Active',
        waiting_on: 'Manuscript Heaven',
      });
    }

    return withFinalDue({
      ...next,
      ebook_due_date: addCalendarDays(next.print_version_approval_date, EBOOK_VERSION_DAYS),
      current_stage: 'eBook in Progress',
      progress_percentage: 85,
      timeline_status: 'Active',
      waiting_on: 'Manuscript Heaven',
    });
  }

  if (next.print_version_submitted_date) {
    return withFinalDue({
      ...next,
      current_stage: 'Awaiting Print Approval',
      progress_percentage: 70,
      timeline_status: 'Paused',
      waiting_on: 'Client',
      client_action_required: 'Review and approve the complete print version',
    });
  }

  if (next.design_concept_approval_date) {
    return withFinalDue({
      ...next,
      print_version_due_date: addCalendarDays(next.design_concept_approval_date, PRINT_VERSION_DAYS),
      current_stage: 'Print Version in Progress',
      progress_percentage: 50,
      timeline_status: 'Active',
      waiting_on: 'Manuscript Heaven',
    });
  }

  if (next.design_concept_submitted_date) {
    return withFinalDue({
      ...next,
      current_stage: 'Awaiting Concept Approval',
      progress_percentage: 30,
      timeline_status: 'Paused',
      waiting_on: 'Client',
      client_action_required: 'Review and approve the design concept',
    });
  }

  if (next.files_received_date) {
    return withFinalDue({
      ...next,
      design_concept_due_date: addCalendarDays(next.files_received_date, DESIGN_CONCEPT_DAYS),
      current_stage: 'Design Concept in Progress',
      progress_percentage: 20,
      timeline_status: 'Active',
      waiting_on: 'Manuscript Heaven',
    });
  }

  return { ...next, current_stage: 'Files Required', progress_percentage: 0, timeline_status: 'Paused', waiting_on: 'Client' };
}

assert.equal(addCalendarDays('2026-07-17', 3), '2026-07-20', 'calendar days include weekends');

const files = derive({ files_received_date: '2026-07-17' });
assert.equal(files.current_stage, 'Design Concept in Progress');
assert.equal(files.design_concept_due_date, '2026-07-20');
assert.equal(files.due_date, '2026-07-27');

const conceptSubmitted = derive({ ...files, design_concept_submitted_date: '2026-07-20' });
assert.equal(conceptSubmitted.current_stage, 'Awaiting Concept Approval');
assert.equal(conceptSubmitted.timeline_status, 'Paused');
assert.equal(conceptSubmitted.waiting_on, 'Client');
assert.equal(conceptSubmitted.due_date, '2026-07-27');

const conceptApproved = derive({ ...conceptSubmitted, design_concept_approval_date: '2026-07-24' });
assert.equal(conceptApproved.current_stage, 'Print Version in Progress');
assert.equal(conceptApproved.print_version_due_date, '2026-07-29');
assert.equal(conceptApproved.due_date, '2026-07-31');

const printSubmitted = derive({ ...conceptApproved, print_version_submitted_date: '2026-07-29' });
assert.equal(printSubmitted.current_stage, 'Awaiting Print Approval');
assert.equal(printSubmitted.timeline_status, 'Paused');

const printApproved = derive({ ...printSubmitted, print_version_approval_date: '2026-08-03' });
assert.equal(printApproved.current_stage, 'eBook in Progress');
assert.equal(printApproved.ebook_due_date, '2026-08-05');
assert.equal(printApproved.due_date, '2026-08-05');

const ebookSubmitted = derive({ ...printApproved, ebook_submitted_date: '2026-08-04' });
assert.equal(ebookSubmitted.current_stage, 'eBook Review');
assert.equal(ebookSubmitted.waiting_on, 'Client');

const ebookApproved = derive({ ...ebookSubmitted, ebook_approval_date: '2026-08-06' });
assert.equal(ebookApproved.current_stage, 'Final Quality Check');

const completed = derive({ ...ebookApproved, final_delivery_date: '2026-08-07' });
assert.equal(completed.current_stage, 'Completed');
assert.equal(completed.progress_percentage, 100);
assert.equal(completed.due_date, '2026-08-07');

const printOnly = derive({ service_type: 'Print Formatting', files_received_date: '2026-07-17' });
assert.equal(printOnly.due_date, '2026-07-25');

const printOnlyApproved = derive({
  ...printOnly,
  design_concept_approval_date: '2026-07-20',
  print_version_submitted_date: '2026-07-25',
  print_version_approval_date: '2026-07-25',
});
assert.equal(printOnlyApproved.current_stage, 'Final Quality Check');
assert.equal(printOnlyApproved.ebook_due_date, null);
assert.equal(printOnlyApproved.due_date, '2026-07-25');

console.log('Timeline tests passed.');
