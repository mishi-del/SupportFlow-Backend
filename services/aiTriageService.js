/**
 * Deterministic Local AI Triage Engine
 * Performs intelligent heuristic NLP categorization, priority assessment,
 * automated problem summarization, and suggested remediation steps
 * without external API calls or third-party dependencies.
 */

const CATEGORY_RULES = [
  {
    category: 'Account & Security',
    keywords: [
      'password', 'login', '2fa', 'two-factor', 'hacked', 'unauthorized',
      'reset password', 'account', 'locked out', 'access denied', 'permission',
      'authentication', 'token', 'credentials', 'compromised', 'phishing',
    ],
    baseConfidence: 0.94,
  },
  {
    category: 'Billing & Payments',
    keywords: [
      'invoice', 'billing', 'charge', 'refund', 'payment', 'credit card',
      'subscription', 'overcharge', 'receipt', 'pricing', 'plan', 'renewal',
      'stripe', 'bank', 'transaction', 'declined',
    ],
    baseConfidence: 0.92,
  },
  {
    category: 'Network & Connectivity',
    keywords: [
      'wifi', 'connection', 'vpn', 'dns', 'latency', 'ping', 'offline',
      'slow internet', 'packet loss', 'firewall', 'router', 'gateway',
      'timeout', 'cannot connect', 'unreachable', 'bandwidth',
    ],
    baseConfidence: 0.91,
  },
  {
    category: 'Hardware & Equipment',
    keywords: [
      'printer', 'monitor', 'screen', 'laptop', 'keyboard', 'mouse',
      'battery', 'hardware', 'cable', 'docking', 'headset', 'audio',
      'webcam', 'device', 'usb', 'power supply',
    ],
    baseConfidence: 0.93,
  },
  {
    category: 'Technical Support',
    keywords: [
      'bug', 'crash', 'error', 'exception', 'stack trace', 'failed',
      'broken', 'glitch', 'not working', 'freeze', 'blank screen',
      'database', 'api', 'server error', '500', '404', 'corrupted',
    ],
    baseConfidence: 0.9,
  },
  {
    category: 'Feature Request',
    keywords: [
      'feature', 'enhancement', 'suggestion', 'idea', 'would like',
      'request for', 'new capability', 'add support for', 'improvement',
    ],
    baseConfidence: 0.88,
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
      'Escalate to Tier 3 on-call incident response team immediately.',
      'Check infrastructure status and active server telemetry.',
      'Notify affected management stakeholders.',
    ],
  },
  {
    priority: 'Urgent',
    keywords: [
      'urgent', 'asap', 'blocking work', 'cannot work', 'high impact',
      'deadline', 'immediate assistance', 'time sensitive', 'critical bug',
    ],
    suggestedActions: [
      'Acknowledge and review within 15 minutes.',
      'Perform initial diagnostic log analysis.',
      'Provide temporary mitigation or workaround if full fix takes time.',
    ],
  },
  {
    priority: 'High',
    keywords: [
      'important', 'payment failed', 'locked out', 'failing', 'broken',
      'error message', 'cannot submit', 'multiple users', 'major glitch',
    ],
    suggestedActions: [
      'Verify customer account authorization and credentials.',
      'Check system logs for matching transaction or request IDs.',
      'Formulate remediation steps.',
    ],
  },
  {
    priority: 'Low',
    keywords: [
      'typo', 'cosmetic', 'minor', 'question', 'curious', 'how to',
      'documentation', 'guidance', 'inquiry', 'feature request', 'feedback',
    ],
    suggestedActions: [
      'Provide standard knowledge-base article or documentation link.',
      'Log user feedback in product backlog if applicable.',
    ],
  },
];

/**
 * Triage a customer support request
 * @param {string} subject
 * @param {string} description
 * @returns {object} { category, priority, summary, confidence, suggestedActions }
 */
const triageRequest = (subject = '', description = '') => {
  const combinedText = `${subject} ${description}`.toLowerCase();

  // 1. Determine Category
  let matchedCategory = 'General Inquiry';
  let bestCategoryMatches = 0;
  let categoryConfidence = 0.85;

  for (const rule of CATEGORY_RULES) {
    let matchCount = 0;
    for (const kw of rule.keywords) {
      if (combinedText.includes(kw)) {
        matchCount++;
      }
    }
    if (matchCount > bestCategoryMatches) {
      bestCategoryMatches = matchCount;
      matchedCategory = rule.category;
      categoryConfidence = Math.min(
        0.98,
        rule.baseConfidence + matchCount * 0.02
      );
    }
  }

  // 2. Determine Priority & Suggested Actions
  let matchedPriority = 'Medium';
  let suggestedActions = [
    'Review request details and verify customer environment.',
    'Contact customer through request chat to clarify symptoms.',
  ];

  for (const rule of PRIORITY_RULES) {
    const hasMatch = rule.keywords.some((kw) => combinedText.includes(kw));
    if (hasMatch) {
      matchedPriority = rule.priority;
      suggestedActions = rule.suggestedActions;
      break;
    }
  }

  // 3. Generate Clean Executive Summary
  const cleanSubject = subject.trim();
  const firstSentence = description.trim().split(/[.!?\n]/)[0] || '';
  let summary = '';
  if (firstSentence && firstSentence.length > 10 && firstSentence.length < 150) {
    summary = `${cleanSubject}: ${firstSentence}.`;
  } else {
    summary = `${cleanSubject} - Triage categorizes this under ${matchedCategory} with ${matchedPriority} priority.`;
  }

  return {
    category: matchedCategory,
    priority: matchedPriority,
    summary,
    confidence: Number(categoryConfidence.toFixed(2)),
    suggestedActions,
  };
};

module.exports = { triageRequest };
