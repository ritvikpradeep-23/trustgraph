// Text normalisation for the scam rules, with an index map back to the
// original so evidence can quote exactly what the message said.
//
//   const n = TrustGraphNormalize.normalize("Pl34se s3nd the O T P");
//   n.norm  -> "please send the otp"
//   n.evidence(start, end) -> the matching slice of the ORIGINAL text
//
// Steps: Unicode NFKC; lowercase; drop zero-width characters and soft
// hyphens; Malayalam atomic chillu letters -> consonant + virama (so both
// spellings match one pattern); curly quotes -> straight; leetspeak inside
// words that mix letters and digits ("0tp", "p4yment"); runs of 3+ of the
// same letter squeezed ("urgentttt"); spaced-out letters joined ("O T P",
// "k.y.c").
(function (root) {
  "use strict";

  // Atomic chillu -> consonant + virama (U+0D4D).
  const CHILLU = {
    "ൺ": "ണ്", // ൺ
    "ൻ": "ന്", // ൻ
    "ർ": "ര്", // ർ
    "ൽ": "ല്", // ൽ
    "ൾ": "ള്", // ൾ
    "ൿ": "ക്", // ൿ
  };
  const ZERO_WIDTH = /[​‌‍⁠﻿­]/;
  const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s" };
  // Tokens that legitimately mix letters and digits: amounts, sizes,
  // times, ordinals, promo codes like "trust50".
  const NOT_LEET = /^(rs|inr|usd)?\d+([.,]\d+)*(k|l|cr|lakh|lakhs|x|g|gb|mb|st|nd|rd|th|am|pm|hrs?|mins?|days?|yrs?|kg|km)?$|^[a-z]+\d+$/;

  // Applies a char-level transform to {chars, map} arrays.
  function step(chars, map, fn) {
    const outC = [];
    const outM = [];
    fn(chars, map, (c, m) => {
      outC.push(c);
      outM.push(m);
    });
    return [outC, outM];
  }

  // Malayalam-safe version for pattern sources (no lowercasing etc.).
  function mlNormalize(str) {
    let out = "";
    for (const ch of String(str)) {
      if (ZERO_WIDTH.test(ch)) continue;
      out += CHILLU[ch] || ch;
    }
    return out;
  }

  function normalize(text) {
    const base = String(text || "").normalize("NFKC");
    let chars = [];
    let map = [];

    // 1. per character: zero-width, chillu, quotes, lowercase
    for (let i = 0; i < base.length; i++) {
      let ch = base[i];
      if (ZERO_WIDTH.test(ch)) continue;
      if (CHILLU[ch]) {
        for (const c of CHILLU[ch]) {
          chars.push(c);
          map.push(i);
        }
        continue;
      }
      if (ch === "‘" || ch === "’" || ch === "′") ch = "'";
      else if (ch === "“" || ch === "”") ch = '"';
      const lower = ch.toLowerCase();
      for (const c of lower) {
        chars.push(c);
        map.push(i);
      }
    }

    // 2. leetspeak inside mixed tokens
    {
      const joined = chars.join("");
      const replace = new Map();
      const re = /[a-z0-9@$]+/g;
      let m;
      while ((m = re.exec(joined))) {
        const tok = m[0];
        const letters = (tok.match(/[a-z]/g) || []).length;
        if (letters >= 2 && /[0-9@$]/.test(tok) && tok.length <= 15 && !NOT_LEET.test(tok)) {
          for (let k = 0; k < tok.length; k++) if (LEET[tok[k]] !== undefined) replace.set(m.index + k, LEET[tok[k]]);
        }
      }
      if (replace.size) chars = chars.map((c, i) => (replace.has(i) ? replace.get(i) : c));
    }

    // 3. squeeze runs of 3+ identical Latin letters ("pleeease" -> "please")
    [chars, map] = step(chars, map, (cs, ms, push) => {
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (/[a-z]/.test(c) && cs[i + 1] === c && cs[i + 2] === c) {
          push(c, ms[i]);
          while (cs[i + 1] === c) i++;
          continue;
        }
        push(c, ms[i]);
      }
    });

    // 4. join spaced-out letters: "o t p", "k.y.c", "o-t-p" (3+ letters)
    {
      const joined = chars.join("");
      const drop = new Set();
      const re = /(?<![a-z])[a-z](?:[\s.\-_*]+[a-z](?![a-z])){2,}/g;
      let m;
      while ((m = re.exec(joined))) {
        for (let k = 0; k < m[0].length; k++) if (!/[a-z]/.test(m[0][k])) drop.add(m.index + k);
      }
      if (drop.size) [chars, map] = step(chars, map, (cs, ms, push) => cs.forEach((c, i) => !drop.has(i) && push(c, ms[i])));
    }

    const norm = chars.join("");
    return {
      base,
      norm,
      map,
      // Original text for the normalised range [start, end).
      evidence(start, end) {
        if (start >= end || !map.length) return "";
        const a = map[Math.max(0, start)];
        const b = map[Math.min(map.length - 1, end - 1)];
        let i = a;
        let j = b + 1;
        // Keep surrogate pairs (emoji) whole.
        if (j < base.length && /[\uDC00-\uDFFF]/.test(base[j])) j++;
        return { start: i, end: j, text: base.slice(i, j) };
      },
    };
  }

  const api = { normalize, mlNormalize };
  root.TrustGraphNormalize = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
