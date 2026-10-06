// Scam-rule fixtures and engine checks. No dependencies:
//   node trustgraph_extension/test/rules.test.js
// Goal (from the spec): every scam fixture scores at least Caution, every
// benign fixture stays Low. Prints a precision/recall table; exits 1 on any
// failure.
//
// Fixtures are written for testing, not taken from real people. The
// Malayalam, Manglish and Hinglish ones need a native speaker's review.
"use strict";

require("../shared/rules/normalize.js");
require("../shared/rules/rules.js");
const E = require("../shared/rules/engine.js");
const { normalize } = require("../shared/rules/normalize.js");

const UNKNOWN = { sender: "+91 98470 12345", senderHistory: 0, inChat: true };
const FRIEND = { sender: "Arjun K", senderHistory: 40, inChat: true };

// [category, language, text, meta]
const SCAMS = [
  ["email-phish", "en", "Subject: Action required\nDear customer, your account has been suspended due to unusual sign-in activity. Click here to verify your identity and restore access.", { sender: "security@paypa1-support.com", senderName: "PayPal Support" }],
  ["email-phish", "en", "Subject: Invoice\nPlease review the attached invoice and confirm your billing details.", { sender: "paypal.billing.team@gmail.com", senderName: "PayPal" }],
  ["email-phish", "en", "Subject: Your SBI statement\nView your statement here: www.onlinesbi.sbi", { sender: "noreply@statements-mailer.com", senderName: "Statements", links: [{ href: "https://sbi-statement.verify-now.top/login", text: "www.onlinesbi.sbi" }] }],
  ["email-phish", "en", "Subject: Mailbox almost full\nYour mailbox is almost full. Tap the button below to upgrade storage and avoid losing emails.", { sender: "admin@mail-quota-center.com", senderName: "Mail Admin" }],
  ["giveaway", "en", "Free Nitro for everyone! Claim here: dlscord-gift.xyz/claim", UNKNOWN],
  ["giveaway", "en", "Steam gift for you, claim it before midnight steamcornmunity.ru/gift", UNKNOWN],
  ["job", "en", "Hi! We have a remote job for you: earn 3000 daily by liking videos.", UNKNOWN],
  ["otp", "en", "Hi, I sent a code to your number by mistake. Can you please send me the OTP you just got? Urgent.", UNKNOWN],
  ["otp", "manglish", "Hello chetta, ningalude phone il oru OTP vannittundu, athu onnu paranju tharamo? Urgent aanu", UNKNOWN],
  ["otp", "ml", "നിങ്ങളുടെ ഫോണിൽ വന്ന ഒടിപി ഒന്ന് പറയാമോ? അത്യാവശ്യമാണ്", UNKNOWN],
  ["otp", "en-leet", "Pl34se s3nd me the O T P urgently, my account is stuck", UNKNOWN],
  ["upi", "en", "Congratulations! You have received a cashback of Rs 2,000. Enter your UPI PIN to receive the amount in your account.", UNKNOWN],
  ["upi", "hinglish", "Sir aapka refund ₹4,999 approve ho gaya hai. Bas PhonePe pe request accept karo aur UPI PIN daalo, paise turant aa jayenge", UNKNOWN],
  ["link+kyc", "en", "Dear customer your SBI account will be blocked today. Update your KYC immediately: http://bit.ly/sbi-kyc-upd", UNKNOWN],
  ["link+kyc", "en", "HDFC Bank: Your netbanking is suspended. Re-verify at https://hdfc-netbanking-verify.xyz/login", UNKNOWN],
  ["courier+link", "en", "India Post: your parcel could not be delivered. Reschedule at http://45.77.12.9/indiapost within 24 hours", UNKNOWN],
  ["link+kyc", "en", "Apple ID locked. Your account has been suspended, verify now: https://xn--pple-43d.com/verify", UNKNOWN],
  ["digital-arrest", "en", "This is CBI cyber cell. A parcel in your name with illegal drugs was seized at Mumbai customs. You are under digital arrest, join the video call now and don't tell anyone.", UNKNOWN],
  ["police", "manglish", "Ningalude peril oru police case undu, ippo thanne 25000 pay cheythillenkil arrest cheyyum", UNKNOWN],
  ["electricity", "en", "Dear consumer your electricity power will be disconnected tonight at 9:30 pm because your previous month bill was not updated. Please contact our electricity officer immediately.", UNKNOWN],
  ["electricity", "ml", "പ്രിയ ഉപഭോക്താവേ, നിങ്ങളുടെ കറന്റ് ഇന്ന് രാത്രി കട്ട് ചെയ്യും. ഉടനെ ഈ നമ്പറിൽ വിളിക്കുക", UNKNOWN],
  ["lottery", "en", "KBC lucky draw: Your number has won Rs 25 lakh! To claim your prize pay the processing fee of Rs 12,500.", UNKNOWN],
  ["lottery", "ml", "അഭിനന്ദനങ്ങൾ! നിങ്ങൾക്ക് 10 ലക്ഷം രൂപ സമ്മാനം ലഭിച്ചു. തുക ലഭിക്കാൻ 5000 രൂപ ഫീസ് അടയ്ക്കുക", UNKNOWN],
  ["job", "en", "Part time job offer! Earn Rs 3000 per day by liking YouTube videos. Simple tasks, join our Telegram group.", UNKNOWN],
  ["job", "manglish", "Part time job undu, veetil irunnu divasam 2000 rs kittum. Registration fee 500 adakkanam", UNKNOWN],
  ["investment", "en", "Join our WhatsApp trading group for guaranteed 20% weekly returns. Invest 10,000 and double your money in a month!", UNKNOWN],
  ["investment", "hinglish", "Bhai crypto me invest karo, 1 mahine me paisa double guaranteed. USDT bhejo is wallet address pe", UNKNOWN],
  ["new-number", "en", "Hi Mum, this is my new number, my phone fell in water. Can you send me Rs 15,000 for a bill? I'll pay you back tomorrow", UNKNOWN],
  ["new-number", "manglish", "Amma, ithu ente puthiya number aanu. Phone kedayi. Oru 5000 rs gpay cheyyamo, urgent aanu", UNKNOWN],
  ["remote-access", "en", "Your bank app has a problem. Please install AnyDesk and share the 9 digit code so our technician can fix it.", UNKNOWN],
  ["gift-card", "en", "Hey it's your manager. I need you to buy 5 Google Play gift cards for a client urgently and send me the codes. Keep this between us.", UNKNOWN],
  ["blackmail", "en", "I have your private video. Pay Rs 50,000 or I will send it to all your family and friends on Instagram.", UNKNOWN],
  ["blackmail", "hinglish", "Tumhara video mere paas hai, 20000 bhejo warna video viral kar dunga", UNKNOWN],
  ["courier-fee", "hinglish", "Aapka parcel customs mein ruka hai, ₹1,500 customs charge bharo warna parcel wapas chala jayega", UNKNOWN],
];

