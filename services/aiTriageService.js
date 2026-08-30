/**
 * AI-Assisted Intelligent Triage Service
 * Local deterministic heuristic engine for categorization, priority determination,
 * problem summarization, and suggested remediation steps.
 */

const CATEGORY_RULES = [
  {
    category: 'Account',
    keywords: [
      'password', 'login', '2fa', 'two-factor', 'hacked', 'unauthorized',
      'reset password', 'account', 'locked out', 'access denied', 'permission',
      'authentication', 'token', 'credentials', 'compromised', 'profile',
    ],
  },
  {
    category: 'Billing',
    keywords: [
      'invoice', 'billing', 'charge', 'refund', 'payment', 'credit card',
      'subscription', 'overcharge', 'receipt', 'pricing', 'plan', 'renewal',
      'stripe', 'bank', 'transaction', 'declined',
    ],
  },
  {
    category: 'Network',
    keywords: [
      'wifi', 'connection', 'vpn', 'dns', 'latency', 'ping', 'offline',
      'slow internet', 'packet loss', 'firewall', 'router', 'gateway',
      'timeout', 'cannot connect', 'unreachable', 'bandwidth',
    ],
  },
  {
    category: 'Hardware',
    keywords: [
      'printer', 'monitor', 'screen', 'laptop', 'keyboard', 'mouse',
      'battery', 'hardware', 'cable', 'docking', 'headset', 'audio',
      'webcam', 'device', 'usb', 'power supply',
    ],
  },
  {
    category: 'Technical Support',
    keywords: [
      'bug', 'crash', 'error', 'exception', 'stack trace', 'failed',
      'broken', 'glitch', 'not working', 'freeze', 'blank screen',
      'database', 'api', 'server error', '500', '404', 'corrupted',
    ],
  },
];

const PRIORITY_RULES = [
  {
    priority: 'Critical',
    keywords: [
      'production down', 'system outage', 'security breach', 'data loss',
      'emergency', 'disaster', 'ransomware', 'all users affected',
      'server down', 'fatal crash', 'complete outage',
    ],
    suggestedActions: [
      'Immediate 15-minute SLA escalation triggered.',
      'Check system health telemetry and infrastructure status.',
      'Notify senior on-call team.',
    ],
  },
  {
    priority: 'Urgent',
    keywords: [
      'urgent', 'asap', 'blocking work', 'cannot work', 'high impact',
      'deadline', 'immediate assistance', 'time sensitive',
    ],
    suggestedActions: [
      'Review within 30 minutes.',
      'Verify customer environment and duplicate symptoms.',
      'Provide temporary mitigation if needed.',
    ],
  },
  {
    priority: 'High',
    keywords: [
      'important', 'payment failed', 'locked out', 'failing', 'broken',
      'error message', 'cannot submit', 'multiple users',
    ],
    suggestedActions: [
      'Verify account credentials and inspect error logs.',
      'Formulate remediation steps.',
    ],
  },
  {
    priority: 'Low',
    keywords: [
      'typo', 'cosmetic', 'minor', 'question', 'curious', 'how to',
      'documentation', 'guidance', 'inquiry', 'feedback',
    ],
    suggestedActions: [
      'Refer to relevant Knowledge Base articles.',
      'Provide standard guidance.',
    ],
  },
];

/**
 * Triage support request text
 * @param {string} subject
 * @param {string} description
 * @returns {object}
 */
const triageRequest = (subject = '', description = '') => {
  const combinedText = `${subject} ${description}`.toLowerCase();

  // 1. Determine Category
  let matchedCategory = 'General';
  let maxCategoryHits = 0;

  for (const rule of CATEGORY_RULES) {
    let hits = 0;
    for (const kw of rule.keywords) {
      if (combinedText.includes(kw)) hits++;
    }
    if (hits > maxCategoryHits) {
      maxCategoryHits = hits;
      matchedCategory = rule.category;
    }
  }

  // 2. Determine Priority & Remediation Suggestions
  let matchedPriority = 'Medium';
  let suggestedActions = [
    'Review request details and verify customer environment.',
    'Refer to Knowledge Base articles for standard troubleshooting.',
  ];

  for (const rule of PRIORITY_RULES) {
    if (rule.keywords.some((kw) => combinedText.includes(kw))) {
      matchedPriority = rule.priority;
      suggestedActions = rule.suggestedActions;
      break;
    }
  }

  // 3. Confidence Assessment
  let confidenceScore = 0.85;
  let confidenceLabel = 'Medium Confidence';

  if (maxCategoryHits >= 2) {
    confidenceScore = 0.95;
    confidenceLabel = 'High Confidence';
  } else if (maxCategoryHits === 1) {
    confidenceScore = 0.88;
    confidenceLabel = 'Medium Confidence';
  } else {
    confidenceScore = 0.75;
    confidenceLabel = 'Low Confidence';
  }

  // 4. Concise Summary
  const cleanSubject = subject.trim();
  const summary = `${cleanSubject} - AI-assisted intelligent triage recommends "${matchedCategory}" with ${matchedPriority} priority.`;

  return {
    category: matchedCategory,
    priority: matchedPriority,
    summary,
    confidence: confidenceScore,
    confidenceLabel,
    suggestedActions,
  };
};

module.exports = { triageRequest };
