/** Words for the engine's codes, in one place. */
export const APPLICATION_STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 't-ink' },
  sending: { label: 'Sending', cls: 't-blue' },
  sent: { label: 'Sent', cls: 't-blue' },
  failed: { label: 'Didn’t send', cls: 't-red' },
  cancelled: { label: 'Cancelled', cls: 't-ink' },
  replied: { label: 'Replied', cls: 't-purple' },
  interview: { label: 'Interview', cls: 't-green' },
  rejected: { label: 'Not this time', cls: 't-ink' },
  offer: { label: 'Offer', cls: 't-green' },
  hired: { label: 'Hired', cls: 't-green' },
  no_response: { label: 'No reply', cls: 't-ink' },
};

export const MODE: Record<string, string> = { autopilot: 'Autopilot', apply_queue: 'Apply queue', manual: 'You' };

export const QUEUE_WHY: Record<string, string> = {
  unverified_employer: 'The employer isn’t verified, so autopilot won’t send. Check the job before applying.',
  apply_on_source_site: 'This job only takes applications on its own site.',
  outside_rules: 'A good match, but outside your autopilot rules.',
  autopilot_off: 'Autopilot is off, so this waits for you.',
  job_cap_reached: 'Autopilot already sent its share of applications to this job.',
};

export const CHECKIN_ANSWERS: [string, string][] = [
  ['interview', 'Got an interview'],
  ['heard_back', 'Heard back'],
  ['no_reply_yet', 'No reply yet'],
  ['rejected', 'They said no'],
  ['hired', 'I got the job'],
  ['did_not_apply', 'I didn’t apply'],
];

export const CONSENTS: { purpose: string; title: string; text: string; required?: boolean }[] = [
  { purpose: 'matching', title: 'Match me to jobs', text: 'Use my profile and CV to find and rank jobs for me.' },
  { purpose: 'autopilot', title: 'Send applications in my name', text: 'Let autopilot send applications that fit my rules, from my i-jobs email address.' },
  { purpose: 'reply_reading', title: 'Sort replies for me', text: 'Read replies employers send to my i-jobs address so they show up as interviews, rejections or questions.' },
  { purpose: 'cross_site_linking', title: 'Linked sites', text: 'Share my profile, matches and applications with partner sites I’ve linked, like Remote Hustle or School1.' },
  { purpose: 'cross_site_marketing', title: 'News from partner sites', text: 'Partner sites may tell me about their courses and events.' },
  { purpose: 'training_data', title: 'Help improve i-jobs', text: 'Use my profile corrections, without my name, to make CV reading better.' },
];

export const POLICY_VERSION = '2026-11';

/** A word and a chip colour (a class in ui.module.css) for each status the owner, employer and staff pages show. */
export type Chip = [label: string, tone: 'good' | 'bad' | 'info' | 'gray' | 'yellow' | 'purple'];

export const COMMUNITY_STATUS: Record<string, Chip> = {
  pending_review: ['In review', 'yellow'], active: ['Live', 'good'], suspended: ['Suspended', 'bad'], banned: ['Banned', 'bad'],
};
export const MEMBER_STATUS: Record<string, Chip> = {
  pending_approval: ['Wants to join', 'yellow'], pending_payment: ['Not paid yet', 'gray'], trialing: ['Free week', 'purple'],
  active: ['Paid', 'good'], past_due: ['Payment late', 'bad'], expired: ['Ended', 'gray'], cancelled: ['Cancelled', 'gray'],
};
export const ONBOARDING_STEP: Record<string, string> = {
  joined: 'Joined', paid: 'Paid, no CV yet', cv_uploaded: 'CV in, no autopilot yet', rules_set: 'Autopilot set', complete: 'Fully set up',
};
export const COMMUNITY_JOB_STATE: Record<string, Chip> = {
  reading: ['Reading…', 'info'], needs_confirmation: ['Check and confirm', 'yellow'], live: ['Live', 'good'],
  under_review: ['In review', 'yellow'], expired: ['Expired', 'gray'], removed: ['Removed', 'bad'],
};
export const PAYOUT_STATUS: Record<string, Chip> = {
  held: ['Held', 'gray'], ready: ['Ready', 'info'], processing: ['Sending', 'purple'], paid: ['Paid', 'good'], frozen: ['Frozen', 'bad'], failed: ['Failed', 'bad'],
};
export const INVITE_STATUS: Record<string, Chip> = {
  pending: ['Waiting to send', 'gray'], sent: ['Sent', 'info'], opened: ['Opened', 'purple'], joined: ['Joined', 'good'], revoked: ['Revoked', 'gray'],
};
export const EMPLOYER_JOB_STATE: Record<string, Chip> = {
  live: ['Live', 'good'], in_review: ['In review', 'yellow'], closed: ['Closed', 'gray'], removed: ['Removed', 'bad'],
};
export const VERIFICATION: Record<string, Chip> = {
  unverified: ['Not verified', 'gray'], pending: ['Checking', 'yellow'], verified: ['Verified', 'good'], revoked: ['Revoked', 'bad'],
  approved: ['Approved', 'good'], rejected: ['Not approved', 'bad'], needs_more_info: ['Needs more info', 'yellow'],
};
export const PERIOD_LABEL: Record<string, string> = { monthly: 'a month', quarterly: 'every 3 months', yearly: 'a year' };
