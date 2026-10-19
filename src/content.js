import { RESOURCES } from '../shared/resources.js';

export const HELP_SITUATIONS = [
  {
    id: 'money', title: 'I sent money', hint: 'A transfer, PayNow, or gift cards',
    urgent: true,
    steps: [
      { t: 'Call your bank now', d: 'Use the number on the back of your card or inside your bank\'s official app, not a number from the message. Say: "I have been scammed. Please stop or recall my transfer and freeze my account."' },
      { t: 'Tell the bank the details', d: 'The amount, the time, and the account or PayNow number you sent it to. A rough guess is fine. Speed matters more than being exact.' },
      { t: 'Cannot reach your bank?', d: 'Call the ScamShield Helpline 1799. It is free and open 24 hours, and it can connect you to your bank. It cannot file a police report for you.' },
      { t: 'Stop all contact', d: 'Do not send any more money, even for a "fee" to get your money back. Do not reply to the scammer.' },
      { t: 'File a police report', d: 'Do this after you have called the bank. You can prepare a draft in SafeKaki first to save time.' },
      { t: 'Keep your evidence', d: 'Do not delete the chat. Keep screenshots, phone numbers, and your bank receipts.' },
    ],
    resources: [RESOURCES.bank, RESOURCES.helpline, RESOURCES.policeReport],
  },
  {
    id: 'creds', title: 'I shared an OTP, password or card details', hint: 'Even if no money has gone yet',
    urgent: true,
    steps: [
      { t: 'Call your bank now', d: 'Ask them to block your card and online banking. Use the number on your card or in the official app.' },
      { t: 'Change your passwords', d: 'Start with your banking and email. Use a phone or computer you trust. Then change SingPass and other accounts that use the same password.' },
      { t: 'Check your recent activity', d: 'Open your bank\'s official app and look for payments or transfers you do not recognise. Tell the bank straight away if you see any.' },
      { t: 'Expect follow-up calls', d: 'Scammers often call again pretending to "help recover" your money. Hang up. Only deal with your bank directly.' },
      { t: 'Report it', d: 'If money moved or your details were used, file a police report. You can call 1799 if you are unsure what to do next.' },
    ],
    resources: [RESOURCES.bank, RESOURCES.helpline, RESOURCES.policeReport],
  },
  {
    id: 'link', title: 'I clicked a link', hint: 'But did not type anything, or I am not sure',
    steps: [
      { t: 'Close the page', d: 'Do not type anything else. Do not log in.' },
      { t: 'Did you type a password, code or card number?', d: 'If yes, treat it as shared and follow the steps for "I shared an OTP, password or card details".' },
      { t: 'Did the link install an app or file?', d: 'Delete it, then call your bank. Some fake apps can see your screen and messages.' },
      { t: 'Check your bank app', d: 'Open the official app yourself and look for anything unusual.' },
      { t: 'Report the message', d: 'Report it in the ScamShield app, then block the sender.' },
    ],
    resources: [RESOURCES.scamshield, RESOURCES.helpline],
  },
  {
    id: 'call', title: 'Someone is calling or messaging me right now', hint: 'Claims to be the bank, police or government',
    steps: [
      { t: 'Hang up or stop replying', d: 'Real banks, police and government officers never ask you to move money, share an OTP, or keep a case secret.' },
      { t: 'Do not call back any number they gave you', d: 'Look up the organisation yourself and use its official number, or the number on your card.' },
      { t: 'Do not install apps or share your screen', d: 'No genuine officer needs this.' },
      { t: 'Talk to someone you trust', d: 'Tell a family member or friend. Scammers rely on you staying quiet.' },
      { t: 'Check with 1799', d: 'The ScamShield Helpline can tell you whether it sounds like a scam.' },
    ],
    resources: [RESOURCES.helpline, RESOURCES.scamshield],
  },
  {
    id: 'unsure', title: 'I am not sure what happened', hint: 'Something feels wrong',
    steps: [
      { t: 'Do not click or reply yet', d: 'Take a moment. Real organisations do not mind you checking first.' },
      { t: 'Check the message in SafeKaki', d: 'Paste it in and see what warning signs it has.' },
      { t: 'Or call 1799', d: 'The ScamShield Helpline is free, open 24 hours, and can help you decide.' },
    ],
    resources: [RESOURCES.helpline, RESOURCES.scamshield],
  },
];

export const SCAM_TYPES = [
  { id: 'bank', title: 'Fake bank messages', how: 'A message or call says your account is locked or has a problem, and asks you to click a link or share an OTP.', signs: ['Asks for your OTP, PIN or password', 'Link that does not match your bank\'s real website', 'Pressure: "verify within 24 hours or your account will be blocked"'], todo: 'Open your bank\'s official app yourself. Never use the link or number in the message.' },
  { id: 'parcel', title: 'Parcel and delivery scams', how: 'You get a message that a parcel is stuck or needs a small fee, with a link to "release" it.', signs: ['You were not expecting a parcel', 'A small payment or card details to "redeliver"', 'Link from an unknown website'], todo: 'Check the courier\'s official app, or type their website address yourself.' },
  { id: 'gov', title: 'Fake police or government officers', how: 'A caller says you are linked to a crime and tells you to transfer money to a "safe account" or keep it secret.', signs: ['Threats of arrest or court action', 'Told not to tell family or the bank', 'Asked to install an app or share your screen'], todo: 'Hang up. Government officers never ask you to move money. Call 1799 to check.' },
  { id: 'friend', title: 'Family or friend with a "new number"', how: 'Someone messages "Hi mum, this is my new number" and soon asks for money urgently.', signs: ['New number and a story about why they cannot call', 'An urgent money request', 'Unusual wording for that person'], todo: 'Call the person on their old number first, before sending anything.' },
  { id: 'job', title: 'Easy job and commission scams', how: 'You are offered good pay for simple tasks like liking videos. Later you are asked to pay in to "unlock" earnings.', signs: ['Very high pay for very little work', 'Contacted out of the blue on WhatsApp or Telegram', 'Asked to top up your own money'], todo: 'Do not pay to earn. Block and report.' },
  { id: 'invest', title: 'Investment and crypto scams', how: 'Someone promises guaranteed high returns, often through a friendly online contact or a group chat.', signs: ['"Guaranteed" or "risk-free" returns', 'Pressure to invest quickly', 'Withdrawals need extra fees'], todo: 'Speak to your bank or call 1799 before investing anything.' },
  { id: 'prize', title: 'Prizes and refunds', how: 'You are told you won something or are owed a refund, but must pay a fee or enter your details to get it.', signs: ['You never entered a contest', 'A fee to receive a prize', 'Link asking for card details'], todo: 'Ignore it. Real refunds do not ask for your card details through a link.' },
];