const BENIGN = [
  ["email", "en", "Subject: Security alert\nNew sign-in on Windows. We noticed a new sign-in to your Google Account. If this was you, you dont need to do anything. If not, we will help you secure your account.", { sender: "no-reply@accounts.google.com", senderName: "Google" }],
  ["email", "en", "Subject: Update your payment\nYour payment was declined. Please update your payment method to keep watching.", { sender: "info@account.netflix.com", senderName: "Netflix", links: [{ href: "https://www.netflix.com/YourAccount", text: "Update payment" }] }],
  ["email", "en", "Subject: This week at the library\nNew books, events and a reading club on Saturday. See the full list on our website.", { sender: "news@citylibrary.org", senderName: "City Library", links: [{ href: "https://click.mailchimpapp.com/track?u=1", text: "See the full list" }, { href: "https://citylibrary.org/events", text: "citylibrary.org/events" }] }],
  ["email", "en", "Subject: Your order has shipped\nYour package is on the way and will arrive Thursday.", { sender: "shipment-tracking@amazon.in", senderName: "Amazon.in" }],
  ["work", "en", "We are hiring for a remote job, apply on our careers page", FRIEND],
  ["chat", "en", "I watched the giveaway stream yesterday, so fun", FRIEND],
  ["links", "en", "Slides are at https://docs.google.com/presentation/d/1 and the images load from https://lh3.googleusercontent.com/x", FRIEND],
  ["links", "en", "Here's the Nitro gift I bought you: https://discord.gift/AbC123 enjoy!", FRIEND],
  ["student", "manglish", "Da, nale lab exam undo? Record ezhuthi theernno?", FRIEND],
  ["student", "ml", "നാളെ കോളേജ് അവധിയാണ്, മഴ കാരണം", FRIEND],
  ["dev", "en", "Bro the OTP flow is broken on staging, can you check the verify-otp API?", FRIEND],
  ["dev", "en", "Send me the code for the login page, I'll review the PR tonight", FRIEND],
  ["dev", "en", "Deployed to Vercel: https://trustgraph-demo.vercel.app and the repo is github.com/ritvik/trustgraph", FRIEND],
  ["dev", "en", "Can you share the OTP screen design from Figma? Need it for the sprint demo", FRIEND],
  ["bank-alert", "en", "Dear Customer, Rs 500.00 debited from A/c XX1234 on 05-10-26 to UPI/okaxis. Not you? Call 1800 1234. Never share your OTP or PIN with anyone. -SBI", { sender: "SBI", senderHistory: 30, inChat: true }],
  ["otp-sms", "en", "Your OTP for login is 482913. It is valid for 10 minutes. Do not share it with anyone.", { sender: "VK-AMAZON", senderHistory: 12, inChat: true }],
  ["family", "en", "Amma, I'll be late today, missed the bus. Reach by 8", FRIEND],
  ["family", "ml", "അമ്മേ, ഞാൻ ഇന്ന് വൈകും. ബസ് പോയി", FRIEND],
  ["money-friend", "manglish", "Can you gpay 150 for the canteen bill? I'll return tomorrow", FRIEND],
  ["celebration", "manglish", "Congrats on winning the hackathon da!! Party venam 🎉", FRIEND],
  ["lottery-talk", "manglish", "Kerala lottery result vannu, nammal onnum adichilla 😂", FRIEND],
  ["new-number", "en", "Hey, this is my new number. Save it - Arjun", FRIEND],
  ["meeting", "en", "Meeting moved to 4pm, link: meet.google.com/abc-defg-hij", FRIEND],
  ["shopping", "en", "Your Amazon order has been delivered. Rate your experience at amazon.in/review", { sender: "AMAZON", senderHistory: 8, inChat: true }],
  ["deadline", "en", "Urgent: submit the assignment before midnight, sir said no extension", FRIEND],
  ["plans", "hinglish", "Bhai kal ka plan kya hai? Movie chalein?", FRIEND],
  ["surprise", "en", "Don't tell anyone but I'm planning a surprise party for Meera 🤫", FRIEND],
  ["bill-paid", "en", "Electricity bill paid ✅ ₹1,240 via KSEB app", FRIEND],
  ["police-talk", "en", "The police came to college today for the traffic awareness class", FRIEND],
  ["screen-share", "en", "Can you share your screen in the meet? I want to see the bug", FRIEND],
  ["investing", "manglish", "Invest cheyyan pattiya mutual fund ethanu? SIP thudangiyalo?", FRIEND],
  ["promo", "en", "Use code TRUST50 to get 50% off on your first order", FRIEND],
  ["password", "en", "I won't ask for your password, just reset it from settings", FRIEND],
];

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log("FAIL", msg);
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const byCat = {};
let tp = 0;
let fn = 0;
let fp = 0;
let tn = 0;
console.log("\nSCAM fixtures (need >= Caution)");
for (const [cat, lang, text, meta] of SCAMS) {
  const r = E.analyze(text, meta);
  const ok = r.band !== "Low";
  ok ? tp++ : fn++;
  (byCat[cat] = byCat[cat] || { n: 0, hit: 0 }).n++;
  if (ok) byCat[cat].hit++;
  const rules = r.flags.map((f) => f.ruleId).join(", ");
  console.log(`${ok ? "PASS" : "FAIL"} ${r.band.padEnd(7)} ${r.score.toFixed(2)} [${cat}/${lang}] ${rules}`);
  if (!ok) fail(`scam scored Low: ${JSON.stringify(text)} weak: ${r.weakSignals.join(", ")}`);
  for (const f of r.flags) {
    if (f.evidence && f.evidence.start >= 0 && text.normalize("NFKC").slice(f.evidence.start, f.evidence.end) !== f.evidence.text) {
      fail(`evidence span doesn't match the original text for ${f.ruleId}: ${JSON.stringify(f.evidence)}`);
    }
  }
}
console.log("\nBENIGN fixtures (need Low)");
for (const [cat, lang, text, meta] of BENIGN) {
  const r = E.analyze(text, meta);
  const ok = r.band === "Low";
  ok ? tn++ : fp++;
  console.log(`${ok ? "PASS" : "FAIL"} ${r.band.padEnd(7)} ${r.score.toFixed(2)} [${cat}/${lang}] ${r.weakSignals.join(", ") || "-"}`);
  if (!ok) fail(`benign flagged ${r.band}: ${JSON.stringify(text)} -> ${r.flags.map((f) => f.ruleId).join(", ")}`);
}

