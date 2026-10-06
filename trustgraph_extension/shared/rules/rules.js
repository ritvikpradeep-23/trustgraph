// TrustGraph scam rules (on-device). Used by shared/rules/engine.js.
//
// Each rule: {id, title, reason, weight, kind, patterns, ...options}
//   title    short label shown in the panel
//   reason   one plain-language sentence: why this matters
//   weight   0..1 contribution to the score (see engine.js for how they
//            combine). Single rules are capped below "High" by the engine.
//   kind     "rule" (a scam sign), "modifier" (urgency/secrecy/money: only
//            matter alongside a real sign) or "weak" (low-weight context)
//   patterns regexes over NORMALISED text (lowercase, leetspeak undone,
//            spaced letters joined; see normalize.js). Malayalam patterns
//            may use either chillu spelling: P() normalises them.
// Options:
//   negatable    default true. A negator shortly before the match ("we
//                will NEVER ask for your OTP"), or after it for Malayalam,
//                Manglish and Hindi, which negate after the verb ("OTP
//                aarodum share cheyyaruthu"), cancels the match.
//   devSensitive in a developer conversation (repo, deploy, API…) the
//                weight drops to a quarter: "send me the OTP flow" isn't
//                a scam.
//   exclude      regex tested right after the match start; if it matches,
//                the hit is ignored ("otp flow", "otp api").
//
// Languages: English, Malayalam script, Manglish (Malayalam in Latin
// letters), Hinglish and Hindi. The non-English vocabulary was written
// without a native-speaker review; please check it (see README).
(function (root) {
  "use strict";
  const N = root.TrustGraphNormalize || (typeof require !== "undefined" ? require("./normalize.js") : null);

  // Build a regex from a pattern source: Malayalam chillu forms normalised,
  // global + unicode flags.
  const P = (src) => new RegExp(N.mlNormalize(src), "gu");

  // Shared vocabulary ---------------------------------------------------------
  const SEND = String.raw`(?:send|share|give|tell|forward|read(?: out)?|provide|confirm|text|reply with|type|say|whatsapp)`;
  const OTP = String.raw`(?:otp|one[- ]?time (?:pass(?:word|code)?|code)|verification code|security code|login code|auth(?:entication)? code|sms code|[46][- ]?digit (?:code|number|otp|pin))`;
  const SECRET = String.raw`(?:upi pin|atm pin|mpin|pin|cvv|cvc|password|passcode|net ?banking password|card (?:number|details)|expiry date)`;
  const MONEY = String.raw`(?:₹|\brs\.? ?|\binr ?|rupees? ?)`;
  const BRANDS = String.raw`(?:google play|play store|amazon(?: pay)?|apple|itunes|steam|flipkart|razer gold)`;

  const RULES = [
    // --- credentials ------------------------------------------------------
    {
      id: "otp_request",
      title: "Asks for a one-time code, PIN or password",
      reason: "Banks and apps never ask you to share an OTP, PIN, CVV or password. Whoever has it can get into your account.",
      weight: 0.6,
      kind: "rule",
      devSensitive: true,
      exclude: /^\S*\s*(?:flow|screen|page|api|service|module|feature|template|logic|bug|issue|integration|endpoint|function|verification (?:api|flow|screen)|verify api|input|field|length|expiry|timer|resend|validation)\b/u,
      patterns: [
        P(String.raw`\b${SEND}\b(?: me| us| it| back)*(?: the| your| ur| that| this)? (?:${OTP}|${SECRET})\b`),
        P(String.raw`\b(?:what(?:'s| is)?|whats)(?: the| your| ur) (?:otp|pin|cvv|code)\b`),
        P(String.raw`\b(?:otp|code|pin) (?:that |which )?(?:you|u) (?:just )?(?:got|received|recieved|get)\b`),
        P(String.raw`\b(?:ask(?:ing)?|request(?:ing)?|need) (?:you )?(?:for )?(?:your |the |ur )?(?:${OTP}|${SECRET})\b`),
        // Manglish: "OTP onnu paranju tharamo", "code ayakku", "phone il vanna OTP"
        P(String.raw`\b(?:otp|code|pin|cvv|password)\b[^.!?\n]{0,40}?\b(?:paranj(?:u)? tha(?:ru|ramo|roo|rumo)|para(?:yu|yoo|yamo|yo|yumo)|ayach(?:u)? tha(?:ru|ramo)|ayakk(?:u|oo|amo|anam|ane|umo)|share cheyy(?:u|oo|amo|anam|ane|umo)|tharu|tharamo|tharoo|onnu tharo)\b`),
        P(String.raw`\b(?:phone|mobile|sms)(?: il| ill)? vanna (?:otp|code|pin)\b`),
        // Malayalam script
        P(String.raw`(?:ഒടിപി|ഓടിപി|ഒ ടി പി|otp|കോഡ്|പിൻ|പാസ്‌വേഡ്)[^.!?\n]{0,40}?(?:പറയാമോ|പറയൂ|പറഞ്ഞു തര|അയക്കൂ|അയക്കാമോ|അയച്ചു തര|തരാമോ|തരൂ|ഷെയർ ചെയ്യൂ|ഷെയർ ചെയ്യാമോ)`),
        P(String.raw`വന്ന (?:ഒടിപി|കോഡ്|otp)`),
        // Hinglish / Hindi
        P(String.raw`\b(?:otp|code|pin|cvv|password)\b[^.!?\n]{0,30}?\b(?:bata(?:o|do|na|iye|ana|dijiye|dena)?|bhej(?:o|do|dijiye|na|dena)|share kar(?:o|do|na|iye|dena)|de do|dedo|bol(?:o|do))\b`),
        P(String.raw`(?:ओटीपी|कोड|पिन|पासवर्ड)[^.!?\n।]{0,30}?(?:बताओ|बताइए|बता दो|बताएं|भेजो|भेज दो|शेयर करो)`),
      ],
    },
    {
      id: "code_request",
      title: "Asks you to send a code",
      reason: "Codes you receive by SMS often unlock your accounts. Check who is asking and why.",
      weight: 0.2,
      kind: "weak",
      devSensitive: true,
      patterns: [P(String.raw`\b${SEND} (?:me |us )(?:the |that |this )?codes?\b`)],
    },
    {
      id: "upi_collect",
      title: "Says you'll receive money if you pay or enter your PIN",
      reason: "You never need to enter your UPI PIN, scan a QR or accept a request to RECEIVE money. Doing so sends money out.",
      weight: 0.55,
      kind: "rule",
      patterns: [
        P(String.raw`\benter (?:your |the )?(?:upi )?(?:pin|mpin)\b[^.!?\n]{0,40}\b(?:receive|get|claim|accept|credit)`),
        P(String.raw`\b(?:accept|approve) (?:the |this |my )?(?:collect |payment |upi |money )?request\b[^.!?\n]{0,40}\b(?:receive|get|refund|credit|cashback)`),
        P(String.raw`\bscan (?:this |the |my )?(?:qr|qr code|code)\b[^.!?\n]{0,30}\b(?:receive|get|claim|credit)`),
        P(String.raw`\b(?:send|pay|transfer) ${MONEY}?\d[\d,]*(?: rs| rupees)?\b[^.!?\n]{0,40}\b(?:receive|get back|get double|double)`),
        P(String.raw`\bcollect request\b`),
        // Manglish
        P(String.raw`\bpin (?:adich|kodutha|enter cheyth)\w*[^.!?\n]{0,30}\b(?:cash|panam|paisa|money|amount)\b[^.!?\n]{0,15}(?:varum|kittum)`),
        P(String.raw`\bqr scan cheyth\w*[^.!?\n]{0,30}(?:kittum|varum)`),
        // Hinglish
        P(String.raw`\b(?:pin|qr|request accept)\b[^\n]{0,80}\b(?:aa jayenge|aa jayega|mil jayenge|mil jayega|milenge|credit ho jayega)\b`),
        P(String.raw`\bpin (?:daalo|dalo|daal do|daaliye|enter karo)\b`),
        // Malayalam
        P(String.raw`(?:പിൻ|ക്യുആർ|qr)[^.!?\n]{0,40}(?:പണം|പൈസ|തുക)[^.!?\n]{0,20}(?:വരും|കിട്ടും|ലഭിക്കും)`),
      ],
    },
    // --- impersonation and pressure --------------------------------------
    {
      id: "kyc_block",
      title: "Says your account or KYC needs urgent action",
      reason: "Banks don't block accounts over chat or SMS and never ask you to update KYC, PAN or Aadhaar through a link.",
      weight: 0.5,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:update|complete|verify|re-?verify|link|submit)\b(?: your| ur| the)? (?:kyc|e-?kyc|pan(?: card| number)?|aadha?ar(?: card| number)?)\b`),
        P(String.raw`\b(?:kyc|e-?kyc)\b[^.!?\n]{0,20}\b(?:pending|expired|expire|incomplete|not updated|blocked|suspended)\b`),
        P(String.raw`\b(?:account|a\/c|acct|card|sim|wallet|netbanking|net banking|upi|bank|apple id|paytm|phonepe)\b[^.!?\n]{0,25}\b(?:will be|has been|is|gets|got|to be|will get|are)\b[^.!?\n]{0,12}\b(?:blocked|suspended|closed|deactivated|frozen|locked|disabled|terminated|on hold|restricted)\b`),
        // Manglish
        P(String.raw`\bkyc (?:update|complete) cheyy`),
        P(String.raw`\baccount (?:block|suspend|close) (?:aav|akum|aakum|cheyyum|aayi)`),
        P(String.raw`\b(?:pan|aadhaar|aadhar) (?:card )?(?:link|update) cheyy`),
        // Hinglish / Hindi
        P(String.raw`\bkyc (?:update|complete|verify) (?:karo|karein|kijiye|kar lo)\b`),
        P(String.raw`\b(?:account|khata|card|sim) (?:band|block|suspend) (?:ho )?(?:jayega|jaega|jayegi|ho jayega|kar diya jayega)\b`),
        P(String.raw`\b(?:pan|aadhaar|aadhar) (?:link|update) (?:karo|karein|kijiye)\b`),
        P(String.raw`(?:खाता|अकाउंट|कार्ड|सिम)[^.!?\n।]{0,25}(?:बंद|ब्लॉक)`),
        P(String.raw`(?:केवाईसी|kyc)[^.!?\n।]{0,20}(?:अपडेट|पूरा)`),
        // Malayalam
        P(String.raw`(?:അക്കൗണ്ട്|അക്കൌണ്ട്|കാർഡ്|സിം)[^.!?\n]{0,25}(?:ബ്ലോക്ക്|മരവിപ്പി|റദ്ദാ|സസ്പെൻഡ്)`),
        P(String.raw`(?:കെവൈസി|kyc|പാൻ|ആധാർ)[^.!?\n]{0,20}(?:അപ്ഡേറ്റ്|പുതുക്ക|ലിങ്ക്)`),
      ],
    },
    {
      id: "authority_threat",
      title: "Claims police, CBI, customs or a courier is involved",
      reason: "'Digital arrest', seized parcels and police video calls are scripts. Real agencies don't threaten you over chat or ask for money.",
      weight: 0.55,
      kind: "rule",
      patterns: [
        P(String.raw`\bdigital(?:ly)? arrest`),
        P(String.raw`\b(?:cbi|enforcement directorate|ncb|narcotics|customs|cyber ?(?:crime|cell|police)|police|trai|rbi|income tax|crime branch|interpol|fedex|dhl|blue ?dart|india ?post|speed ?post|courier)\b[^.!?\n]{0,60}\b(?:case|fir|warrant|arrest(?:ed)?|seized|illegal|drugs|narcotics|money laundering|suspended|investigation|video call|skype|held|on hold|detained|confiscated)\b`),
        P(String.raw`\b(?:parcel|package|courier|shipment|consignment)\b[^.!?\n]{0,40}\b(?:seized|held|on hold|stuck|detained|returned|confiscated|contains (?:drugs|illegal)|illegal|failed|undelivered|could not be delivered)\b`),
        P(String.raw`\bcustoms (?:duty|charge|charges|fee|clearance)\b`),
        // Manglish
        P(String.raw`\bpolice case\b|\barrest cheyy(?:um|unnu|ayirikkum)\b|\bcase (?:edukkum|register cheyy)`),
        P(String.raw`\bparcel\b[^.!?\n]{0,30}\b(?:pidichu|hold aanu|customs il|thadanju)`),
        // Hinglish / Hindi
        P(String.raw`\b(?:police|cbi)\b[^.!?\n]{0,40}\b(?:case|arrest|giraftaa?r|pakad)`),
        P(String.raw`\bparcel\b[^.!?\n]{0,30}\b(?:pakda|pakad liya|ruka|rok|customs (?:me|mein))`),
        P(String.raw`डिजिटल अरेस्ट|गिरफ्तार|पुलिस केस|कस्टम`),
        // Malayalam
        P(String.raw`ഡിജിറ്റൽ അറസ്റ്റ്|അറസ്റ്റ് ചെയ്യും|പോലീസ് കേസ്|കസ്റ്റംസ്`),
        P(String.raw`പാഴ്സൽ[^.!?\n]{0,30}(?:പിടിച്ചു|തടഞ്ഞു|കസ്റ്റംസ്)`),
      ],
    },
    {
      id: "legal_threat",
      title: "Threatens arrest or legal action",
      reason: "Threats of arrest, warrants or court cases are used to frighten you into paying quickly.",
      weight: 0.4,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:arrest(?:ed)?|arrest warrant|warrant|legal action|lawsuit|fir|prosecut(?:e|ed|ion)|court notice|non-?bailable)\b`),
        P(String.raw`\bgiraftaa?r\b|\barrest cheyy`),
      ],
    },
    {
      id: "power_cut",
      title: "Threatens to cut your electricity",
      reason: "Electricity boards don't message you to say power will be cut tonight or ask you to call an 'officer'.",
      weight: 0.55,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:electricity|power|light|eb|kseb|bses|tneb|tangedco|msedcl|bescom|cesc|current|electric(?:al)?|connection)\b[^.!?\n]{0,50}\b(?:will be|to be|going to be|shall be|would be|gets?) (?:disconnected|cut(?: off)?|discontinued)\b`),
        P(String.raw`\b(?:electricity|power|light|eb)\b[^.!?\n]{0,30}\bdisconnection\b`),
        P(String.raw`\b(?:contact|call)\b(?: our| the)? (?:electricity|eb|kseb|power) (?:officer|department|office)\b`),
        P(String.raw`\b(?:previous|last) month(?:'s)? bill\b[^.!?\n]{0,40}\b(?:not updated|not paid|unpaid|pending)\b`),
        // Manglish (only with a threat + bill, since "current cut aayi" is everyday talk)
        P(String.raw`\bbill\b[^\n]{0,60}\b(?:current|connection|kseb)\b[^\n]{0,30}\b(?:cut|vicched)\w*\s*(?:cheyyum|aakum|aavum)\b`),
        // Hinglish / Hindi
        P(String.raw`\b(?:bijli|light|connection)\b[^.!?\n]{0,25}\b(?:kat|cut|kaat)\b[^.!?\n]{0,10}\b(?:jayegi|jaegi|jayega|denge|di jayegi|ho jayegi)\b`),
        P(String.raw`बिजली[^.!?\n।]{0,25}(?:कट|काट)`),
        // Malayalam
        P(String.raw`(?:വൈദ്യുതി|കറന്റ്|കണക്ഷൻ)[^.!?\n]{0,30}(?:വിച്ഛേദിക്കും|കട്ട് ചെയ്യും|വിച്ഛേദിക്കപ്പെടും)`),
      ],
    },
    {
      id: "prize",
      title: "Says you've won a prize, lottery or cashback",
      reason: "You can't win a lottery or lucky draw you never entered. These 'wins' end with a fee to claim them.",
      weight: 0.45,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:you(?:'ve| have)?|u have|your (?:number|mobile|sim))\b[^.!?\n]{0,15}\b(?:won|been selected|selected as (?:a |the )?winner)\b[^.!?\n]{0,50}(?:₹|\brs\b|\binr\b|rupees|lakh|lakhs|crore|prize|reward|cash|iphone|car|gift|voucher|cashback|lottery|bumper)`),
        P(String.raw`\b(?:lucky draw|lucky winner|jackpot|kbc|kaun banega crorepati|bumper prize|prize money|cash prize)\b`),
        P(String.raw`\bclaim (?:your |the )?(?:prize|reward|gift|winnings|cashback|bonus)\b`),
        P(String.raw`\b(?:you have|you've) received (?:a )?(?:cashback|reward|prize|bonus)\b`),
        // Discord / Steam / crypto "giveaways" (free Nitro, skins, airdrops)
        P(String.raw`\bfree (?:discord )?nitro\b|\bnitro (?:giveaway|for free)\b|\b(?:steam|nitro|crypto|nft|token) (?:giveaway|airdrop)\b|\bfree (?:nft|airdrop|robux|skins?|v-?bucks)\b`),
        P(String.raw`\b(?:giveaway|airdrop|free gift)\b[^.!?\n]{0,60}\bclaim\b|\bclaim (?:it )?(?:here|now|below|before)\b`),
        // Manglish / Hinglish / Hindi / Malayalam
        P(String.raw`\b(?:ningalkk?u|ningalude number(?:inu)?|ninakku)\b[^.!?\n]{0,30}\b(?:prize|sammanam|lottery|cash|reward)\b`),
        P(String.raw`\b(?:aapne|aapka number|apne|aapko)\b[^.!?\n]{0,30}\b(?:jeeta|jeete|jeet liya|inaam|prize|lottery|lakh)\b`),
        P(String.raw`(?:आपने|आपको)[^.!?\n।]{0,30}(?:जीता|जीते|इनाम|लॉटरी)`),
        P(String.raw`(?:നിങ്ങൾക്ക്|താങ്കൾക്ക്)[^.!?\n]{0,30}(?:സമ്മാനം|ലോട്ടറി|ലക്ഷം)`),
        P(String.raw`അഭിനന്ദനങ്ങൾ[^\n]{0,60}(?:സമ്മാനം|ലക്ഷം|ലോട്ടറി)`),
      ],
    },
    {
      id: "lottery_mention",
      title: "Mentions a lottery",
      reason: "Lottery talk is common, but 'lottery wins' from strangers are a classic scam opener.",
      weight: 0.2,
      kind: "weak",
      patterns: [P(String.raw`\blottery\b|ലോട്ടറി|लॉटरी`)],
    },
    {
      id: "job_offer",
      title: "Offers easy part-time or task-based earnings",
      reason: "'Like videos and earn' and part-time task jobs pay a little at first, then ask you to deposit money you won't get back.",
      weight: 0.5,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:part[- ]?time|work[- ]from[- ]home|wfh|home[- ]based|online|remote)\b (?:job|work|jobs|opportunity|income|earning)s?\b[^.!?\n]{0,60}\b(?:earn|paid|pay|daily|per day|salary|income|₹|rs)\b|\b(?:part[- ]?time|work[- ]from[- ]home|wfh|home[- ]based)\b (?:job|work|jobs|opportunity|income|earning)s?\b`),
        P(String.raw`\b(?:earn|earning|salary|income|payout)\b[^.!?\n]{0,15}${MONEY}?\d[\d,]*k?\b[^.!?\n]{0,10}(?:\b(?:per|a|every|each|in a) ?(?:day|hour|hr|task|week)\b|\b(?:daily|hourly|weekly)\b)`),
        P(String.raw`\b(?:earn|paid|money|income)\b[^.!?\n]{0,40}\bby (?:liking|watching|rating|reviewing|subscribing|following)\b|\b(?:liking|watching|rating) (?:videos?|posts?|reels?|products?)\b[^.!?\n]{0,30}\b(?:earn|paid|pay)\b`),
        P(String.raw`\b(?:like|subscribe|rate|review|follow)\b[^.!?\n]{0,30}\b(?:and|&|to) earn\b`),
        P(String.raw`\b(?:simple|easy|small)\b (?:tasks?|work|job)\b[^.!?\n]{0,40}\b(?:earn|paid|pay|salary|income|commission)\b`),
        P(String.raw`\btelegram\b[^.!?\n]{0,20}\b(?:task|job|group|channel)\b[^.!?\n]{0,30}\b(?:earn|income|pay|join)`),
        P(String.raw`\bprepaid task\b|\btask (?:based )?(?:job|income)\b`),
        // Manglish
        P(String.raw`\bpart time (?:job|joli|work) (?:und|undu|undo)\b`),
        P(String.raw`\bveetil (?:irunnu|irunn) (?:job|joli|work|panam|cash|earn)`),
        P(String.raw`\bdivasam\b[^.!?\n]{0,15}\d+[^.!?\n]{0,10}\b(?:kittum|undakkam|earn)`),
        // Hinglish / Hindi
        P(String.raw`\bghar (?:baithe|se) (?:kamaye|kamao|kamaiye|earning|kamai|paise)`),
        P(String.raw`\broz(?:ana)?\b[^.!?\n]{0,15}\d+[^.!?\n]{0,10}\b(?:kamao|kamaye|kamaiye|kamai)\b`),
        P(String.raw`\bpart time (?:kaam|job|naukri) (?:hai|chahiye)\b`),
        P(String.raw`घर बैठे|कमाएं|कमाओ`),
        // Malayalam
        P(String.raw`പാർട്ട് ടൈം (?:ജോലി|ജോബ്)|വീട്ടിലിരുന്ന്[^.!?\n]{0,20}(?:സമ്പാദി|പണം|ജോലി)|ദിവസം[^.!?\n]{0,15}രൂപ[^.!?\n]{0,15}(?:സമ്പാദി|ലഭി|കിട്ടും)`),
      ],
    },
    {
      id: "upfront_fee",
      title: "Asks for a fee before you get money, a prize, a job or a parcel",
      reason: "Real prizes, jobs, refunds and deliveries don't ask you to pay a fee first.",
      weight: 0.5,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:registration|joining|security|processing|activation|release|clearance|delivery|customs|handling|unlock(?:ing)?|verification|gst|tax|courier|redelivery|re-?delivery|token|service) (?:fee|fees|charge|charges|amount|deposit)\b`),
        P(String.raw`\bpay (?:a |the |small |one[- ]time |refundable )*(?:fee|amount|charge|deposit)\b[^.!?\n]{0,30}\b(?:to|for|first|before)\b`),
        P(String.raw`\badvance (?:payment|fee|amount)\b`),
        P(String.raw`\b(?:pay|fee|charge|deposit|send|transfer)\b[^.!?\n]{0,50}\bto (?:claim|receive|release|unlock|get|activate|collect)\b(?: your| the)? (?:prize|reward|winnings|package|parcel|funds|refund|loan|job|salary|amount|money|gift|cashback)\b`),
        P(String.raw`\bto (?:claim|receive|release|unlock|activate|collect)\b(?: your| the)? (?:prize|reward|winnings|package|parcel|funds|refund|loan|job|salary|amount|money|gift|cashback)\b[^.!?\n]{0,50}\b(?:pay|fee|charge|deposit)\b`),
        // Manglish / Hinglish / Hindi / Malayalam
        P(String.raw`\b(?:fee|fees|charge|amount)\b[^.!?\n]{0,15}\b(?:adakkanam|adakkuka|adachal|adakkuu|ayakkanam)\b`),
        P(String.raw`\b(?:fee|fees|charge|shulk)\b[^.!?\n]{0,15}\b(?:bharo|bhariye|bhejo|jama karo|jama kare|dena hoga|deni hogi)\b`),
        P(String.raw`(?:शुल्क|फीस|चार्ज)[^.!?\n।]{0,15}(?:भरें|भरो|जमा करें|देना होगा)`),
        P(String.raw`(?:ഫീസ്|ചാർജ്|തുക)[^.!?\n]{0,20}(?:അടയ്ക്ക|അടക്ക|അയക്ക)`),
      ],
    },
    {
      id: "investment",
      title: "Promises guaranteed or doubled returns, or asks for crypto",
      reason: "No real investment guarantees profits or doubles your money. Crypto payments can't be reversed.",
      weight: 0.5,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:send|pay|deposit|transfer|invest|buy)\b(?:[^.!?\n]|\.\d){0,40}\b(?:bitcoin|btc|usdt|tether|ethereum|eth|crypto ?currency|crypto|binance)\b`),
        P(String.raw`\b(?:bitcoin|btc|usdt|crypto) (?:wallet|address|atm)\b|\bwallet address\b`),
        P(String.raw`\b(?:guaranteed|assured|fixed|risk[- ]free|sure[- ]?shot)\b (?:\d+ ?% )?(?:\w+ )?(?:returns?|profits?|income|gains?|earnings?)\b`),
        P(String.raw`\b(?:double|triple|2x|3x|10x)\b (?:your )?(?:money|investment|amount|capital)\b`),
        P(String.raw`\b\d{1,3} ?% (?:daily|per day|a day|weekly|per week|monthly|per month) (?:returns?|profits?|income|interest)\b`),
        P(String.raw`\b(?:trading|stock|forex|crypto|investment|ipo|option)s? (?:group|tips|signals|class|mentor|expert|guru|vip)\b`),
        P(String.raw`\bjoin\b[^.!?\n]{0,30}\b(?:telegram|whatsapp) (?:group|channel)\b[^.!?\n]{0,40}\b(?:trading|profit|stock|crypto|invest|returns?)\b`),
        // Manglish / Hinglish / Hindi / Malayalam
        P(String.raw`\binvest cheyth(?:al|aal)\b[^.!?\n]{0,30}\b(?:double|irattikkum|irattiyakum|labham|profit)\b`),
        P(String.raw`\bpaisa (?:double|dugna)\b|\bguaranteed (?:munafa|profit|return)\b|\bnivesh\b[^.!?\n]{0,30}\b(?:double|munafa|guaranteed)\b`),
        P(String.raw`पैसा डबल|गारंटीड (?:मुनाफा|रिटर्न)`),
        P(String.raw`(?:നിക്ഷേപ|ഇൻവെസ്റ്റ്)[^.!?\n]{0,30}(?:ഇരട്ടി|ലാഭം|ഉറപ്പ്)`),
      ],
    },
    {
      id: "new_number_family",
      title: "'Mum/Dad, this is my new number'",
      reason: "Scammers pose as your child or parent on a 'new number', then ask for money. Call the old number to check.",
      weight: 0.45,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:mum|mom|mummy|mumma|mama|amma|ammae|amme|dad|daddy|papa|pappa|achan|acha|achaa|appa|father|mother|maa)\b[^\n]{0,60}\b(?:new number|changed my number|lost my phone|phone (?:is )?(?:broken|damaged|dead|fell|lost|stolen|not working|kedayi|poyi|pottippoyi|kho gaya|toot gaya)|my old number|puthiya number|naya number)\b`),
        P(String.raw`\b(?:new number|puthiya number|naya number)\b[^\n]{0,60}\b(?:mum|mom|mummy|amma|dad|papa|achan|appa)\b`),
        P(String.raw`(?:അമ്മ|അമ്മേ|അച്ഛാ|അച്ഛൻ|അപ്പ)[^\n]{0,60}(?:പുതിയ നമ്പർ|ഫോൺ (?:പോയി|കേടായി|പൊട്ടി))`),
        P(String.raw`(?:मम्मी|माँ|पापा)[^\n]{0,60}(?:नया नंबर|फोन (?:खो|टूट))`),
      ],
    },
    {
      id: "new_number",
      title: "Says this is a new number",
      reason: "A 'new number' can be anyone. Confirm on the old number before trusting it.",
      weight: 0.2,
      kind: "weak",
      patterns: [P(String.raw`\b(?:this is my new number|my new number|changed my number|new number (?:aanu|hai)|ente puthiya number|mera naya number|ithu ente new number|lost my phone|phone (?:kedayi|poyi|kho gaya|toot gaya))\b|പുതിയ നമ്പർ|नया नंबर`)],
    },
    {
      // The everyday email phish: "your account is suspended / there was an
      // unusual sign-in / verify your identity / your mailbox is full",
      // always with a link or button to fix it.
      id: "account_phish",
      title: "Says your account has a problem and asks you to verify it",
      reason: "Real companies don't email you to 'verify your account' through a link. These messages lead to fake sign-in pages that steal your password.",
      weight: 0.5,
      kind: "rule",
      devSensitive: true,
      patterns: [
        P(String.raw`\b(?:your |the )?(?:account|profile|mailbox|card|access)\b[^.!?\n]{0,25}\b(?:has been|have been|will be|is being|is|was|got)\b(?: temporarily| permanently)? (?:suspended|locked|limited|disabled|deactivated|restricted|on hold|blocked|frozen|closed|terminated|compromised)\b`),
        P(String.raw`\b(?:unusual|suspicious|unauthori[sz]ed|unrecogni[sz]ed|strange) (?:sign[- ]?in|log[- ]?in|login|activity|access|attempt|transaction|device)s?\b`),
        P(String.raw`\b(?:verify|confirm|validate|re-?validate|update|restore|reactivate|unlock|secure)\b (?:your |the )?(?:account|identity|details|information|info|credentials|password|email address|e-?mail|mailbox|login|payment (?:details|information|method)|billing (?:details|information|address)|card details)\b`),
        P(String.raw`\b(?:your )?password (?:will )?(?:expire|expires|has expired|is expiring)\b`),
        P(String.raw`\b(?:mailbox|storage|inbox|e-?mail quota|quota)\b[^.!?\n]{0,15}\b(?:is |has )?(?:almost |nearly )?(?:full|exceeded|over (?:the )?limit)\b`),
        P(String.raw`\b(?:payment|card|transaction|subscription)\b (?:was |has been |is )?(?:declined|failed|unsuccessful|rejected)\b[^.!?\n]{0,60}\b(?:update|verify|click|confirm)\b`),
        P(String.raw`\b(?:click|tap|follow)\b (?:here|below|the link|this link|on the (?:link|button))\b[^.!?\n]{0,40}\b(?:verify|confirm|restore|unlock|reactivate|avoid|sign in|log ?in|update|validate)\b`),
      ],
    },
    {
      id: "remote_access",
      title: "Asks you to install a remote-access app",
      reason: "AnyDesk, TeamViewer and similar apps let a stranger control your phone, including your banking apps.",
      weight: 0.55,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:any ?desk|team ?viewer|rust ?desk|ultra ?viewer|quick ?support|airdroid|splashtop|logmein)\b`),
        P(String.raw`\bremote (?:access|desktop|control|support app)\b`),
        P(String.raw`\b(?:install|download)\b[^.!?\n]{0,30}\b(?:app|application|apk|software)\b[^.!?\n]{0,30}\b(?:access|control|fix|secure|technician)\b`),
        P(String.raw`\b(?:apk|app)\b[^.!?\n]{0,20}\b(?:install|download) cheyy|\b(?:apk|app) (?:install|download) karo\b`),
      ],
    },
    {
      id: "gift_card",
      title: "Asks you to buy or send gift cards",
      reason: "Scammers ask for gift card codes because the money can't be traced or refunded.",
      weight: 0.55,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:buy|purchase|get|grab|pick up|send|pay (?:with|in|using)|scratch|redeem|vaang|medich|kharid|le lo)\w*\b[^.!?\n]{0,40}\b(?:${BRANDS} )?(?:gift ?cards?|vouchers?)\b`),
        P(String.raw`\bgift ?cards?\b[^.!?\n]{0,40}\b(?:codes?|send|scratch|photo|pic|picture|ayakk|bhejo)\b`),
        P(String.raw`\b${BRANDS} (?:gift )?(?:cards?|vouchers?) (?:codes?|numbers?|pins?)\b`),
      ],
    },
    {
      id: "blackmail",
      title: "Threatens to share your private photos or videos",
      reason: "This is blackmail. Don't pay: block, keep the evidence, and report it at cybercrime.gov.in or by calling 1930.",
      weight: 0.6,
      kind: "rule",
      patterns: [
        P(String.raw`\b(?:your|ur) (?:private |nude |naked |intimate |personal )?(?:video|videos|photos?|pics?|pictures|recording|chats?)\b[^\n]{0,60}\b(?:will|'ll|or|otherwise|unless)\b[^\n]{0,25}\b(?:viral|leak|share|send|post|upload|publish|forward)`),
        P(String.raw`\b(?:i|we) (?:have|recorded|got|captured) (?:your|ur) (?:private |nude |naked |intimate )?(?:video|videos|photos?|pics?|recording)\b`),
        P(String.raw`\bpay\b[^.!?\n]{0,40}\bor (?:else )?(?:i|we)(?: will|'ll)? (?:share|post|leak|send|upload|make it viral)\b`),
        P(String.raw`\b(?:nude|naked) (?:video|photos?|pics?)\b`),
        P(String.raw`\bvideo (?:viral aakk|viral aak|leak cheyy|ellarkkum ayakk)`),
        P(String.raw`\bvideo viral kar (?:dunga|denge|dungi)\b|\bvideo (?:sabko|ghar walon|family) (?:ko )?bhej (?:dunga|denge)\b|\bwarna\b[^.!?\n]{0,30}\bviral\b`),
        P(String.raw`वीडियो वायरल`),
      ],
    },
    // --- modifiers: only matter alongside a real sign ---------------------
    {
      id: "urgency",
      title: "Pressures you to act fast",
      reason: "Scams create a deadline so you act before you think or ask anyone.",
      weight: 0.15,
      kind: "modifier",
      patterns: [
        P(String.raw`\b(?:do it now|right now|right away|immediately|urgent(?:ly)?|asap|today itself|last date|act now|hurry|time is running out|final (?:notice|warning|reminder))\b`),
        P(String.raw`\bwithin (?:\d+|one|two|24|48) ?(?:min|mins|minutes?|hours?|hrs?)\b|\b(?:expires?|expiring) (?:today|tonight|soon)\b|\bbefore (?:midnight|tonight)\b`),
        P(String.raw`\b(?:ippo thanne|ippol thanne|udane|vegam|urgent aanu|innu thanne|ippo venam)\b`),
        P(String.raw`\b(?:abhi ke abhi|turant|jaldi (?:karo|se|kijiye)|aaj hi|fauran)\b`),
        P(String.raw`ഉടനെ|ഇപ്പോൾ തന്നെ|വേഗം|അടിയന്തര|അത്യാവശ്യ|तुरंत|फौरन|जल्दी`),
      ],
    },
    {
      id: "secrecy",
      title: "Asks you to keep it secret",
      reason: "Being told not to tell anyone is a classic way to stop you checking with someone you trust.",
      weight: 0.3,
      kind: "modifier",
      negatable: false, // these phrases contain their own negation
      patterns: [
        P(String.raw`\b(?:don'?t|do not|never) (?:tell|inform|mention (?:this|it) to)\b[^.!?\n]{0,20}\b(?:anyone|anybody|your (?:bank|family|parents|wife|husband)|mum|mom|dad|mother|father|amma|achan|papa|my (?:wife|husband|parents))\b`),
        P(String.raw`\bkeep (?:this|it) (?:a )?(?:secret|between us|confidential|to yourself)\b|\bbetween (?:you and me|us only)\b`),
        P(String.raw`\b(?:aarodum|arodum|veetil|ammayodu|achanodu|aarum) (?:parayaruthu|parayalle|parayanda|ariyaruthu|ariyalle)\b`),
        P(String.raw`\b(?:kisi ko|kisiko|ghar (?:par|pe)|mummy ko|papa ko) mat (?:batana|bolna|kehna|bataana)\b|\bkisi se mat kehna\b`),
        P(String.raw`ആരോടും (?:പറയരുത്|പറയല്ലേ|പറയണ്ട)|किसी को (?:मत|ना) (?:बताना|बोलना)`),
      ],
    },
    {
      id: "money_request",
      title: "Asks you to send money",
      reason: "A money request on its own is normal between friends. It matters when it comes with other warning signs.",
      weight: 0.2,
      kind: "modifier",
      patterns: [
        P(String.raw`\b(?:send|transfer|pay|gpay|phonepe|paytm) (?:me |us )?${MONEY}?\d[\d,]*\b`),
        P(String.raw`\b(?:send|transfer|need|want) (?:me |us )?(?:some |the )?(?:money|cash|amount|funds)\b`),
        P(String.raw`\bneed ${MONEY}\d`),
        P(String.raw`\b(?:gpay|google pay|phonepe|paytm) (?:me\b|cheyy|chey|kar (?:do|dena)|karo)`),
        P(String.raw`\b(?:paisa|panam|cash|money|amount)\b[^.!?\n]{0,15}\b(?:ayakk|tharo|tharamo|venam|ayachu tharo|transfer cheyy)`),
        P(String.raw`\b(?:paise|paisa|rupaye|money)\b[^.!?\n]{0,15}\b(?:bhejo|bhej do|chahiye|transfer karo|de do|dedo)\b`),
        P(String.raw`\b\d[\d,]*k? ?(?:rs|rupees|rupaye)? (?:bhejo|bhej do|transfer karo|de do|dedo|ayakk\w*|ayach\w*|pay cheyy\w*|tharanam)\b`),
        P(String.raw`(?:പണം|പൈസ|രൂപ)[^.!?\n]{0,15}(?:അയക്ക|വേണം|തരാമോ|തരൂ)|(?:पैसे|पैसा|रुपये)[^.!?\n।]{0,15}(?:भेजो|भेज दो|चाहिए)`),
      ],
    },
  ];

  // Words that cancel a match when they come shortly BEFORE it.
  const NEG_BEFORE = /(?:^|[^\p{L}])(?:never|not|no|don'?t|dont|do not|won'?t|wont|will not|cannot|can'?t|nobody|no one|nor|neither|without|nahi|nahin|kabhi nahi|orikkalum|ഒരിക്കലും|कभी नहीं|नहीं)(?:$|[^\p{L}])/u;
  // ...and the AFTER-negation of Malayalam, Manglish and Hindi ("share
  // cheyyaruthu", "chodikkilla", "mat batana", "ചോദിക്കില്ല").
  const NEG_AFTER = /(?:ruthu|rudhu|kkilla|illa|venda|vendaa|\bnahi\b|\bnahin\b|\bmat\b|രുത്|ില്ല|ല്ല|വേണ്ട|नहीं|मत)/u;

  // Developer conversations: OTP/code words are about building things.
  const DEV_CONTEXT = /\b(?:repo|repository|deploy(?:ed|ing|ment)?|staging|production|pull request|\bpr\b|merge[ds]?|commit|branch|api|endpoint|backend|frontend|bug|github|gitlab|vercel|netlify|localhost|npm|function|component|figma|jira|sprint|code review|debug|unit test|test case|firebase|twilio|sdk|webhook|json|regex|server|database|schema)\b/u;

  // ---- Links -------------------------------------------------------------
  const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.ly", "cutt.ly", "rb.gy", "is.gd", "goo.gl", "ow.ly", "shorturl.at", "rebrand.ly", "tiny.cc", "s.id", "bitly.com", "short.gy", "v.gd", "t2m.io", "urlz.fr", "tny.im"]);
  const RISKY_TLDS = new Set(["xyz", "top", "click", "info", "buzz", "icu", "live", "shop", "online", "site", "club", "rest", "cfd", "sbs", "monster", "vip", "work", "loan", "win", "bid", "kim", "cyou", "quest"]);
  // Domains that are fine to link to (allowlist).
  const SAFE = new Set([
    "github.com", "githubusercontent.com", "gitlab.com", "google.com", "youtube.com", "youtu.be", "wikipedia.org", "linkedin.com", "instagram.com",
    "facebook.com", "whatsapp.com", "wa.me", "microsoft.com", "office.com", "notion.so", "stackoverflow.com", "npmjs.com", "figma.com", "zoom.us",
    "medium.com", "x.com", "twitter.com", "amazon.in", "amazon.com", "flipkart.com", "sbi.co.in", "onlinesbi.sbi", "hdfcbank.com", "icicibank.com",
    "axisbank.com", "kotak.com", "paytm.com", "phonepe.com", "npci.org.in", "bhimupi.org.in", "irctc.co.in", "kseb.in", "apple.com", "paypal.com",
    "netflix.com", "swiggy.com", "zomato.com", "spotify.com", "canva.com", "drive.google.com", "meet.google.com", "docs.google.com",
    "discord.com", "discord.gg", "discordapp.com", "discord.new", "steampowered.com", "steamcommunity.com", "telegram.org", "t.me", "slack.com",
    "gmail.com", "outlook.com", "live.com", "fb.com", "messenger.com", "metamask.io", "binance.com",
    // the brands' own content and API domains
    "googleapis.com", "googleusercontent.com", "googleblog.com", "gstatic.com", "googlevideo.com", "microsoftonline.com", "amazonaws.com",
    "fbcdn.net", "cdninstagram.com", "whatsapp.net", "telegram.me", "slack-edge.com", "slack-files.com", "discordapp.net", "steamstatic.com",
    "steamusercontent.com", "discord.gift", "licdn.com", "linkedin.cn", "paypal.me", "netflix.net",
  ]);
  // Hosting platforms anyone can publish on: neutral, unless the name
  // impersonates a brand.
  const HOSTING = new Set(["vercel.app", "netlify.app", "github.io", "web.app", "firebaseapp.com", "pages.dev", "blogspot.com", "wixsite.com", "000webhostapp.com", "weebly.com", "glitch.me", "onrender.com", "herokuapp.com"]);
  const BRAND_TOKENS = ["sbi", "hdfc", "icici", "axis", "kotak", "paytm", "phonepe", "gpay", "googlepay", "npci", "bhim", "upi", "amazon", "flipkart", "indiapost", "incometax", "uidai", "aadhaar", "aadhar", "kseb", "irctc", "epfo", "whatsapp", "paypal", "netflix", "apple", "bank", "kyc", "rbi",
    "discord", "steam", "telegram", "slack", "microsoft", "outlook", "google", "gmail", "facebook", "instagram", "linkedin", "metamask", "binance"];
  // One-letter typos and look-alike swaps of these (dlscord, paypa1,
  // rnicrosoft) are flagged too; only names of 6+ letters, so ordinary words
  // ("stream" vs "steam") don't trip it.
  const TYPO_BRANDS = ["discord", "paypal", "amazon", "netflix", "google", "telegram", "linkedin", "instagram", "facebook", "whatsapp", "microsoft", "outlook", "flipkart", "phonepe", "binance", "metamask"];
  const TWO_LEVEL = /\.(?:co|gov|nic|ac|org|net|edu|res|gen|firm|ind)\.(?:in|uk|au|nz|za)$|\.(?:com|net|org)\.(?:au|br|mx)$/;

  function registrable(host) {
    const parts = host.split(".");
    const n = TWO_LEVEL.test(host) ? 3 : 2;
    return parts.slice(-n).join(".");
  }

  // URLs written in the text (with or without http).
  const URL_IN_TEXT = /\b(?:https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+|(?:[a-z0-9-]+\.)+(?:[a-z]{2,24})\/[^\s<>"')]*|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/[^\s<>"')]*)?)/giu;

  const LINK_RULES = {
    link_lookalike: { title: "Link to a lookalike bank, UPI or brand site", reason: "The address uses a brand's name but isn't the brand's real website.", weight: 0.5 },
    link_punycode: { title: "Link uses a disguised address", reason: "The address uses look-alike characters (punycode) to imitate a real site.", weight: 0.45 },
    link_ip: { title: "Link goes to a bare IP address", reason: "Real banks and services don't send links to raw numeric addresses.", weight: 0.45 },
    link_shortener: { title: "Shortened link hides where it goes", reason: "Short links hide the real destination, so you can't see if it's genuine.", weight: 0.3 },
    link_risky_tld: { title: "Link uses an unusual domain ending", reason: "Cheap domain endings like .xyz or .top are common in scam links.", weight: 0.25 },
    link_mismatch: { title: "Link shows one address but opens another", reason: "The link text shows a website address, but clicking it goes to a different site: a classic phishing trick.", weight: 0.55 },
  };

  // Is any part of the host a near-miss of a brand name? (one edit, or
  // look-alike swaps: 0/o, 1/l/i, rn/m, vv/w)
  function editDistance1(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function typosquat(host) {
    const parts = host.split(/[.-]/).filter((p) => p.length >= 5);
    return parts.some((part) => {
      const swapped = part.replace(/0/g, "o").replace(/[1!|]/g, "l").replace(/rn/g, "m").replace(/vv/g, "w");
      return TYPO_BRANDS.some((b) => part !== b && (swapped === b || editDistance1(part, b) || editDistance1(swapped.replace(/l/g, "i"), b.replace(/l/g, "i"))));
    });
  }

  // Classifies one URL: returns {ruleId | null, safe, host}.
  function classifyUrl(raw) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : "http://" + raw);
    } catch (_) {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".")) return null;
    const reg = registrable(host);
    const issues = [];
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) issues.push("link_ip");
    if (host.split(".").some((l) => l.startsWith("xn--"))) issues.push("link_punycode");
    if (SHORTENERS.has(host) || SHORTENERS.has(reg)) issues.push("link_shortener");
    const isSafe = SAFE.has(reg) || SAFE.has(host) || /\.(?:gov|nic|ac)\.in$|\.edu$/.test(host);
    const label = host.replace(/\./g, " ");
    const brandy = BRAND_TOKENS.some((b) => new RegExp(`(?:^|[^a-z])${b}|${b}(?:[^a-z]|$)`).test(label) || host.includes(b + "-") || host.includes("-" + b)) || typosquat(host);
    if (!isSafe && brandy) issues.push("link_lookalike");
    const tld = host.split(".").pop();
    if (!isSafe && RISKY_TLDS.has(tld)) issues.push("link_risky_tld");
    const hosting = HOSTING.has(reg);
    return { host, issues, safe: isSafe || (hosting && !brandy) };
  }

  // ---- Senders (email) -----------------------------------------------------
  // Brands people impersonate by display name ("PayPal Support"). Generic
  // words (bank, kyc, upi) are left out: a display name can say "XYZ Bank".
  const NAME_BRANDS = ["paypal", "amazon", "netflix", "apple", "microsoft", "outlook", "office 365", "google", "gmail", "facebook", "instagram", "whatsapp", "linkedin", "discord", "steam", "telegram", "dhl", "fedex", "ups", "india post", "sbi", "hdfc", "icici", "axis bank", "kotak", "paytm", "phonepe", "flipkart", "irctc", "income tax", "uidai", "binance", "coinbase", "metamask"];
  const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in", "rediffmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com"]);
  // A link's visible text that is itself an address ("www.sbi.co.in").
  const URL_TEXT = /^(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:[/?#]\S*)?$/i;
  function hostOf(raw) {
    try {
      return new URL(/^https?:\/\//i.test(raw) ? raw : "http://" + raw).hostname.toLowerCase().replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }
  const isSafeHost = (host) => !!host && (SAFE.has(registrable(host)) || SAFE.has(host));

  const api = { RULES, LINK_RULES, NEG_BEFORE, NEG_AFTER, DEV_CONTEXT, URL_IN_TEXT, classifyUrl, registrable, hostOf, isSafeHost, NAME_BRANDS, FREE_MAIL, URL_TEXT };
  root.TrustGraphRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
