// Official Singapore resources. Single source of truth for web app, API and Telegram bot.
// URLs/numbers below were checked against scamshield.gov.sg and police.gov.sg pages.
// Re-verify before launch: official sites change.
export const RESOURCES = {
  helpline: {
    id: 'helpline',
    name: 'ScamShield Helpline',
    phone: '1799',
    phoneOverseas: '+65 6869 1799',
    url: 'https://www.scamshield.gov.sg/check-for-scams/scamshield-helpline/',
    note: 'Free, 24/7. Ask if something is a scam, or get connected to your bank if you were scammed. It cannot file a police report for you.',
  },
  scamshield: {
    id: 'scamshield',
    name: 'ScamShield (website and app)',
    url: 'https://www.scamshield.gov.sg',
    note: 'Official anti-scam resources. Report scam messages and calls through the ScamShield app.',
  },
  policeReport: {
    id: 'policeReport',
    name: 'Singapore Police Force: online police report',
    url: 'https://eservices1.police.gov.sg/phub/eservices/landingpage/police-report',
    note: 'File a police report online if you lost money or shared banking details.',
  },
  emergency: {
    id: 'emergency',
    name: 'Police emergency',
    phone: '999',
    note: 'Call 999 if you are in immediate danger.',
  },
  bank: {
    id: 'bank',
    name: 'Your bank',
    note: 'Call the hotline printed on the back of your card or shown inside your bank\'s official app. Do not use a number from the suspicious message.',
  },
};

export const SCAM_CATEGORIES = [
  'bank_or_card_phishing',
  'government_official_impersonation',
  'parcel_or_delivery',
  'investment_or_crypto',
  'job_or_commission',
  'ecommerce_or_marketplace',
  'romance_or_friend_impersonation',
  'loan_or_credit',
  'prize_or_refund',
  'tech_support_or_remote_access',
  'other',
  'unclear',
];

export const CATEGORY_LABELS = {
  bank_or_card_phishing: 'Bank or card phishing',
  government_official_impersonation: 'Impersonating the government or police',
  parcel_or_delivery: 'Parcel or delivery scam',
  investment_or_crypto: 'Investment or crypto scam',
  job_or_commission: 'Job or commission scam',
  ecommerce_or_marketplace: 'Online shopping or marketplace scam',
  romance_or_friend_impersonation: 'Romance or friend impersonation',
  loan_or_credit: 'Loan scam',
  prize_or_refund: 'Prize or refund scam',
  tech_support_or_remote_access: 'Tech support or remote access scam',
  other: 'Other',
  unclear: 'Not clear yet',
};

export const RISK_LABELS = {
  high_risk: 'High risk',
  suspicious: 'Suspicious',
  insufficient_evidence: 'Not enough evidence',
};