// ---------------------------------------------------------------------------
// Engine guarantees
// ---------------------------------------------------------------------------
console.log("\nEngine checks");
const check = (ok, label) => (ok ? console.log("PASS", label) : fail(label));

{
  // One keyword can never produce High, even from an unsaved number.
  const r = E.analyze("Please share your OTP", UNKNOWN);
  check(r.band === "Caution" && r.score <= E.SINGLE_CAP, `single rule capped below High (got ${r.band} ${r.score})`);
}
{
  // Negation, both before (English) and after (Manglish, Hindi).
  check(E.analyze("We will never ask for your password.", UNKNOWN).band === "Low", "English negation: 'never ask for your password'");
  check(E.analyze("OTP aarodum share cheyyaruthu", UNKNOWN).band === "Low", "Manglish after-negation: 'share cheyyaruthu'");
  check(E.analyze("OTP kisi ko mat batana", UNKNOWN).band === "Low", "Hinglish negation: 'mat batana'");
  check(E.analyze("ബാങ്ക് ഒരിക്കലും ഒടിപി ചോദിക്കില്ല", UNKNOWN).band === "Low", "Malayalam: bank never asks OTP");
}
{
  // Evidence quotes the original text exactly, including disguises.
  const t = "Pl34se s3nd me the O T P urgently";
  const f = E.analyze(t, UNKNOWN).flags.find((x) => x.ruleId === "otp_request");
  check(f && f.evidence.text === "s3nd me the O T P", `evidence keeps the original spelling (${f && JSON.stringify(f.evidence.text)})`);
}
{
  // Dev context dampens OTP words; the same request elsewhere flags.
  check(E.analyze("send me the otp verification api docs, the repo is on github", FRIEND).band === "Low", "dev chat about OTP API stays Low");
}
{
  // Combination: link + urgency + money beats any single sign.
  const r = E.analyze("Pay Rs 99 now to avoid suspension: http://pay-now-help.in/x urgent", UNKNOWN);
  check(r.flags.some((f) => f.ruleId === "combo_link_urgency_money"), "link + urgency + money combination fires");
}
{
  // Sender weight: same text, saved contact with history scores lower.
  const t = "Install AnyDesk so I can fix your phone";
  const a = E.analyze(t, UNKNOWN).score;
  const b = E.analyze(t, FRIEND).score;
  check(a > b, `unsaved number scores higher than a long-time contact (${a} > ${b})`);
}
{
  // Window: a scam split across three bubbles from one sender.
  const items = [
    { id: "m1", text: "Hi Amma, this is my new number", sender: "+91 90000 11111", senderHistory: 0, prevSameSender: false },
    { id: "m2", text: "my phone fell in water", sender: "+91 90000 11111", senderHistory: 1, prevSameSender: true },
    { id: "m3", text: "can you send me Rs 10,000 today? urgent", sender: "+91 90000 11111", senderHistory: 2, prevSameSender: true },
  ];
  const res = E.analyzeChat(items);
  const singleMax = Math.max(...items.map((it) => E.analyze(it.text, { ...it, inChat: true }).score));
  const last = res.m3;
  check(last.window === 3 && last.score > singleMax, `run of 3 messages scored together (${singleMax} -> ${last.score} ${last.band})`);
  const ids = new Set(last.flags.map((f) => f.messageId));
  check(ids.has("m1") && ids.has("m3"), "window flags point at the message each sign came from");
}
{
  // Server merge: server can raise the verdict; signals come from it.
  const local = E.analyze("hello there", FRIEND);
  const server = { band: "High", score: 0.9, explanation: "Matches known scams", signals: [{ name: "similarity", score: 0.9, explanation: "x" }] };
  const c = E.combine(local, server, "server");
  check(c.band === "High" && c.flags[0].ruleId === "server" && c.signals.length === 1 && c.source === "server", "server verdict merged in with its signals");
  const off = E.combine(local, null, "offline");
  check(off.source === "basic" && off.offline, "offline falls back to the basic check");
}
{
  // Normaliser details.
  check(normalize("ഫോൺ").norm === normalize("ഫോണ്‍").norm, "Malayalam chillu spellings normalise the same");
  check(normalize("Use code TRUST50, Rs500").norm === "use code trust50, rs500", "leetspeak leaves codes and amounts alone");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
console.log("\n| Set | Fixtures | Correct |\n|---|---|---|");
console.log(`| Scam (>= Caution) | ${SCAMS.length} | ${tp} |`);
console.log(`| Benign (Low) | ${BENIGN.length} | ${tn} |`);
console.log(`\nPrecision ${(precision * 100).toFixed(1)}%  (flagged messages that were scams)`);
console.log(`Recall    ${(recall * 100).toFixed(1)}%  (scams that were flagged)`);
console.log("\n| Category | Scam fixtures | Detected |\n|---|---|---|");
for (const [cat, v] of Object.entries(byCat)) console.log(`| ${cat} | ${v.n} | ${v.hit} |`);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
